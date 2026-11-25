import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorSelection, type EditorState, StateEffect, StateField } from "@codemirror/state";
import { type EditorView, getPanel, type KeyBinding, type Panel, showPanel, type ViewUpdate } from "@codemirror/view";

// -------------------------------------------------------------------------------------------------
// FIND WIDGET AND GO TO LINE
// VS Code's: a find box hanging from the editor's top right (match case / whole word / regex
// toggles in the field, "3 of 12", previous / next, a chevron for the replace row), and a go-to-line
// box (⌃G) taking `line` or `line:column`. Keys typed in them stay there: the surrounding form
// doesn't see them (Enter would submit it, Esc close it).
// -------------------------------------------------------------------------------------------------

const ICONS = {
    up: '<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>',
    down: '<path d="M8 3v10M3.5 8.5 8 13l4.5-4.5"/>',
    close: '<path d="m4 4 8 8M12 4l-8 8"/>',
    chevron: '<path d="m6 3.5 4.5 4.5L6 12.5"/>',
    replace: '<path d="M3 5h7l-2-2M13 11H6l2 2"/>',
    replaceAll: '<path d="M2 4h7l-2-2M14 9H7l2 2M2 14h12"/>',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.append(...children);
    return e;
}

function iconButton(icon: keyof typeof ICONS, title: string, onClick: () => void, className = "cm-find-icon") {
    const b = el("button", { type: "button", class: className, title, "aria-label": title });
    b.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the focus in the field
    b.addEventListener("click", onClick);
    return b;
}

/** Keys in a widget stay in it (the form around the editor would act on Enter, Esc, arrows…). */
const contain = (dom: HTMLElement) => dom.addEventListener("keydown", (e) => e.stopPropagation());

const MAX_COUNT = 9999;

/** Shows the find widget's replace row and focuses it. */
const showReplace = StateEffect.define<null>();

function countMatches(state: EditorState, query: SearchQuery) {
    const { from, to } = state.selection.main;
    let total = 0, current = 0;
    const cursor = query.getCursor(state);
    for (let r = cursor.next(); !r.done; r = cursor.next()) {
        total++;
        if (r.value.from === from && r.value.to === to) current = total;
        if (total > MAX_COUNT) break;
    }
    return { total, current };
}

/** The find widget: `search({ createPanel: findPanel })`. */
export function findPanel(view: EditorView): Panel {
    let query = getSearchQuery(view.state);
    let expanded = !!query.replace;

    const find = el("input", { "main-field": "true", placeholder: "Find", "aria-label": "Find", spellcheck: "false" });
    const replaceField = el("input", { placeholder: "Replace", "aria-label": "Replace", spellcheck: "false" });
    const toggle = (label: string, title: string, key: "caseSensitive" | "wholeWord" | "regexp") => {
        const b = el("button", { type: "button", class: `cm-find-toggle cm-find-${key}`, title, "aria-label": title, "aria-pressed": "false" }, label);
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", () => { b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); commit(); });
        return b;
    };
    const caseToggle = toggle("Aa", "Match Case (⌥⌘C)", "caseSensitive");
    const wordToggle = toggle("ab", "Match Whole Word (⌥⌘W)", "wholeWord");
    const regexToggle = toggle(".*", "Use Regular Expression (⌥⌘R)", "regexp");
    const pressed = (b: HTMLElement) => b.getAttribute("aria-pressed") === "true";
    const findField = el("div", { class: "cm-find-field" }, find, caseToggle, wordToggle, regexToggle);
    const count = el("span", { class: "cm-find-count", "aria-live": "polite" });
    const prev = iconButton("up", "Previous Match (⇧↵)", () => findPrevious(view));
    const next = iconButton("down", "Next Match (↵)", () => findNext(view));
    const close = iconButton("close", "Close (Esc)", () => { closeSearchPanel(view); view.focus(); });
    const replaceOne = iconButton("replace", "Replace (↵)", () => replaceNext(view));
    const replaceEvery = iconButton("replaceAll", "Replace All (⌘↵)", () => replaceAll(view));
    const replaceRow = el("div", { class: "cm-find-row cm-find-replace" }, el("div", { class: "cm-find-field" }, replaceField), replaceOne, replaceEvery);
    const expand = iconButton("chevron", "Toggle Replace", () => { expanded = !expanded; render(); if (expanded) replaceField.focus(); }, "cm-find-icon cm-find-expand");
    const dom = el("div", { class: "cm-find", role: "search" }, expand, el("div", { class: "cm-find-rows" }, el("div", { class: "cm-find-row" }, findField, count, prev, next, close), replaceRow));

    function commit() {
        const q = new SearchQuery({
            search: find.value, replace: replaceField.value,
            caseSensitive: pressed(caseToggle), wholeWord: pressed(wordToggle), regexp: pressed(regexToggle),
        });
        if (!q.eq(query)) {
            query = q;
            view.dispatch({ effects: setSearchQuery.of(q) });
        }
    }

    function render() {
        if (find.value !== query.search) find.value = query.search;
        if (replaceField.value !== query.replace) replaceField.value = query.replace;
        caseToggle.setAttribute("aria-pressed", String(query.caseSensitive));
        wordToggle.setAttribute("aria-pressed", String(query.wholeWord));
        regexToggle.setAttribute("aria-pressed", String(query.regexp));
        dom.classList.toggle("cm-find-expanded", expanded);
        expand.setAttribute("aria-expanded", String(expanded));
        replaceRow.hidden = !expanded;
        const empty = !query.search;
        const { total, current } = !empty && query.valid ? countMatches(view.state, query) : { total: 0, current: 0 };
        const none = !empty && (!query.valid || total === 0);
        count.textContent = empty ? "No results" : !query.valid ? "Invalid" : total === 0 ? "No results" : `${current || "?"} of ${total > MAX_COUNT ? `${MAX_COUNT}+` : total}`;
        count.classList.toggle("cm-find-none", none);
        findField.classList.toggle("cm-find-none", none);
        for (const b of [prev, next, replaceOne, replaceEvery]) b.disabled = empty || total === 0;
    }

    for (const input of [find, replaceField]) input.addEventListener("input", commit);
    find.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); (e.shiftKey ? findPrevious : findNext)(view); }
    });
    replaceField.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); (e.metaKey || e.ctrlKey ? replaceAll : replaceNext)(view); }
    });
    dom.addEventListener("keydown", (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (e.key === "Escape") { e.preventDefault(); closeSearchPanel(view); view.focus(); }
        else if (mod && e.altKey && ["KeyC", "KeyW", "KeyR"].includes(e.code)) {
            e.preventDefault();
            ({ KeyC: caseToggle, KeyW: wordToggle, KeyR: regexToggle } as Record<string, HTMLButtonElement>)[e.code].click();
        }
    });
    contain(dom);
    render();

    return {
        dom,
        top: true,
        // CodeMirror focuses the main field only when the widget is already open
        mount: () => { find.focus(); find.select(); },
        update(u: ViewUpdate) {
            let changed = u.docChanged || u.selectionSet;
            for (const tr of u.transactions) for (const effect of tr.effects) {
                if (effect.is(setSearchQuery)) { query = effect.value; changed = true; }
                if (effect.is(showReplace)) { expanded = true; changed = true; queueMicrotask(() => replaceField.focus()); }
            }
            if (changed) render();
        },
    };
}

/** Opens the find widget with the replace row showing (VS Code's ⌥⌘F). */
export function openReplace(view: EditorView) {
    openSearchPanel(view);
    view.dispatch({ effects: showReplace.of(null) });
    return true;
}

// GO TO LINE --------------------------------------------------------------------------------------

const toggleGoto = StateEffect.define<boolean>();
const gotoOpen = StateField.define<boolean>({
    create: () => false,
    update: (open, tr) => tr.effects.reduce((v, e) => (e.is(toggleGoto) ? e.value : v), open),
    provide: (f) => showPanel.from(f, (open) => (open ? gotoPanel : null)),
});

function gotoPanel(view: EditorView): Panel {
    const input = el("input", { "aria-label": "Go to line", spellcheck: "false" });
    const hint = el("div", { class: "cm-goto-hint" });
    const dom = el("div", { class: "cm-goto" }, input, hint);
    const closeGoto = (refocus: boolean) => {
        view.dispatch({ effects: toggleGoto.of(false) });
        if (refocus) view.focus();
    };
    const target = () => {
        const m = /^\s*(\d+)\s*(?:[:,]\s*(\d+))?\s*$/.exec(input.value);
        if (!m) return null;
        const doc = view.state.doc;
        const line = doc.line(Math.min(Math.max(1, Number(m[1])), doc.lines));
        return { line, pos: line.from + Math.min(Math.max(0, Number(m[2] ?? 1) - 1), line.length) };
    };
    const describe = () => {
        const { doc, selection } = view.state;
        const line = doc.lineAt(selection.main.head);
        const t = target();
        hint.textContent = t
            ? `Go to line ${t.line.number}${/[:,]/.test(input.value) ? `, character ${t.pos - t.line.from + 1}` : ""}.`
            : `Current line: ${line.number}, character: ${selection.main.head - line.from + 1}. Type a line number between 1 and ${doc.lines} to navigate to.`;
    };
    input.placeholder = ":line or line:column";
    input.addEventListener("input", describe);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); closeGoto(true); }
        else if (e.key === "Enter") {
            e.preventDefault();
            const t = target();
            if (!t) return;
            view.dispatch({ selection: EditorSelection.cursor(t.pos), scrollIntoView: true, effects: toggleGoto.of(false) });
            view.focus();
        }
    });
    // as VS Code's: it goes away when the focus does
    input.addEventListener("blur", () => { if (getPanel(view, gotoPanel)) closeGoto(false); });
    contain(dom);
    describe();
    return { dom, top: true, mount: () => input.focus() };
}

export function gotoLine(view: EditorView) {
    const open = getPanel(view, gotoPanel);
    if (open) open.dom.querySelector("input")?.focus();
    else view.dispatch({ effects: toggleGoto.of(true) });
    return true;
}

/** Before the VS Code keymap: its ⌃G opens CodeMirror's own go-to-line. */
export const findKeymap: KeyBinding[] = [
    { key: "Ctrl-g", run: gotoLine },
    { key: "Mod-Alt-f", run: openReplace },
    { key: "Mod-g", run: findNext, shift: findPrevious },
    { key: "F3", run: findNext, shift: findPrevious },
    { key: "Escape", run: (view) => closeSearchPanel(view) || (getPanel(view, gotoPanel) ? (view.dispatch({ effects: toggleGoto.of(false) }), true) : false) },
];

/** The go-to-line box's state: add it to the editor's extensions. */
export const gotoLineExtension = gotoOpen;
