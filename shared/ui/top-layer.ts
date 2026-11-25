import { createElement, Fragment } from "react";
import { subscribe } from "valtio";
import { dockSide, docks, dockWidth } from "./dock";
import { focusModal } from "./modal-focus";

// -------------------------------------------------------------------------------------------------
// TOP LAYER
// A palette drawn in the page itself, above everything: its host, a child of <html>, is a manual
// popover shown while the palette is open, so it's in the browser's top layer, over any z-index.
// The top layer stacks in opening order: when the page opens a popover, a modal dialog or goes
// fullscreen, the host is shown again to get back on top. While it's open the page behind is
// inert and doesn't hear the keys typed in the palette; docked to a side (see ./dock.tsx), the
// page stays usable instead, pushed aside.
// -------------------------------------------------------------------------------------------------

/** Marks the hosts, so palettes of several scripts don't take the top layer or focus from each other. */
const HOST_ATTR = "data-wt-top-layer";
/** Kept out of `inert`: these hosts, and Wiretrick's overlays. */
const KEEP = `[${HOST_ATTR}], wiretrick-ui`;

/**
 * `tweak.onPage` (top frame): mount `ui` above the page while `modal.open`. `name` names the host:
 * the runs of a save share it, so the UI keeps its state.
 */
export function mountOnTop(ctx: TangiTweak.PageCtx, name: string, modal: { open: boolean }, ui: React.ReactNode) {
    const host = takeHost(ctx, name);
    const docked = () => modal.open && dockSide(name) !== "center";
    let root: Document | ShadowRoot | null = null;
    let wantFocus = false;
    const focus = () => { if (root) { wantFocus = false; focusModal(root); } };
    const probe = createElement("span", {
        hidden: true,
        ref: (el: Element | null) => {
            if (el) { root = el.getRootNode() as ShadowRoot; if (wantFocus) requestAnimationFrame(focus); }
        },
    });
    ctx.mount(host, createElement(Fragment, null, ui, probe));

    const isShown = () => host.matches(":popover-open");
    const sync = (initial = false) => {
        if (modal.open === isShown()) return;
        host.style.display = modal.open ? "block" : "none";
        if (modal.open) {
            host.showPopover();
            // a docked panel kept open from the previous page leaves focus to the new page
            if (!initial || !docked()) { wantFocus = true; requestAnimationFrame(focus); }
        } else {
            wantFocus = false;
            host.hidePopover();
        }
    };
    const raise = () => {
        if (!isShown()) return;
        const active = root?.activeElement as HTMLElement | null | undefined;
        host.hidePopover();
        host.showPopover();
        active?.focus({ preventScroll: true });
    };
    sync(true);
    ctx.signal.addEventListener("abort", subscribe(modal, () => sync()));

    // `toggle` doesn't bubble: capture sees the page's popovers (and, in Chrome, dialogs) open
    document.addEventListener("toggle", (e) => {
        if ((e as ToggleEvent).newState === "open" && !(e.target as Element).closest?.(KEEP)) raise();
    }, { capture: true, signal: ctx.signal });
    document.addEventListener("fullscreenchange", raise, { signal: ctx.signal });

    // the page's shortcuts would see keys typed in the palette (as pressed on the host, not a field)
    for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, (e) => e.stopPropagation(), { signal: ctx.signal });

    keepPageBehind(ctx, name, modal, () => modal.open && !docked(), focus);
    pushPageAside(ctx, name, modal, () => (docked() ? { side: dockSide(name) as "left" | "right", width: dockWidth(name) } : null));
}

/** The host named `name`, made or taken over from the run of the previous save; removed when no run has it. */
function takeHost(ctx: TangiTweak.RunCtx, name: string) {
    const id = `wt-top-layer-${name}`;
    let host = document.getElementById(id);
    if (!host) {
        host = document.createElement("wt-top-layer");
        host.id = id;
        host.setAttribute(HOST_ATTR, "");
        host.setAttribute("popover", "manual");
        // the page's inherited styles stop here; overrides the popover's own box (inset, border, background…)
        host.style.cssText = "all: initial; display: none; position: fixed; inset: 0; width: 0; height: 0; overflow: visible";
    }
    if (!host.isConnected) document.documentElement.append(host);
    const owner = Math.random().toString(36).slice(2, 8);
    host.dataset.owner = owner;
    ctx.signal.addEventListener("abort", () => { if (host.dataset.owner === owner) host.remove(); });
    return host;
}

/**
 * While `isModal()` (the palette open, centered), the page behind is `inert`: out of Tab order (Tab
 * from the address bar goes to the palette), unfocusable, hidden from screen readers. The hosts are
 * children of `<html>`: `<body>` goes inert whole, or (were one in it) all of its children but the
 * hosts'. `name` names the modal: open modals of several scripts are tracked on `<html>`, and the
 * page comes back when none is. Focus that still lands on the page goes back to the palette (`focus`).
 */
function keepPageBehind(ctx: TangiTweak.RunCtx, name: string, modal: { open: boolean }, isModal: () => boolean, focus: () => void) {
    // one entry per run: a save's old run ends after the new one started, and mustn't drop its entry
    const key = `${name}#${Math.random().toString(36).slice(2, 8)}`;
    const sync = (open: boolean) => {
        const root = document.documentElement;
        const keys = new Set((root.dataset.wtModals ?? "").split(" ").filter(Boolean));
        if (open) keys.add(key); else keys.delete(key);
        if (keys.size) root.dataset.wtModals = [...keys].join(" "); else delete root.dataset.wtModals;
        const body = document.body;
        // run at document start: no <body> yet, synced again once it's parsed
        if (!body) return;
        const kept = [...document.querySelectorAll(KEEP)];
        const targets = kept.some((el) => body.contains(el))
            ? [...body.children].filter((el) => !kept.some((k) => el.contains(k)))
            : [body];
        for (const el of targets) (el as HTMLElement).inert = keys.size > 0;
    };
    const update = () => sync(isModal());
    update();
    if (!document.body) document.addEventListener("DOMContentLoaded", update, { once: true, signal: ctx.signal });
    onChange(ctx, modal, update);
    ctx.signal.addEventListener("abort", () => sync(false));
    window.addEventListener("focusin", (e) => {
        if (isModal() && !(e.target instanceof Element && e.target.closest(KEEP))) focus();
    }, { capture: true, signal: ctx.signal });
}

type Push = { side: "left" | "right"; width: number };

/**
 * While `push()` gives a side, the page makes room for the palette docked there: `<html>` gets a
 * margin on that side (the widest of the palettes docked there, of all runs and scripts), and is
 * that much narrower. Elements the page fixes to the viewport stay where they are, under the panel.
 */
function pushPageAside(ctx: TangiTweak.RunCtx, name: string, modal: { open: boolean }, push: () => Push | null) {
    const pushes: Map<string, Push> = ((globalThis as any).__wtDockPushes ??= new Map());
    const key = `${name}#${Math.random().toString(36).slice(2, 8)}`;
    const apply = () => {
        const style = document.documentElement.style;
        let taken = 0;
        for (const side of ["left", "right"] as const) {
            const width = Math.max(0, ...[...pushes.values()].filter((p) => p.side === side).map((p) => p.width));
            if (width) style.setProperty(`margin-${side}`, `${width}px`, "important");
            else style.removeProperty(`margin-${side}`);
            taken += width;
        }
        // a page that sets `html { width: 100% }` would only shift for a left margin, and overflow a right one
        if (taken) style.setProperty("width", `calc(100% - ${taken}px)`, "important");
        else style.removeProperty("width");
        fitViewportWide(taken > 0);
    };
    const update = () => {
        const p = push();
        if (p) pushes.set(key, p); else pushes.delete(key);
        apply();
    };
    update();
    if (!document.body) document.addEventListener("DOMContentLoaded", update, { once: true, signal: ctx.signal });
    onChange(ctx, modal, update);
    window.addEventListener("resize", update, { signal: ctx.signal });
    ctx.signal.addEventListener("abort", () => { pushes.delete(key); apply(); });
}

/**
 * While on (a palette docked), elements sized by the viewport (`width: 100vw`, or the window's width
 * set from JS), which no margin on `<html>` narrows, are capped to their container
 * (`max-width: 100%`), the page's new ones too, as it changes. Off, they get their own `max-width`
 * back. One for the page: its state outlives the runs of a save.
 */
function fitViewportWide(want: boolean) {
    const fit: {
        on: boolean;
        capped: Map<HTMLElement, string>;
        /** What the page added since the last scan (`document.body`: everything). */
        pending: Set<Element>;
        timer: number;
        observer: MutationObserver | null;
    } = ((globalThis as any).__wtDockFit ??= { on: false, capped: new Map(), pending: new Set(), timer: 0, observer: null });

    const scan = () => {
        fit.timer = 0;
        if (!fit.on) return;
        for (const el of fit.capped.keys()) if (!el.isConnected) fit.capped.delete(el);
        const roots = fit.pending.has(document.body) ? [document.body] : [...fit.pending].filter((el) => el.isConnected);
        fit.pending.clear();
        const wide = roots.flatMap((root) => [root, ...root.querySelectorAll("*")])
            .filter((el): el is HTMLElement => el instanceof HTMLElement && el !== document.body && !fit.capped.has(el)
                && Math.abs(el.getBoundingClientRect().width - window.innerWidth) <= 1);
        for (const el of wide) {
            if (getComputedStyle(el).position === "fixed") continue;
            fit.capped.set(el, el.style.getPropertyValue("max-width"));
            el.style.setProperty("max-width", "100%", "important");
        }
    };
    const later = (roots: Iterable<Element>) => {
        for (const el of roots) fit.pending.add(el);
        if (!fit.timer && fit.pending.size) fit.timer = window.setTimeout(scan, 200);
    };

    if (!want) {
        if (!fit.on) return;
        fit.on = false;
        fit.observer?.disconnect();
        fit.observer = null;
        clearTimeout(fit.timer);
        fit.timer = 0;
        fit.pending.clear();
        for (const [el, before] of fit.capped) {
            if (before) el.style.setProperty("max-width", before); else el.style.removeProperty("max-width");
        }
        fit.capped.clear();
        return;
    }
    // already on: the layout may have changed (a resize, a palette docked elsewhere)
    if (fit.on) { later([document.body]); return; }
    // no <body> yet (document start): pushPageAside calls again once it's parsed
    if (!document.body) return;
    fit.on = true;
    fit.observer = new MutationObserver((records) =>
        later(records.flatMap((r) => [...r.addedNodes].filter((n): n is Element => n instanceof Element))));
    fit.observer.observe(document.body, { childList: true, subtree: true });
    fit.pending.add(document.body);
    scan();
}

/** Calls `fn` when a palette opens or closes, or is docked elsewhere, until the run ends. */
function onChange(ctx: TangiTweak.RunCtx, modal: { open: boolean }, fn: () => void) {
    ctx.signal.addEventListener("abort", subscribe(modal, fn));
    ctx.signal.addEventListener("abort", subscribe(docks, fn));
}
