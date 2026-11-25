import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, getPanel, type KeyBinding, type Panel, showPanel } from "@codemirror/view";
import { MOD } from "../keys";

// -------------------------------------------------------------------------------------------------
// KEYBOARD SHORTCUTS
// The editor's keys, as VS Code's keyboard shortcuts list: a panel at the editor's top (F1, or
// `showEditorKeys` from a hint outside it) with a filter box. The list is what the editor binds:
// the VS Code keymap (@replit/codemirror-vscode-keymap), the find widget's keys and our own,
// in CodeMirror's notation; each shown as this platform types it.
// -------------------------------------------------------------------------------------------------

interface Shortcut {
    /** CodeMirror key names: "Mod-Alt-ArrowUp"; a space separates the steps of a chord. */
    keys: string[];
    /** Its macOS keys, when they aren't `keys`. */
    mac?: string[];
    label: string;
}

const GROUPS: { heading: string; shortcuts: Shortcut[] }[] = [
    {
        heading: "Find and go to",
        shortcuts: [
            { keys: ["Mod-f"], label: "Find" },
            { keys: ["Mod-Alt-f"], label: "Replace" },
            { keys: ["Mod-g", "F3"], label: "Next match (⇧: previous)" },
            { keys: ["Alt-Enter"], label: "Select all matches (in the find box)" },
            { keys: ["Ctrl-g"], label: "Go to line (line or line:column)" },
            { keys: ["Shift-Mod-\\"], label: "Go to matching bracket" },
            { keys: ["F8"], label: "Next problem" },
            { keys: ["Shift-Mod-m"], label: "List problems" },
        ],
    },
    {
        heading: "Selection and cursors",
        shortcuts: [
            { keys: ["Mod-d"], label: "Add the next occurrence to the selection" },
            { keys: ["Shift-Mod-l"], label: "Select all occurrences" },
            { keys: ["Mod-l"], label: "Select line" },
            { keys: ["Mod-a"], label: "Select all" },
            { keys: ["Mod-Alt-ArrowUp", "Mod-Alt-ArrowDown"], label: "Add a cursor above / below" },
            { keys: ["Shift-Alt-i"], label: "Add a cursor at the end of each selected line" },
            { keys: ["Alt-drag"], label: "Column (box) selection" },
            { keys: ["Mod-u"], label: "Undo the last cursor change" },
            { keys: ["Mod-ArrowLeft", "Mod-ArrowRight"], mac: ["Alt-ArrowLeft", "Alt-ArrowRight"], label: "Move by word (⇧: select)" },
        ],
    },
    {
        heading: "Editing",
        shortcuts: [
            { keys: ["Alt-ArrowUp", "Alt-ArrowDown"], label: "Move line up / down" },
            { keys: ["Shift-Mod-k"], label: "Delete line" },
            { keys: ["Mod-Backspace"], mac: ["Alt-Backspace"], label: "Delete word before" },
            { keys: ["Mod-]", "Mod-["], label: "Indent / outdent line" },
            { keys: ["Tab", "Shift-Tab"], label: "Indent / outdent" },
            { keys: ["Ctrl-Space"], label: "Suggestions" },
            { keys: ["Mod-z"], label: "Undo" },
            { keys: ["Shift-Mod-z", "Mod-y"], label: "Redo" },
        ],
    },
    {
        heading: "Folding and view",
        shortcuts: [
            { keys: ["Ctrl-Shift-["], mac: ["Mod-Alt-["], label: "Fold" },
            { keys: ["Ctrl-Shift-]"], mac: ["Mod-Alt-]"], label: "Unfold" },
            { keys: ["Mod-k Mod-0"], label: "Fold all" },
            { keys: ["Mod-k Mod-j"], label: "Unfold all" },
            { keys: ["Alt-z"], label: "Toggle line wrapping (every editor)" },
            { keys: ["F1"], label: "This list" },
            { keys: ["Escape"], label: "Close a box, then leave the editor" },
        ],
    },
];

const APPLE = MOD === "⌘";
const SYMBOLS: Record<string, string> = APPLE
    ? { Mod: "⌘", Cmd: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" }
    : { Mod: "Ctrl", Cmd: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
const NAMES: Record<string, string> = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Enter: "↵", Escape: "Esc",
    Backspace: APPLE ? "⌫" : "Backspace", Tab: "Tab", Space: "Space", drag: "drag",
};

/** "Shift-Mod-k" → "⇧⌘K" on Apple platforms, "Shift+Ctrl+K" elsewhere; chord steps space-separated. */
function formatKeys(keys: string): string {
    return keys.split(" ").map((step) => {
        // the last part is the key ("-" itself never is one here)
        const parts = step.split("-");
        const key = parts.pop()!;
        const name = NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
        const mods = parts.map((m) => SYMBOLS[m] ?? m);
        return APPLE ? mods.join("") + name : [...mods, name].join("+");
    }).join(" ");
}

const toggleKeys = StateEffect.define<boolean>();

const keysOpen = StateField.define<boolean>({
    create: () => false,
    update: (open, tr) => tr.effects.reduce((v, e) => (e.is(toggleKeys) ? e.value : v), open),
    provide: (f) => showPanel.from(f, (open) => (open ? keysPanel : null)),
});

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    e.append(...children);
    return e;
}

function keysPanel(view: EditorView): Panel {
    const close = () => { view.dispatch({ effects: toggleKeys.of(false) }); view.focus(); };
    const input = el("input", "");
    input.placeholder = "Search keyboard shortcuts";
    input.setAttribute("aria-label", "Search keyboard shortcuts");
    input.spellcheck = false;
    const closeButton = el("button", "cm-keys-close", "×");
    closeButton.type = "button";
    closeButton.title = "Close (Esc)";
    closeButton.addEventListener("click", close);
    const list = el("div", "cm-keys-list");
    const render = () => {
        const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
        list.replaceChildren();
        for (const group of GROUPS) {
            const rows = group.shortcuts.filter((s) => {
                const text = `${group.heading} ${s.label} ${(APPLE && s.mac ? s.mac : s.keys).map(formatKeys).join(" ")}`.toLowerCase();
                return words.every((w) => text.includes(w));
            });
            if (!rows.length) continue;
            list.append(el("div", "cm-keys-heading", group.heading));
            for (const s of rows) {
                const keys = el("span", "cm-keys-keys");
                (APPLE && s.mac ? s.mac : s.keys).forEach((k, i) => { if (i) keys.append(" "); keys.append(el("kbd", "", formatKeys(k))); });
                list.append(el("div", "cm-keys-row", el("span", "cm-keys-label", s.label), keys));
            }
        }
        if (!list.childElementCount) list.append(el("div", "cm-keys-empty", "No matching shortcut."));
    };
    input.addEventListener("input", render);
    const dom = el("div", "cm-keys", el("div", "cm-keys-head", input, closeButton), list);
    // its keys stay in it: the surrounding form doesn't see them (Esc would close it, Enter submit it)
    dom.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape" || e.key === "F1") { e.preventDefault(); close(); }
        // the focus stays in the filter: the keys scroll the list
        else if (e.key === "PageDown" || e.key === "PageUp") {
            e.preventDefault();
            list.scrollBy({ top: (e.key === "PageDown" ? 1 : -1) * Math.max(24, list.clientHeight - 24) });
        }
    });
    render();
    return { dom, top: true, mount: () => input.focus() };
}

/** Opens the shortcuts list in `view` (focuses its filter when already open), or closes it. */
export function toggleEditorKeys(view: EditorView): boolean {
    view.dispatch({ effects: toggleKeys.of(!getPanel(view, keysPanel)) });
    return true;
}

// the editor last focused (or made): the one a hint outside any editor opens the list in
let lastEditor: EditorView | null = null;

/** Opens the shortcuts list in the editor last used; false when there's none on the page. */
export function showEditorKeys(): boolean {
    if (!lastEditor?.dom.isConnected) return false;
    if (!getPanel(lastEditor, keysPanel)) lastEditor.dispatch({ effects: toggleKeys.of(true) });
    else lastEditor.dom.querySelector<HTMLInputElement>(".cm-keys input")?.focus();
    return true;
}

export const editorKeysKeymap: KeyBinding[] = [
    { key: "F1", run: toggleEditorKeys, preventDefault: true },
    { key: "Escape", run: (view) => !!getPanel(view, keysPanel) && (view.dispatch({ effects: toggleKeys.of(false) }), true) },
];

/** The list's state, and which editor a hint opens it in: add it to the editor's extensions. */
export const editorKeysExtension = [
    keysOpen,
    EditorView.domEventHandlers({ focus: (_e, view) => { lastEditor = view; } }),
    EditorView.updateListener.of((u) => { if (!lastEditor || !lastEditor.dom.isConnected) lastEditor = u.view; }),
];

/** The list's look (inside the editor's theme). */
export const EDITOR_KEYS_THEME = {
    ".cm-keys": { display: "flex", flexDirection: "column", width: "420px", maxWidth: "100%", maxHeight: "min(360px, 60vh)", boxSizing: "border-box", padding: "6px", background: "var(--wt-surface)", border: "1px solid var(--wt-border)", borderTop: "none", borderRadius: "0 0 5px 5px", boxShadow: "0 2px 8px rgba(0, 0, 0, .28)", font: "12px system-ui, -apple-system, sans-serif" },
    ".cm-keys-head": { display: "flex", gap: "4px", alignItems: "center" },
    ".cm-keys-head input": { flex: "1", minWidth: "0", height: "24px", boxSizing: "border-box", padding: "0 6px", border: "1px solid var(--wt-accent)", borderRadius: "3px", outline: "none", background: "var(--wt-fill-soft)", color: "var(--wt-text)", font: "inherit" },
    ".cm-keys-close": { width: "22px", height: "22px", padding: "0", border: "none", borderRadius: "3px", background: "transparent", color: "var(--wt-text-muted)", fontSize: "15px", lineHeight: "1", cursor: "pointer" },
    ".cm-keys-close:hover": { background: "var(--wt-fill)", color: "var(--wt-text)" },
    ".cm-keys-list": { overflow: "auto", marginTop: "4px" },
    ".cm-keys-heading": { padding: "8px 4px 2px", fontSize: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: ".5px", color: "var(--wt-text-muted)" },
    ".cm-keys-row": { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "3px 4px", borderRadius: "3px" },
    ".cm-keys-row:hover": { background: "var(--wt-fill-soft)" },
    ".cm-keys-label": { color: "var(--wt-text)" },
    ".cm-keys-keys": { flex: "none", display: "flex", gap: "4px", color: "var(--wt-text-faint)" },
    ".cm-keys-keys kbd": { font: "11px ui-monospace, Menlo, monospace", padding: "1px 5px", border: "1px solid var(--wt-border)", borderRadius: "3px", background: "var(--wt-fill-soft)", color: "var(--wt-text-muted)" },
    ".cm-keys-empty": { padding: "12px 4px", color: "var(--wt-text-muted)" },
};
