import type { ComponentType } from "react";
import type { Directory, EntityHints } from "./domain/entities";
import type { LoggedRequest, Rule, SiteEvent } from "./domain/types";

// -------------------------------------------------------------------------------------------------
// PLUGINS
// What a plugin adds to the interceptor, site-specific knowledge kept out of the core (see
// ./plugins/atlas). Plugins are listed in the entry script (./index.ts): remove one there to unplug
// it. Each part is optional; a plugin works on its `pages` only.
// - site: runs in the page's own JS world with the fetch/XHR patch (no stores there): patch more
//   (e.g. WebSockets), log entries of its own, read JSON responses, answer the palette's calls.
// - the rest runs in the palette's world: entity names and hints for the capsules, how its own
//   log entries look, ⋯ menu items, sections in a request's details, CSS.
// -------------------------------------------------------------------------------------------------

/** Calls one of the plugin's site `rpc` functions, in the page. */
export type PluginCall = (name: string, ...args: unknown[]) => Promise<any>;

export interface SitePluginApi {
    /** Reports to the page's log; entries of the plugin's own set `source` to its id. */
    emit(event: SiteEvent): void;
    /** Call before logging an entry: a page URL change is recorded first. */
    checkNavigation?: () => void;
    /** What the plugin's palette part mirrors into the site store (`siteOptions`), live. */
    options<T>(): T | undefined;
    /** Whether the plugin is switched on in ⋯ → Plugins, live: while it's off, what it emits is dropped anyway. */
    isOn(): boolean;
}

export interface SitePart {
    /** JSON responses it reads, by URL: the core parses them and calls `json`. */
    readsJson?: (url: string) => boolean;
    json?: (url: string, value: unknown) => void;
    /** What the palette may call (`PluginCall`): e.g. data kept in the page's memory. */
    rpc?: Record<string, (...args: any[]) => unknown>;
}

/** How a log entry of the plugin's own (`LoggedRequest.source`) shows in the list. */
export interface EntrySummary {
    title: string;
    sub: string;
    status: { text: string; className: string };
    /** more text the search box matches */
    search: string[];
}

export interface EntryDetailsProps {
    entry: LoggedRequest;
    rules: Rule[];
    call: PluginCall;
    pinned?: boolean;
    onUnpin?: () => void;
    folded?: readonly LoggedRequest[];
    foldedBy?: string;
    onUnfold: () => void;
    onShowRule: (id: string) => void;
}

/** A checkbox in the list's ⋯ → Plugins menu. */
export interface PluginMenuItem {
    label: string;
    icon?: string;
    title?: string;
    checked?: boolean;
    onSelect: () => void;
}

export interface InterceptorPlugin {
    /** unique; also the `source` of its log entries */
    id: string;
    /** its on/off switch in ⋯ → Plugins */
    name: string;
    /** URL patterns (URLPattern syntax) of the pages it works on; undefined: wherever the interceptor does */
    pages?: string[];

    /** `tweak.onSite` (the page's world), with the fetch/XHR patch. */
    site?: (ctx: TangiTweak.SiteCtx, api: SitePluginApi) => SitePart | void;
    /** JSON the site part reads through `api.options()`: `read` is mirrored into the site store whenever one of `stores` changes. */
    siteOptions?: { stores: object[]; read: () => unknown };

    /** Added to the palette's styles. */
    css?: string;
    entities?: {
        /** how to recognise ids its directory doesn't know */
        hints?: EntityHints;
        /** names of the entities on the page, read when the palette opens and on navigation */
        directory?: (call: PluginCall) => Promise<Pick<Directory, "ids">>;
    };
    /** Its own log entries (non-HTTP: only list rules apply, not in HAR exports). */
    entries?: {
        summary: (entry: LoggedRequest) => EntrySummary;
        /** a hook: which of its entries the list shows */
        useShown?: () => (entry: LoggedRequest) => boolean;
        Details: ComponentType<EntryDetailsProps>;
    };
    /** a hook: checkboxes for the ⋯ → Plugins menu */
    useMenuItems?: () => PluginMenuItem[];
    /** Shown in an HTTP request's details, above its body (render nothing for requests it doesn't know). */
    RequestSection?: ComponentType<{ url: string; body: string; complete: boolean }>;
    /** Headers folded away as minor by default (lowercase). */
    minorHeaders?: string[];
}

/** Whether `plugin` works on the page at `url`. */
export const appliesTo = (plugin: InterceptorPlugin, url: string) => !plugin.pages || plugin.pages.some((p) => {
    try { return new URLPattern(p).test(url); } catch { return false; }
});

// the palette's plugins (the ones for its page, switched on): set before it mounts, constant for the page (their hooks run in it)
let palettePluginList: readonly InterceptorPlugin[] = [];
// every plugin for the page, switched off ones included: ⋯ → Plugins lists their switches
let pagePluginList: readonly InterceptorPlugin[] = [];

export function setPalettePlugins(on: readonly InterceptorPlugin[], forPage: readonly InterceptorPlugin[]) {
    palettePluginList = on;
    pagePluginList = forPage;
}

export const palettePlugins = () => palettePluginList;
export const pagePlugins = () => pagePluginList;
/** The page's plugins switched on now (`off`: ⋯ → Plugins' choice): for what isn't a hook, which follows the switch right away. */
export const livePlugins = (off: readonly string[]) => pagePluginList.filter((p) => !off.includes(p.id));

/** The plugin a log entry comes from; undefined for the page's HTTP requests. */
export const entryPlugin = (entry: Pick<LoggedRequest, "source">) => (entry.source ? palettePluginList.find((p) => p.id === entry.source) : undefined);
