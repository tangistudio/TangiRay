import type { SiteState } from "../domain/types";
import type { SiteEvents } from "./site-events";

/** Interactive ARIA roles and how a click on them is described; an explicit role outranks the element's tag. */
const ROLE_TYPES: Record<string, string> = {
    button: "Button", link: "Link", menuitem: "Menu item", menuitemcheckbox: "Menu item", menuitemradio: "Menu item",
    checkbox: "Checkbox", radio: "Radio", switch: "Switch", tab: "Tab", option: "Option", treeitem: "Tree item",
    combobox: "Dropdown", listbox: "Dropdown", textbox: "Text field", searchbox: "Text field", spinbutton: "Number field", slider: "Slider",
    listitem: "List item",
};
/** Structural roles, used only when no interactive role or native control was clicked. */
const FALLBACK_ROLES = ["listitem"];
const VALUE_ROLES = ["combobox", "listbox", "textbox", "searchbox", "spinbutton", "slider"];
const NATIVE_CONTROL = 'button, a[href], input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** The first recognized token of a (space-separated, fallback-ordered) role attribute. */
function interactiveRole(target: Element) {
    return target.getAttribute("role")?.trim().toLowerCase().split(/\s+/).find((role) => role in ROLE_TYPES);
}

function controlType(target: Element): string {
    const role = interactiveRole(target);
    if (role) return ROLE_TYPES[role];
    if (target.tagName === "SELECT") return "Dropdown";
    if (target.tagName === "TEXTAREA" || (target.hasAttribute("contenteditable") && target.getAttribute("contenteditable") !== "false")) return "Text field";
    if (target.tagName === "A") return "Link";
    if (target.tagName === "BUTTON") return "Button";
    if (target.tagName === "INPUT") {
        const type = (target.getAttribute("type") || "text").toLowerCase();
        if (["button", "submit", "reset", "image"].includes(type)) return "Button";
        if (type === "checkbox") return "Checkbox";
        if (type === "radio") return "Radio";
        if (type === "range") return "Slider";
        if (type === "file") return "File input";
        if (["text", "search", "email", "password", "tel", "url", "number", "date", "time", "datetime-local", "month", "week"].includes(type)) {
            return type === "text" ? "Text field" : `${type[0].toUpperCase() + type.slice(1)} field`;
        }
        return "Input";
    }
    return "Control";
}

/** Describe a trusted control click without reading live input values or editable content. */
export function clickLabel(event: MouseEvent): string | undefined {
    if (!event.isTrusted) return undefined;
    const path = event.composedPath();
    if (path.some((node) => node instanceof Element && node.matches("[data-wt-top-layer], wiretrick-ui"))) return undefined;
    const elements = path.filter((node): node is Element => node instanceof Element);
    const target = elements.find((el) => { const role = interactiveRole(el); return role && !FALLBACK_ROLES.includes(role); })
        ?? elements.find((el) => el.matches(NATIVE_CONTROL)) ?? elements.find((el) => interactiveRole(el));
    if (!target) return undefined;
    const type = controlType(target);
    const role = interactiveRole(target);
    const hasValue = target.matches("input, textarea, select") || target.closest('[contenteditable]:not([contenteditable="false"])')
        || VALUE_ROLES.includes(role ?? "");
    const label = target.getAttribute("aria-label") || target.getAttribute("title")
        || (target.tagName === "INPUT" ? target.getAttribute("value") : null)
        || (hasValue || target.querySelector(`input, textarea, select, [contenteditable], ${VALUE_ROLES.map((r) => `[role~="${r}"]`).join(", ")}`) ? "" : target.textContent);
    const text = label?.replace(/\s+/g, " ").trim().slice(0, 80);
    return text ? `${type}: ${text}` : type;
}

export function recordClicks(ctx: TangiTweak.SiteCtx, site: SiteState, events: SiteEvents) {
    window.addEventListener("click", (event) => {
        if (site.captureClicks !== true) return;
        const label = clickLabel(event);
        if (label) events.emit({ kind: "click", label });
    }, { capture: true, signal: ctx.signal });
}
