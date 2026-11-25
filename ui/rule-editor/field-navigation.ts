import { useEffect, useRef } from "react";

const FOCUSABLE = "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), .cm-content, [tabindex]:not([tabindex='-1'])";

/**
 * Keyboard moves between a form's fields; returns whether it handled the key. Tab / ⇧Tab: the
 * next / previous `[data-nav]` section, back where focus last was in it. ↑/↓: the nearest field
 * above / below. ←/→: the previous / next field on the same line, from a text field once the
 * caret is at its edge. Radios, selects, number fields and text areas keep their own ↑/↓.
 */
export function useFieldNavigation(rootRef: React.RefObject<HTMLElement | null>) {
    const lastFocused = useRef(new WeakMap<Element, HTMLElement>());
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const remember = (e: FocusEvent) => {
            const field = e.target as HTMLElement;
            const section = field.closest("[data-nav]");
            if (section) lastFocused.current.set(section, field);
        };
        root.addEventListener("focusin", remember);
        return () => root.removeEventListener("focusin", remember);
    }, [rootRef]);

    return (e: React.KeyboardEvent): boolean => {
        const root = rootRef.current;
        const field = e.target as HTMLElement;
        if (!root || e.altKey || e.metaKey || e.ctrlKey) return false;
        const fieldsIn = (el: Element) => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((f) => f.getClientRects().length > 0);
        const center = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }; };
        // a radio stands for its group: land on the checked one
        const go = (to: HTMLElement | undefined) => {
            if (!to) return false;
            const checked = to instanceof HTMLInputElement && to.type === "radio" && !to.checked
                ? root.querySelector<HTMLElement>(`input[type=radio][name="${CSS.escape(to.name)}"]:checked`) : null;
            (checked ?? to).focus();
            return true;
        };
        const type = field instanceof HTMLInputElement ? field.type : field.tagName.toLowerCase();

        if (e.key === "Tab") {
            const sections = [...root.querySelectorAll("[data-nav]")].filter((s) => fieldsIn(s).length);
            if (!sections.length) return false;
            const i = sections.findIndex((s) => s.contains(field));
            const next = sections[((i < 0 ? 0 : i + (e.shiftKey ? -1 : 1)) + sections.length) % sections.length];
            const remembered = lastFocused.current.get(next);
            return go(remembered && fieldsIn(next).includes(remembered) ? remembered : fieldsIn(next)[0]);
        }

        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            if (["radio", "select", "number", "textarea"].includes(type)) return false;
            const from = center(field);
            const down = e.key === "ArrowDown";
            const candidates = fieldsIn(root).map((f) => ({ f, c: center(f) }))
                .filter(({ f, c }) => f !== field && (down ? c.y > from.y + from.h / 2 : c.y < from.y - from.h / 2));
            if (!candidates.length) return false;
            // the nearest line, then the closest field on it
            const dy = Math.min(...candidates.map(({ c }) => Math.abs(c.y - from.y)));
            const line = candidates.filter(({ c }) => Math.abs(c.y - from.y) < dy + 8);
            line.sort((a, b) => Math.abs(a.c.x - from.x) - Math.abs(b.c.x - from.x));
            return go(line[0].f);
        }

        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            if (["radio", "select", "number"].includes(type)) return false;
            const left = e.key === "ArrowLeft";
            if (field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement && field.selectionStart !== null)) {
                const text = field as HTMLInputElement | HTMLTextAreaElement;
                if (text.selectionStart !== text.selectionEnd) return false;
                if (left ? text.selectionStart !== 0 : text.selectionEnd !== text.value.length) return false;
            }
            const from = center(field);
            const line = fieldsIn(root).filter((f) => Math.abs(center(f).y - from.y) < from.h / 2 + 4)
                .sort((a, b) => center(a).x - center(b).x);
            return go(line[line.indexOf(field) + (left ? -1 : 1)]);
        }
        return false;
    };
}
