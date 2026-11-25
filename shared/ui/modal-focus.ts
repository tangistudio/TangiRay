import { activeElementIn } from "./shadow-root";

// -------------------------------------------------------------------------------------------------
// MODAL FOCUS
// Palette modals take the keyboard: Tab stays inside them (see ./top-layer.ts for the page behind).
// -------------------------------------------------------------------------------------------------

/** Marks a palette's frame (see ./dock.tsx): modal or docked, it gets focus when it opens. */
export const PALETTE_ATTR = "data-wt-palette";

const TABBABLE = "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [contenteditable=true], [tabindex]";

/**
 * A modal's `onKeyDown`: keeps Tab / ⇧Tab inside it, cycling its fields in page order and wrapping
 * at the ends. Fields that use Tab themselves (a code editor's indent, a form's own navigation)
 * handle it first: an event they prevented is left alone.
 */
export function trapTab(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== "Tab" || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
    const fields = [...e.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)]
        .filter((el) => (el.tabIndex >= 0 || el.isContentEditable) && el.getClientRects().length > 0);
    e.preventDefault();
    if (!fields.length) return;
    const i = fields.indexOf(activeElementIn(e.currentTarget)!);
    const next = i < 0 ? (e.shiftKey ? fields.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + fields.length) % fields.length;
    fields[next].focus();
}

/**
 * Focus `root`'s open modal or docked palette (the topmost one shown), back on the field last
 * focused in it, or its first.
 */
export function focusModal(root: Document | ShadowRoot) {
    const modal = [...root.querySelectorAll<HTMLElement>(`[aria-modal="true"], [${PALETTE_ATTR}]`)].filter((el) => el.getClientRects().length > 0).at(-1);
    if (!modal) return;
    const active = root.activeElement as HTMLElement | null;
    if (active && active !== modal && modal.contains(active)) { active.focus(); return; }
    const first = [...modal.querySelectorAll<HTMLElement>(TABBABLE)].find((el) => (el.tabIndex >= 0 || el.isContentEditable) && el.getClientRects().length > 0);
    (first ?? modal).focus();
}
