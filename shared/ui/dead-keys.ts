// -------------------------------------------------------------------------------------------------
// DEAD KEYS
// macOS: ⌥ + E, I, N, U or ` start an accent that the next key completes (⌥N: "˜", ⌥U: "¨"). A
// shortcut on one, handled on keydown with its default prevented, doesn't stop it: the OS starts
// the accent before the page sees the key, and the browser puts it in the field focused once the
// keydown's handled, which is the one the shortcut just opened or focused. `runShortcut` runs such
// shortcuts with no field focused at that moment, then drops an accent that still lands soon after.
// -------------------------------------------------------------------------------------------------

/** What the dead keys leave when completed by nothing (US and international layouts). */
const ACCENTS = new Set(["˜", "¨", "´", "ˆ", "`", "~", "^"]);

const isTextField = (el: unknown): el is HTMLInputElement | HTMLTextAreaElement =>
    el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|url|email|tel|password|)$/.test(el.type));

/** Runs `action` for a keyboard shortcut pressed as `e` (its default prevented), out of a dead key's way. */
export function runShortcut(e: KeyboardEvent | React.KeyboardEvent, action: () => void) {
    e.preventDefault();
    if (e.key !== "Dead") { action(); return; }
    // no field focused when the browser places the accent: it goes nowhere
    const target = e.target as HTMLElement;
    if (isTextField(target) || target.isContentEditable) target.blur();
    dropAccent(target.getRootNode() as Document | ShadowRoot);
    setTimeout(action);
}

/**
 * For a second, a lone accent typed into a text field under `root` is taken out again, once: the one
 * a dead key left. Still composing (the accent shown underlined, waiting for its letter), the field
 * is left and focused again, which settles it, and then it's taken out. On `root`: a listener out of
 * a closed shadow root wouldn't see which field it was.
 */
function dropAccent(root: Document | ShadowRoot) {
    const stop = () => {
        clearTimeout(timer);
        root.removeEventListener("input", onInput, true);
        root.removeEventListener("compositionstart", onCompose, true);
    };
    const onCompose = (ev: Event) => {
        const el = ev.composedPath()[0];
        if (isTextField(el)) setTimeout(() => { el.blur(); el.focus(); });
    };
    // capture on the root: before React's listeners, which then read the value already without the accent
    const onInput = (ev: Event) => {
        const { data, isComposing } = ev as InputEvent;
        const el = ev.composedPath()[0];
        if (isComposing || !data || !ACCENTS.has(data) || !isTextField(el)) return;
        const end = el.selectionStart ?? el.value.length;
        if (el.value.slice(end - data.length, end) !== data) return;
        el.setRangeText("", end - data.length, end, "end");
        stop();
    };
    const timer = setTimeout(stop, 1000);
    root.addEventListener("input", onInput, true);
    root.addEventListener("compositionstart", onCompose, true);
}
