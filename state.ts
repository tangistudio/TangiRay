import { tweak } from "tangitweak";
import { subscribe } from "valtio";
import { matches } from "./domain/filter";
import { foldKeyer, MAX_LOG, trimLog } from "./domain/log";
import { type Directory, EMPTY_DIRECTORY, MAX_RESPONSE_ENTITIES } from "./domain/entities";
import { type EditorPrefs, isListAction, type PageState, type RuleStore, type SiteEvent, type SiteRule, type SiteState } from "./domain/types";
import type { InterceptorPlugin } from "./plugin";

// -------------------------------------------------------------------------------------------------
// STATE
// The interceptor's stores, and what keeps them in sync. The site store is declared in the entry
// script (./index.ts: TangiTweak requires site stores there) and passed in.
// -------------------------------------------------------------------------------------------------

// store ids from the tweak's former name (api-interceptor): renaming them would start from empty rules and settings
export const store = tweak.globalStore<RuleStore>("api-interceptor-rules", { rules: [], folders: [] });
export const prefs = tweak.globalStore<EditorPrefs>("api-interceptor-prefs", { ruleEditorMode: "gui" });
/** The plugins switched off in ⋯ → Plugins, by id. */
export const pluginSwitches = tweak.globalStore<{ off: string[] }>("api-interceptor-plugins", { off: [] });
export const palette = tweak.tabStore<{ open: boolean; openedByPause?: boolean }>({ open: false });
export const pageState = tweak.tabStore<PageState>({
    directory: EMPTY_DIRECTORY as Directory,
    seq: 0,
    log: [],
    navigations: [],
    clicks: [],
    hideHits: {},
    entities: {},
});

/** `tweak.onPage` (document_start) body: the page's fetch/XHR patch (and the plugins' site parts) can't read stores: copy the enabled rules, the capture choices and the plugins' options into the site store, early. */
export function mirrorSiteRules(ctx: TangiTweak.RunCtx, siteState: SiteState, plugins: readonly InterceptorPlugin[]) {
    let last = "";
    const sync = () => {
        const rules: SiteRule[] = store.rules.filter((r) => r.enabled)
            .map(({ id, name, filter, action }) => ({ id, name, filter, action }));
        const json = JSON.stringify(rules);
        if (json !== last) siteState.rules = JSON.parse(json); // rules' hit counts change often: copy only real changes
        last = json;
        siteState.captureClicks = prefs.showClickBreaks !== false;
        if (JSON.stringify(siteState.pluginsOff ?? []) !== JSON.stringify(pluginSwitches.off)) siteState.pluginsOff = [...pluginSwitches.off];
    };
    sync();
    ctx.signal.addEventListener("abort", subscribe(store, sync));
    ctx.signal.addEventListener("abort", subscribe(prefs, sync));
    ctx.signal.addEventListener("abort", subscribe(pluginSwitches, sync));
    for (const plugin of plugins) {
        const options = plugin.siteOptions;
        if (!options) continue;
        let lastOptions = "";
        const syncOptions = () => {
            const json = JSON.stringify(options.read() ?? null);
            if (json === lastOptions) return;
            lastOptions = json;
            siteState.plugins = { ...siteState.plugins, [plugin.id]: JSON.parse(json) };
        };
        syncOptions();
        for (const s of options.stores) ctx.signal.addEventListener("abort", subscribe(s, syncOptions));
    }
}

/** Adds what the page's fetch/XHR patch reported to this page's log: requests, their changes and responses, entities. */
export function recordSiteEvents(events: readonly SiteEvent[]) {
    const { log } = pageState;
    for (const event of events) {
        if (event.kind === "request") {
            log.push({ ...event.request, seq: ++pageState.seq });
            // hide, favourite and fold rules match all the time: count them per page, not in the persisted rules
            for (const id of event.request.ruleIds) {
                const rule = store.rules.find((r) => r.id === id);
                if (rule && isListAction(rule.action.type)) pageState.hideHits[id] = (pageState.hideHits[id] ?? 0) + 1;
                else if (rule) rule.hits++;
            }
            // trimming reads the whole log: every few requests is enough
            if (log.length > MAX_LOG && pageState.seq % 10 === 0) {
                const hideFilters = store.rules.filter((r) => r.enabled && r.action.type === "hide").map((r) => r.filter);
                const foldRules = store.rules.filter((r) => r.enabled && r.action.type === "fold");
                trimLog(log, (e) => hideFilters.some((f) => matches(f, e.method, e.url, e.body)), foldKeyer(foldRules), prefs.foldSimilarRequests !== false);
            }
        } else if (event.kind === "update") {
            const entry = log.findLast((e) => e.id === event.id);
            if (entry) Object.assign(entry, event.patch);
        } else if (event.kind === "navigation") {
            const navigations = pageState.navigations ?? (pageState.navigations = []);
            if (event.initial && navigations.length === 1 && navigations[0].initial && !log.length && !pageState.clicks?.length && navigations[0].url === event.url) continue;
            const initial = event.initial && !navigations.length;
            navigations.push({ url: event.url, afterSeq: pageState.seq, order: pageState.timelineOrder = (pageState.timelineOrder ?? 0) + 1, ...(initial && { initial: true }) });
            if (navigations.length > MAX_LOG) navigations.splice(0, navigations.length - MAX_LOG);
        } else if (event.kind === "click") {
            const clicks = pageState.clicks ?? (pageState.clicks = []);
            clicks.push({ label: event.label, afterSeq: pageState.seq, order: pageState.timelineOrder = (pageState.timelineOrder ?? 0) + 1 });
            if (clicks.length > MAX_LOG) clicks.splice(0, clicks.length - MAX_LOG);
        } else {
            for (const [key, entity] of Object.entries(event.entities).slice(0, MAX_RESPONSE_ENTITIES)) {
                if (key in pageState.entities) delete pageState.entities[key];
                pageState.entities[key] = entity;
            }
            const overflow = Object.keys(pageState.entities).length - MAX_RESPONSE_ENTITIES;
            if (overflow > 0) for (const key of Object.keys(pageState.entities).slice(0, overflow)) delete pageState.entities[key];
        }
    }
}
