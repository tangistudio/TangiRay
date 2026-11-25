import { tweak } from "tangitweak";
import { useEffect, useRef } from "react";
import { subscribe } from "valtio";
import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { history, indentWithTab } from "@codemirror/commands";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { highlightSelectionMatches, search } from "@codemirror/search";
import { Compartment, EditorState, type Extension, Prec } from "@codemirror/state";
import { crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, type KeyBinding, keymap, lineNumbers, placeholder as placeholderText, rectangularSelection } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { MOD } from "../keys";
import { findKeymap, findPanel, gotoLineExtension } from "./find-widget";
import { EDITOR_KEYS_THEME, editorKeysExtension, editorKeysKeymap } from "./keys-help";
import { type JsonSchema, jsonSchemaSupport } from "./json-schema";

// -------------------------------------------------------------------------------------------------
// CODE EDITOR
// CodeMirror 6 with VS Code's keys (⌘D next occurrence, ⌥↑/↓ move line, ⇧⌥↓ copy line, ⌘/
// comment, ⌘⇧K delete line, ⌥-click / ⌘⌥↑↓ multi-cursor, ⌘F find, ⌥⌘F replace, ⌃G go to line,
// ⌘⇧[ fold…; find and go to line look like VS Code's too, see ./find-widget.ts),
// line numbers, folding, bracket matching and, for JSON, syntax errors as you type.
// ⌘↵ calls `onSubmit`, ⌘S `onSave`. Esc leaves the text for the editor's frame, where Tab and the
// arrows move on as from any field (↵ goes back in); Esc there, and keys it doesn't use, reach the form.
// ↑ on the first line / ↓ on the last call `onArrowOut`, to move on to the field above / below.
// With a `schema`, JSON gets completion as you type (⌃Space to ask), hover hints and checks.
// -------------------------------------------------------------------------------------------------

export type CodeLanguage = "json" | "text";

export interface CodeEditorProps {
    value: string;
    onChange?: (value: string) => void;
    language?: CodeLanguage;
    /** describes the JSON: completion, hover hints and checks */
    schema?: JsonSchema;
    /** ⌘↵ / Ctrl+↵ */
    onSubmit?: () => void;
    /** ⌘S / Ctrl+S */
    onSave?: () => void;
    /** ↑ with the cursor on the first (visual) line, ↓ on the last; returns whether it moved focus */
    onArrowOut?: (direction: "up" | "down") => boolean;
    autoFocus?: boolean;
    readOnly?: boolean;
    placeholder?: string;
    /** CSS heights: the editor grows with its text between them, then scrolls */
    minHeight?: string;
    maxHeight?: string;
    "aria-label"?: string;
}

/** JSON when the content type says so, or (without one) when the text parses as a JSON object/array. */
export function languageFor(text: string | undefined, mime?: string): CodeLanguage {
    if (mime) return /\bjson\b|\+json/i.test(mime) ? "json" : "text";
    const t = (text ?? "").trim();
    if (!/^[[{]/.test(t)) return "text";
    try { JSON.parse(t); return "json"; } catch { return "text"; }
}

type SchemaSupport = ReturnType<typeof jsonSchemaSupport>;

/** Whether a lone cursor is on the first (`forward`: last) visual line: moving up (down) would leave the text. */
function atVerticalEdge(view: EditorView, forward: boolean) {
    const { ranges, main } = view.state.selection;
    if (ranges.length > 1 || !main.empty) return false;
    // with no line beyond, CodeMirror stays on the same line (at its edge, or below the text where
    // the editor's min height leaves room, at the same column)
    const moved = view.moveVertically(main, forward);
    const from = view.coordsAtPos(main.head), to = view.coordsAtPos(moved.head);
    return !!from && !!to && Math.abs(from.top - to.top) < 1;
}

const languageExtensions = (language: CodeLanguage, schema: SchemaSupport | null): Extension => [
    language === "json" ? [json(), linter(jsonParseLinter(), { delay: 250 }), lintGutter()] : [],
    language === "json" && schema
        ? [autocompletion({ override: [schema.completion], activateOnTyping: true, icons: false }), schema.extensions]
        : autocompletion({ activateOnTyping: false }),
];

// VS Code's Light+ colors
const highlight = HighlightStyle.define([
    { tag: t.propertyName, color: "var(--wt-code-property)" },
    { tag: [t.string, t.special(t.string)], color: "var(--wt-code-string)" },
    { tag: t.number, color: "var(--wt-code-number)" },
    { tag: [t.bool, t.null, t.keyword], color: "var(--wt-code-keyword)" },
    { tag: [t.punctuation, t.separator, t.brace, t.squareBracket], color: "var(--wt-text-soft)" },
    { tag: t.comment, color: "var(--wt-code-comment)", fontStyle: "italic" },
    { tag: t.invalid, color: "var(--wt-code-invalid)" },
]);

const theme = (minHeight: string, maxHeight: string) => EditorView.theme({
    "&": { minHeight, maxHeight, border: "1px solid var(--wt-border)", borderRadius: "6px", background: "var(--wt-surface)", color: "var(--wt-text)", fontSize: "12px" },
    "&.cm-focused": { outline: "2px solid var(--wt-accent)", outlineOffset: "1px" },
    ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, Menlo, monospace", lineHeight: "1.5" },
    ".cm-content": { minHeight, padding: "4px 0" },
    ".cm-gutters": { background: "var(--wt-fill-soft)", borderRight: "1px solid var(--wt-border-soft)", color: "var(--wt-text-faint)", borderRadius: "6px 0 0 6px" },
    // translucent: the selection is drawn in a layer below the lines
    ".cm-activeLine": { background: "var(--wt-code-active-line)" },
    ".cm-activeLineGutter": { background: "var(--wt-fill-strong)", color: "var(--wt-text-soft)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { background: "var(--wt-code-selection)" },
    ".cm-selectionLayer .cm-selectionBackground": { background: "var(--wt-code-selection-blur)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--wt-text)" },
    ".cm-selectionMatch": { background: "var(--wt-code-selection-match)" },
    ".cm-searchMatch": { background: "rgba(255, 192, 16, .35)", outline: "1px solid rgba(148, 79, 1, .4)" },
    ".cm-searchMatch.cm-searchMatch-selected": { background: "rgba(255, 192, 16, .7)" },
    "&.cm-focused .cm-matchingBracket": { background: "var(--wt-code-bracket)", outline: "1px solid var(--wt-code-bracket-border)" },
    // the find and go-to-line widgets float over the text, hanging from the top right, as VS Code's
    ".cm-panels.cm-panels-top": { position: "absolute", top: "0", left: "auto", right: "14px", maxWidth: "calc(100% - 28px)", border: "none", background: "transparent", color: "var(--wt-text)", zIndex: "5" },
    ".cm-panel": { fontFamily: "system-ui, -apple-system, sans-serif", fontSize: "12px" },
    ".cm-find, .cm-goto": { display: "flex", alignItems: "flex-start", gap: "2px", boxSizing: "border-box", padding: "4px 4px 4px 2px", background: "var(--wt-surface)", border: "1px solid var(--wt-border)", borderTop: "none", borderRadius: "0 0 5px 5px", boxShadow: "0 2px 8px rgba(0, 0, 0, .28)" },
    ".cm-find + .cm-goto, .cm-goto + .cm-find": { marginTop: "4px", borderTop: "1px solid var(--wt-border)", borderRadius: "5px" },
    ".cm-find-rows": { display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" },
    ".cm-find-row": { display: "flex", alignItems: "center", gap: "2px", minWidth: "0" },
    ".cm-find-row[hidden]": { display: "none" },
    ".cm-find-field": { display: "flex", alignItems: "center", gap: "1px", width: "230px", maxWidth: "100%", minWidth: "0", height: "24px", boxSizing: "border-box", padding: "0 2px 0 0", border: "1px solid var(--wt-border)", borderRadius: "3px", background: "var(--wt-fill-soft)" },
    ".cm-find-field:focus-within": { borderColor: "var(--wt-accent)" },
    ".cm-find-field.cm-find-none": { borderColor: "var(--wt-red)" },
    ".cm-find-field input, .cm-goto input": { flex: "1", minWidth: "0", margin: "0", padding: "0 6px", border: "none", outline: "none", background: "transparent", color: "var(--wt-text)", font: "12px system-ui, -apple-system, sans-serif" },
    ".cm-find-toggle": { flex: "none", width: "20px", height: "18px", margin: "0", padding: "0", border: "1px solid transparent", borderRadius: "3px", background: "transparent", color: "var(--wt-text-muted)", font: "600 11px ui-monospace, Menlo, monospace", cursor: "pointer" },
    ".cm-find-toggle:hover": { background: "var(--wt-fill)", color: "var(--wt-text)" },
    ".cm-find-toggle.cm-find-wholeWord": { textDecoration: "underline", textUnderlineOffset: "2px" },
    ".cm-find-toggle[aria-pressed=true]": { background: "color-mix(in srgb, var(--wt-accent) 22%, transparent)", borderColor: "var(--wt-accent)", color: "var(--wt-text)" },
    ".cm-find-count": { flex: "none", minWidth: "68px", padding: "0 6px", color: "var(--wt-text-muted)", whiteSpace: "nowrap" },
    ".cm-find-count.cm-find-none": { color: "var(--wt-red)" },
    ".cm-find-icon": { flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", width: "22px", height: "22px", margin: "0", padding: "0", border: "none", borderRadius: "4px", background: "transparent", color: "var(--wt-text-soft)", cursor: "pointer" },
    ".cm-find-icon:hover:not(:disabled)": { background: "var(--wt-fill)", color: "var(--wt-text)" },
    ".cm-find-icon:disabled": { opacity: ".35", cursor: "default" },
    ".cm-find-icon:focus-visible, .cm-find-toggle:focus-visible": { outline: "1px solid var(--wt-accent)", outlineOffset: "-1px" },
    ".cm-find-expand": { width: "16px", height: "auto", alignSelf: "stretch" },
    ".cm-find-expand svg": { transition: "transform .1s" },
    ".cm-find-expanded .cm-find-expand svg": { transform: "rotate(90deg)" },
    ".cm-goto": { flexDirection: "column", alignItems: "stretch", gap: "4px", width: "300px", maxWidth: "100%", padding: "6px" },
    ".cm-goto input": { height: "24px", boxSizing: "border-box", border: "1px solid var(--wt-accent)", borderRadius: "3px", background: "var(--wt-fill-soft)" },
    ".cm-goto-hint": { color: "var(--wt-text-muted)", lineHeight: "1.4", padding: "0 2px" },
    // CodeMirror's own defaults are light-only
    ".cm-tooltip": { fontFamily: "system-ui, -apple-system, sans-serif", fontSize: "12px", background: "var(--wt-surface)", color: "var(--wt-text)", border: "1px solid var(--wt-border)" },
    ".cm-tooltip .cm-tooltip-arrow:before": { borderTopColor: "var(--wt-border)", borderBottomColor: "var(--wt-border)" },
    ".cm-tooltip .cm-tooltip-arrow:after": { borderTopColor: "var(--wt-surface)", borderBottomColor: "var(--wt-surface)" },
    ".cm-placeholder": { color: "var(--wt-text-faint)" },
    ".cm-foldPlaceholder": { background: "var(--wt-fill)", border: "1px solid var(--wt-border)", color: "var(--wt-text-muted)" },
    ".cm-diagnostic": { color: "var(--wt-text)" },
    ".cm-schema-info": { padding: "4px 8px", maxWidth: "420px", display: "flex", flexDirection: "column", gap: "2px", whiteSpace: "normal" },
    ".cm-schema-info code": { color: "var(--wt-text-muted)" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { background: "var(--wt-green-bg)", color: "var(--wt-text)" },
    ".cm-completionDetail": { color: "var(--wt-text-faint)", fontStyle: "normal", marginLeft: "8px" },
    ...EDITOR_KEYS_THEME,
});

/** Editor preferences shared by every editor, everywhere: ⌥Z (Alt+Z) toggles line wrapping, as in VS Code. */
const editorPrefs = tweak.globalStore("code-editor", { wordWrap: true });
const wrapping = () => (editorPrefs.wordWrap ? EditorView.lineWrapping : []);

/** A binding's keys, comparable whatever their modifiers' order: "Shift-Alt-a" → "Alt-Shift-a". */
const normalizeKeys = (keys: string) => {
    const parts = keys.split("-");
    const key = parts.pop()!.toLowerCase();
    return [...parts.map((m) => (m === "Mod" || m === "Cmd" ? "Meta" : m)).sort(), key].join("-");
};

/**
 * macOS: ⌥ + a letter or digit types a character (⌥Z: "Ω"), and CodeMirror then leaves "Alt-z"
 * bindings alone (it only falls back to the physical key with ⌘ or ⌃ held). Here they're matched by
 * the physical key (`code`), before the keymaps; ⇧ picks a binding's `shift` command, as CodeMirror does.
 */
function macOptionKeys(bindings: readonly KeyBinding[]) {
    return Prec.highest(EditorView.domEventHandlers({
        keydown: (e, view) => {
            if (MOD !== "⌘" || !e.altKey || e.metaKey || e.ctrlKey) return false;
            const m = /^(?:Key|Digit)(\w)$/.exec(e.code);
            if (!m) return false;
            const plain = normalizeKeys(`Alt-${m[1].toLowerCase()}`), shifted = normalizeKeys(`Shift-Alt-${m[1].toLowerCase()}`);
            for (const b of bindings) {
                const keys = b.mac ?? b.key;
                if (!keys || keys.includes(" ")) continue;
                const n = normalizeKeys(keys);
                const run = e.shiftKey ? (n === shifted ? b.run : n === plain ? b.shift : undefined) : n === plain ? b.run : undefined;
                if (run?.(view)) { e.preventDefault(); return true; }
            }
            return false;
        },
    }));
}

export function CodeEditor({ value, onChange, language = "text", schema, onSubmit, onSave, onArrowOut, autoFocus, readOnly, placeholder, minHeight = "60px", maxHeight = "50vh", ...aria }: CodeEditorProps) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    // the latest callbacks, for extensions made once
    const callbacks = useRef({ onChange, onSubmit, onSave, onArrowOut });
    callbacks.current = { onChange, onSubmit, onSave, onArrowOut };
    const languageSlot = useRef(new Compartment());
    const readOnlySlot = useRef(new Compartment());
    const wrapSlot = useRef(new Compartment());
    // read on each use: the schema may change (e.g. its examples) without reconfiguring
    const schemaRef = useRef(schema);
    schemaRef.current = schema;
    const schemaSupport = useRef<SchemaSupport>(null!);
    schemaSupport.current ??= jsonSchemaSupport(() => schemaRef.current);
    const support = schema ? schemaSupport.current : null;

    useEffect(() => {
        // before the VS Code keys, which use ⌘↵ to insert a line below
        const ownKeys: KeyBinding[] = [
            { key: "Mod-Enter", run: () => { callbacks.current.onSubmit?.(); return !!callbacks.current.onSubmit; } },
            { key: "Mod-s", run: () => { callbacks.current.onSave?.(); return !!callbacks.current.onSave; } },
            { key: "ArrowUp", run: (v) => !!callbacks.current.onArrowOut && atVerticalEdge(v, false) && callbacks.current.onArrowOut("up") },
            { key: "ArrowDown", run: (v) => !!callbacks.current.onArrowOut && atVerticalEdge(v, true) && callbacks.current.onArrowOut("down") },
            // every editor follows (see the subscription below)
            { key: "Alt-z", run: () => { editorPrefs.wordWrap = !editorPrefs.wordWrap; return true; } },
            ...editorKeysKeymap,
            ...findKeymap,
            // after find's own Esc (which closes its widget): out of the text, onto the frame
            { key: "Escape", run: () => { hostRef.current?.focus(); return true; } },
        ];
        const vscodeKeys = [...vscodeKeymap, indentWithTab];
        const view = new EditorView({
            parent: hostRef.current!,
            state: EditorState.create({
                doc: value,
                extensions: [
                    macOptionKeys([...ownKeys, ...vscodeKeys]),
                    keymap.of(ownKeys),
                    lineNumbers(), highlightActiveLineGutter(), foldGutter(), highlightSpecialChars(), history(), drawSelection(), dropCursor(),
                    EditorState.allowMultipleSelections.of(true), indentOnInput(), syntaxHighlighting(highlight),
                    bracketMatching(), closeBrackets(), rectangularSelection(), crosshairCursor(),
                    highlightActiveLine(), highlightSelectionMatches(), search({ top: true, createPanel: findPanel }), gotoLineExtension, editorKeysExtension,
                    keymap.of(vscodeKeys),
                    wrapSlot.current.of(wrapping()),
                    theme(minHeight, maxHeight),
                    placeholder ? placeholderText(placeholder) : [],
                    EditorView.contentAttributes.of(aria["aria-label"] ? { "aria-label": aria["aria-label"] } : {}),
                    languageSlot.current.of(languageExtensions(language, support)),
                    readOnlySlot.current.of(EditorState.readOnly.of(!!readOnly)),
                    EditorView.updateListener.of((u) => { if (u.docChanged) callbacks.current.onChange?.(u.state.doc.toString()); }),
                ],
            }),
        });
        viewRef.current = view;
        if (autoFocus) view.focus();
        const unsubscribe = subscribe(editorPrefs, () => view.dispatch({ effects: wrapSlot.current.reconfigure(wrapping()) }));
        return () => { unsubscribe(); view.destroy(); viewRef.current = null; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // a value set from outside (Format JSON, a reset…): replace the text, keeping undo
    useEffect(() => {
        const view = viewRef.current;
        if (view && value !== view.state.doc.toString())
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }, [value]);

    useEffect(() => { viewRef.current?.dispatch({ effects: languageSlot.current.reconfigure(languageExtensions(language, support)) }); }, [language, !!support]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { viewRef.current?.dispatch({ effects: readOnlySlot.current.reconfigure(EditorState.readOnly.of(!!readOnly)) }); }, [readOnly]);

    // focusable from script only: Tab skips it, but lands after it once it has the focus
    return (
        <div ref={hostRef} className="cm-host" tabIndex={-1} style={{ borderRadius: "6px", outlineOffset: "2px" }}
            onKeyDown={(e) => {
                if (e.target !== e.currentTarget || e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey) return;
                e.preventDefault();
                viewRef.current?.focus();
            }} />
    );
}
