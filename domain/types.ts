import type { TransactionSummary } from "../site/journal";
import type { Directory, Entity } from "./entities";

// -------------------------------------------------------------------------------------------------
// TYPES
// Logged requests, interception rules (filter + action) and pauses, shared through Wiretrick
// stores between the network handlers and the overlay. Everything here must stay JSON.
// -------------------------------------------------------------------------------------------------

export interface LoggedRequest {
    id: string;
    seq: number;
    method: string;
    url: string;
    /** where the request actually went, when a rule rewrote it */
    finalUrl?: string;
    headers: Record<string, string>;
    body?: string;
    startedAt: number;
    status?: number;
    /** the response's Content-Type */
    mime?: string;
    durationMs?: number;
    /** rules that matched it */
    ruleIds: string[];
    /** what a rule did to it, e.g. "failed 500" */
    outcome?: string;
    /** the plugin that logged it (see ../plugin.ts), when it isn't an HTTP request: e.g. a WebSocket message */
    source?: string;
    /** the plugin's own data about it (JSON) */
    detail?: unknown;
    /** the iframe that made it (its key in ../page/frame-calls.ts), when not the top page */
    frame?: string;
}

/** Which requests a rule applies to: every field set must match. */
export interface Filter {
    method?: string;
    /**
     * A URLPattern for the URL without its query (see URL PATTERNS in ./filter.ts), e.g.
     * "https://example.com/api/:team/items/*", or just a path, "/api/*", for any origin.
     * Undefined: any URL.
     */
    url?: string;
    /** query params that must have these values, in any order (others may be present) */
    query?: Record<string, string>;
    bodyContains?: string;
}

/** A response made up by a rule or in the palette: the request is never sent. */
export interface MockResponse { status: number; mime: string; body: string }

/**
 * What a rule does. On a request: "ask" pauses it in the palette (send it, edited or not, respond to
 * it, or block it); "send" sends it with `edit`'s fields replacing its own (none: just the delay),
 * then replaces its response with `response` if set; "respond" answers with `response`, never
 * sending it. On a response: "ask" pauses it in the palette; "replace" replaces it. Every matching rule's delay counts; the first matching rule that
 * changes something decides (see ../site/fetch-xhr-patch.ts).
 */
export type Action =
    | { type: "request"; mode: "ask" }
    /** `response`: also replace its response (remembered from "Send & pause response" in the palette) */
    | { type: "request"; mode: "send"; delayMs: number; edit: Partial<RequestEdit>; response?: { status: number; body: string } }
    | { type: "request"; mode: "respond"; delayMs: number; response: MockResponse }
    | { type: "response"; mode: "ask" }
    | { type: "response"; mode: "replace"; delayMs: number; response: { status: number; body: string } }
    /** only hides matching requests from the palette's request list */
    | { type: "hide" }
    /** only stars matching requests, pinned at the top of the palette's request list */
    | { type: "favourite" }
    /** only folds matching requests into one row of the palette's request list, alike or not */
    | { type: "fold" };

/** Actions that only change how the palette lists requests: the page's requests are left alone. */
export const isListAction = (type: Action["type"]) => type === "hide" || type === "favourite" || type === "fold";

export interface Rule {
    id: string;
    name: string;
    tags: string[];
    enabled: boolean;
    filter: Filter;
    action: Action;
    /** the folder it's in: its path (see FOLDER_SEP in ./folders.ts); undefined: top level */
    folder?: string;
    /** the request the rule was made from, to edit the filter later */
    sample: { method: string; url: string; body?: string };
    hits: number;
}

/** The rules, and folders that have no rule (yet): a folder exists while either has it. */
export interface RuleStore {
    rules: Rule[];
    folders?: string[];
}

export interface RequestEdit {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
}

/** `pauseResponse`: also pause the response (under the same rule) to edit it before the page gets it. */
export type RequestDecision =
    | { kind: "continue"; pauseResponse?: boolean }
    | { kind: "modify"; request: RequestEdit; pauseResponse?: boolean }
    | ({ kind: "respond" } & MockResponse)
    | { kind: "block" };

export type ResponseDecision = { kind: "continue" } | { kind: "modify"; status: number; body: string };

/** `logId`: the paused request's entry in the page's log (for its #number). */
export type Pause =
    | { id: string; stage: "request"; ruleId: string; ruleName: string; createdAt: number; logId?: string; request: RequestEdit; decision?: RequestDecision }
    | { id: string; stage: "response"; ruleId: string; ruleName: string; createdAt: number; logId?: string; request: RequestEdit; status: number; mime?: string; body: string; decision?: ResponseDecision };

/** A rule as the page's own fetch/XHR patch (../site/fetch-xhr-patch.ts) runs it: every action happens there. */
export type SiteRule = Pick<Rule, "id" | "name" | "filter" | "action">;

/** Shared with the page's own JavaScript world (a siteStore): the site could read and change it. */
export interface SiteState {
    /** the enabled rules, in order */
    rules: SiteRule[];
    pauses: Record<string, Pause>;
    captureClicks?: boolean;
    /** each plugin's options for its site part, by plugin id (see InterceptorPlugin.siteOptions) */
    plugins?: Record<string, unknown>;
    /** the ids of the plugins switched off in ⋯ → Plugins: their site parts are ignored */
    pluginsOff?: string[];
}

export interface PageState {
    /** incremented when a pause arrives while the palette is already open, to flash it */
    pauseFlash?: number;
    /** entities the plugins read from the page (e.g. from its state), for the capsules (refreshed when the palette opens) */
    directory: Directory;
    seq: number;
    log: LoggedRequest[];
    navigations?: PageNavigation[];
    clicks?: PageClick[];
    timelineOrder?: number;
    /** hits of hide and favourite rules on this page (other rules count theirs in Rule.hits) */
    hideHits: Record<string, number>;
    /** entities picked up from API responses, by every key they're indexed under */
    entities: Record<string, Entity>;
}
export interface PageNavigation {
    url: string;
    afterSeq: number;
    initial?: boolean;
    order?: number;
}
export interface PageClick {
    label: string;
    afterSeq: number;
    order: number;
}
export interface EditorPrefs {
    ruleEditorMode: "gui" | "code";
    /** folders shown folded in the rules tab */
    collapsedFolders?: string[];
    /** the list's tab, kept across openings */
    listTab?: ListTab;
    /** headers marked minor (true: folded away) or important (false), by lowercase name; only what differs from the defaults (ui/list/HeaderTable.tsx) */
    minorHeaders?: Record<string, boolean>;
    showPageBreaks?: boolean;
    showClickBreaks?: boolean;
    foldSimilarRequests?: boolean;
    showFavouritesAtTop?: boolean;
    /** which end of a URL too long for its row stays visible (default "head": the start) */
    longUrlEnd?: "head" | "tail";
    /** show requests' and pages' URLs without their query and hash */
    hideUrlQuery?: boolean;
    /** the details panel's share of the list's room (0–1): beside the list, and below it in a docked palette */
    detailsSize?: number;
    dockedDetailsSize?: number;
}
export type ListTab = "requests" | "rules";

/** Full transactions recorded in the page (./site/journal.ts), read on demand. */
export interface TransactionSource {
    find: (entry: LoggedRequest) => Promise<TransactionSummary | undefined>;
    body: (txn: TransactionSummary, kind: "request" | "response", offset: number) => Promise<string>;
    /** calls a plugin's site `rpc` function (see ../plugin.ts) */
    call: (plugin: string, name: string, args: unknown[]) => Promise<unknown>;
}

/**
 * What the page's fetch/XHR patch reports to the page's log (the site's world can't write it):
 * a request when it starts, changes to it (edits, outcome, response), entities from responses.
 */
export type SiteEvent =
    | { kind: "request"; request: Omit<LoggedRequest, "seq"> }
    | { kind: "update"; id: string; patch: Partial<Pick<LoggedRequest, "body" | "finalUrl" | "outcome" | "status" | "mime" | "durationMs" | "detail">> }
    | { kind: "navigation"; url: string; initial?: boolean }
    | { kind: "click"; label: string }
    | { kind: "entities"; entities: Record<string, Entity> };
