import { tweak } from "tangitweak";
import { createElement } from "react";
import { subscribe } from "valtio";
import { mountOnTop } from "./shared/ui/top-layer";
import { type Entity, MAX_RESPONSE_ENTITIES } from "./domain/entities";
import type { SiteEvent, SiteState, TransactionSource } from "./domain/types";
import { downloadFile } from "./page/downloads";
import { callFrame, serveFrameCalls } from "./page/frame-calls";
import { newId } from "./shared/util/id";
import { appliesTo, type InterceptorPlugin, livePlugins, setPalettePlugins } from "./plugin";
import { installSitePatches } from "./site/fetch-xhr-patch";
import { mirrorSiteRules, pageState, palette, pluginSwitches, recordSiteEvents } from "./state";
import { InterceptorPalette } from "./ui/InterceptorPalette";
import { INTERCEPTOR_PALETTE_CSS } from "./ui/styles";

/**
 * Registers TangiRay on `pages` (a recipe: call it at the script's top level): the page's
 * own fetch/XHR, patched (see ./site/fetch-xhr-patch.ts), logs every request and runs the rules
 * (delays, pauses, edits, responses); `plugins` (./plugin.ts) add site-specific knowledge.
 * `siteState` is the entry script's (./index.ts) `tweak.siteStore({ rules: [], pauses: {} })`:
 * Wiretrick wants site stores declared in the script itself (the other stores are in ./state.ts).
 */
export function installApiInterceptor(cfg: { pages: string[]; shortcut: string; plugins: readonly InterceptorPlugin[] }, siteState: SiteState) {
    const sitePatch = tweak.onSite(cfg.pages, (ctx) => installSitePatches(ctx, siteState, cfg.plugins));
    tweak.onPage({ url: cfg.pages, when: "document_start" }, (ctx) => mirrorSiteRules(ctx, siteState, cfg.plugins));
    tweak.onPage({ url: cfg.pages, when: "document_start" }, (ctx) => recordRequests(ctx, sitePatch));
    tweak.onPage(cfg.pages, (ctx) => interceptorPalette(ctx, cfg, siteState, sitePatch));
}

/** The handle of the `tweak.onSite` that runs {@link installSitePatches}. */
export type SitePatchHandle = TangiTweak.Remote<ReturnType<typeof installSitePatches>>;

/**
 * `tweak.onPage` body (document_start): the patch reports requests and responses; this page's log keeps them.
 * In an iframe, its requests are tagged with the frame, and the frame answers the palette's reads of its journal.
 */
export async function recordRequests(ctx: TangiTweak.PageCtx, sitePatch: SitePatchHandle) {
    const frame = window === window.top ? undefined : ctx.once("api-interceptor-frame", newId);
    if (frame) serveFrameCalls(ctx, frame, sitePatch);
    const tag = (events: readonly SiteEvent[]) => (frame ? events.map((e) => (e.kind === "request" ? { ...e, request: { ...e.request, frame } } : e)) : events);
    try {
        for await (const events of ctx.each(sitePatch.nextEvents)) recordSiteEvents(tag(events));
    } catch (e) {
        // frames whose CSP blocks eval (e.g. Stripe's iframes) run onSite in the isolated world, where the patch
        // can't reach the page's fetch/XHR and doesn't run: there is nothing to record there
        if (isNotRunning(e)) return;
        throw e;
    }
}

function isNotRunning(e: unknown) {
    return e instanceof Error && e.name === "WtCallError" && e.message === "not running on this page";
}


/** `tweak.onPage` body: the TangiRay palette. */
export function interceptorPalette(ctx: TangiTweak.PageCtx, cfg: { shortcut: string; plugins: readonly InterceptorPlugin[] }, siteState: SiteState, sitePatch: SitePatchHandle) {
    ctx.shortcut(cfg.shortcut, () => { palette.openedByPause = false; palette.open = !palette.open; }, { iframes: { crossOrigin: true } });
    if (window !== window.top) return;
    const forPage = cfg.plugins.filter((p) => appliesTo(p, ctx.url));
    // switching a plugin takes effect on the next page load: its hooks run in the palette
    const plugins = forPage.filter((p) => !pluginSwitches.off.includes(p.id));
    setPalettePlugins(plugins, forPage);
    // a pause that auto-opened the palette on the previous page died with that page
    if (palette.openedByPause && !Object.keys(siteState.pauses).length) { palette.open = false; palette.openedByPause = false; }
    ctx.style(INTERCEPTOR_PALETTE_CSS + plugins.map((p) => p.css ?? "").join(""));

    // the page's state changes as the user navigates: the plugins re-read their entities on open and on in-page navigation
    const sources = () => livePlugins(pluginSwitches.off).filter((p) => p.entities?.directory);
    const refreshEntities = () => Promise.all(sources().map((p) => p.entities!.directory!((name, ...args) => sitePatch.call(p.id, name, args))
        .catch((e) => { tweak.log(`[tangiray] plugin "${p.id}" couldn't read the page's entities`, String(e)); return { ids: {} as Record<string, Entity> }; })))
        .then((found) => {
            const prev = Object.fromEntries(Object.entries(pageState.directory.ids).map(([k, e]) => [k, e.current ? { ...e, current: undefined } : e]));
            const ids = Object.assign(prev, ...found.map((d) => d.ids));
            const keys = Object.keys(ids);
            if (keys.length > MAX_RESPONSE_ENTITIES) for (const k of keys.slice(0, keys.length - MAX_RESPONSE_ENTITIES)) delete ids[k];
            pageState.directory = { ids };
        });
    if (sources().length) void refreshEntities();
    ctx.signal.addEventListener("abort", subscribe(palette, () => {
        if (!palette.open) { if (palette.openedByPause) palette.openedByPause = false; }
        else if (sources().length) void refreshEntities();
    }));
    let navOrder = pageState.navigations?.at(-1)?.order;
    ctx.signal.addEventListener("abort", subscribe(pageState, () => {
        const latest = pageState.navigations?.at(-1)?.order;
        if (latest !== navOrder) {
            navOrder = latest;
            if (palette.open && sources().length) void refreshEntities();
        }
    }));

    // a paused request waits for the user: show it (or flash it when already open)
    let known = new Set<string>();
    const checkPauses = () => {
        const ids = Object.keys(siteState.pauses);
        if (ids.some((id) => !known.has(id) && !siteState.pauses[id].decision)) {
            if (!palette.open) {
                palette.openedByPause = true;
                palette.open = true;
            } else {
                pageState.pauseFlash = (pageState.pauseFlash ?? 0) + 1;
            }
        }
        known = new Set(ids);
    };
    checkPauses();
    ctx.signal.addEventListener("abort", subscribe(siteState.pauses, checkPauses));

    // full transactions (headers, bodies) recorded by the site patch (an iframe's own, for its requests), for the palette's details panel
    const transactions: TransactionSource = {
        find: async (e) => {
            const urls = e.finalUrl ? [e.url, e.finalUrl] : [e.url];
            if (!e.frame) return sitePatch.transaction(e.method, urls, e.startedAt, e.id);
            const t = await callFrame(e.frame, "transaction", e.method, urls, e.startedAt, e.id);
            return t && { ...t, frame: e.frame };
        },
        body: async (t, kind, offset) => (t.frame ? (await callFrame(t.frame, "transactionBody", t.id, kind, offset)) ?? "" : sitePatch.transactionBody(t.id, kind, offset)),
        call: (plugin, name, args) => sitePatch.call(plugin, name, args),
    };

    // the palette is modal, above everything on the page
    mountOnTop(ctx, "api-interceptor", palette, createElement(InterceptorPalette, { site: siteState, transactions, download: downloadFile, origin: new URL(ctx.url).origin }));
}
