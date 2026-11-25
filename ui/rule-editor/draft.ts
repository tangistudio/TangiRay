import { escapePattern, segmentName } from "../../domain/filter";
import type { RuleFields } from "../../domain/rules-io";
import type { Action, Filter, LoggedRequest, MockResponse, Rule } from "../../domain/types";

// -------------------------------------------------------------------------------------------------
// RULE DRAFTS
// The rule editor's form state (a Draft) and its conversion to and from rules.
// -------------------------------------------------------------------------------------------------

export interface Draft {
    ruleId?: string;
    /** made from scratch: the sample request is the user's to type */
    blank?: boolean;
    /** the rule's switch (new rules start on) */
    enabled?: boolean;
    name: string;
    tags: string;
    sample: Rule["sample"];
    useMethod: boolean;
    /** the filter's URL pattern (see URL PATTERNS in ../../domain/filter.ts); empty: any URL */
    urlPattern: string;
    params: { key: string; value: string; use: boolean }[];
    useBody: boolean;
    bodyContains: string;
    choice: EditorAction;
    /** pause: when */
    pauseAt: "request" | "response";
    /** pause: done automatically, as `auto` says, rather than asking each time */
    automatic: boolean;
    /** pause: what Remember in the palette made it do automatically, kept while the editor's open */
    auto: { request?: AutoSend; response?: AutoReplace };
    /** delay */
    delayMs: number;
    mock: MockResponse & { delayMs: number };
}

type AutoSend = Extract<Action, { type: "request"; mode: "send" }>;
type AutoReplace = Extract<Action, { type: "response"; mode: "replace" }>;

/**
 * What the rule editor offers: pause (each time, or automatically once remembered in the palette),
 * mock, delay, and the list-only ones. Each stands for a stored action (see Action in ../../domain/types.ts).
 */
export type EditorAction = "pause" | "mock" | "delay" | "favourite" | "fold" | "hide";

export function editorAction(a: Action): EditorAction {
    if (a.type === "request") return a.mode === "respond" ? "mock" : a.mode === "send" && !Object.keys(a.edit).length && !a.response ? "delay" : "pause";
    return a.type === "response" ? "pause" : a.type;
}

export type ActionGroup = "traffic" | "list";

/** What an action changes: the page's traffic, or only the palette's list. */
export const ACTION_GROUPS: { id: ActionGroup; label: string; hint?: string }[] = [
    { id: "traffic", label: "Traffic" },
    { id: "list", label: "List only", hint: "Only changes the palette's list: the page's traffic is untouched." },
];

/** In ACTION_GROUPS order: ⌥1, ⌥2… pick them in the order they're shown. */
export const ACTIONS: { choice: EditorAction; group: ActionGroup; label: string; hint: string }[] = [
    { choice: "pause", group: "traffic", label: "Pause", hint: "Hold each matching request or response in the palette to edit it (5 min max)." },
    { choice: "mock", group: "traffic", label: "Mock", hint: "Answer each matching request with this response; the request is never sent." },
    { choice: "delay", group: "traffic", label: "Delay", hint: "Hold each matching request for a while, then send it as is." },
    { choice: "favourite", group: "list", label: "Favourite", hint: "Star matching requests and pin them at the top of the list." },
    { choice: "fold", group: "list", label: "Fold", hint: "Fold matching requests into one row of the list, even when their URLs or bodies differ (widen the filter with * to match more)." },
    { choice: "hide", group: "list", label: "Hide", hint: "Don't list matching requests (\"show hidden\" lists them)." },
];

export function draftFromRequest(e: LoggedRequest): Draft {
    const u = new URL(e.url);
    return {
        name: "",
        tags: "",
        sample: { method: e.method, url: e.url, body: e.body },
        useMethod: true,
        urlPattern: patternFromSample(e.url),
        params: [...u.searchParams].map(([key, value]) => ({ key, value, use: false })),
        useBody: false,
        bodyContains: "",
        // a plugin's entries (e.g. WebSocket messages) aren't HTTP requests: only list rules apply to them
        choice: e.source ? "hide" : "delay",
        pauseAt: "request",
        automatic: false,
        auto: {},
        delayMs: 3000,
        mock: { status: 500, mime: "application/json", body: JSON.stringify({ error: "Injected failure" }, null, 2), delayMs: 0 },
    };
}

export function blankDraft(origin: string): Draft {
    const draft = draftFromRequest({ id: "", seq: 0, method: "GET", url: `${origin}/`, headers: {}, startedAt: 0, ruleIds: [] });
    return { ...draft, blank: true, useMethod: false, urlPattern: `${origin}/*` };
}

/** The draft with another sample request: the pattern's wildcards and used query params carry over where they still fit. */
export function withSample(d: Draft, sample: Rule["sample"]): Draft {
    const u = new URL(sample.url);
    const params = [...u.searchParams];
    return {
        ...d,
        sample,
        urlPattern: carryPattern(d.urlPattern, d.sample.url, sample.url),
        // typing a rule from scratch, the params typed are what to match
        params: params.map(([key, value]) => ({ key, value, use: d.params.find((p) => p.key === key)?.use ?? !!d.blank })),
    };
}

export function draftFromRule(rule: Rule): Draft {
    const draft = draftFromRequest({ id: "", seq: 0, method: rule.sample.method, url: rule.sample.url, body: rule.sample.body, headers: {}, startedAt: 0, ruleIds: [] });
    const { filter, action } = rule;
    draft.ruleId = rule.id;
    draft.enabled = rule.enabled;
    draft.name = rule.name;
    draft.tags = rule.tags.join(", ");
    draft.useMethod = !!filter.method;
    draft.urlPattern = filter.url ?? "";
    for (const [key, value] of Object.entries(filter.query ?? {})) {
        const param = draft.params.find((p) => p.key === key);
        if (param) Object.assign(param, { value, use: true });
        else draft.params.push({ key, value, use: true });
    }
    draft.useBody = !!filter.bodyContains;
    draft.bodyContains = filter.bodyContains ?? "";
    draft.choice = editorAction(action);
    if (action.type === "response") draft.pauseAt = "response";
    if (action.type === "request" && action.mode === "respond") draft.mock = { ...action.response, delayMs: action.delayMs };
    else if (action.type === "request" && action.mode === "send") {
        if (draft.choice === "delay") draft.delayMs = action.delayMs;
        else Object.assign(draft, { automatic: true, auto: { request: action } });
    }
    else if (action.type === "response" && action.mode === "replace") Object.assign(draft, { automatic: true, auto: { response: action } });
    return draft;
}

export function fieldsFromDraft(d: Draft): RuleFields {
    return {
        name: d.name.trim(), tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean), enabled: d.enabled ?? true,
        filter: filterFromDraft(d), action: actionFromDraft(d), sample: d.sample,
    };
}

/** The draft for rule fields typed in the code view, editing rule `ruleId` (if any). */
export function draftFromFields(fields: RuleFields, ruleId: string | undefined): Draft {
    return { ...draftFromRule({ ...fields, id: "", hits: 0 }), ruleId };
}

// JSON with sorted keys: equal for equal values whatever their key order
export function stableJson(value: unknown): string {
    return JSON.stringify(value, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
}

export function filterFromDraft(d: Draft): Filter {
    const query = Object.fromEntries(d.params.filter((p) => p.use && p.key).map((p) => [p.key, p.value]));
    return {
        method: d.useMethod ? d.sample.method.toUpperCase() : undefined,
        url: d.urlPattern.trim() || undefined,
        query: Object.keys(query).length ? query : undefined,
        bodyContains: d.useBody && d.bodyContains ? d.bodyContains : undefined,
    };
}

export function actionFromDraft(d: Draft): Action {
    switch (d.choice) {
        case "pause": {
            const auto = d.pauseAt === "request" ? d.auto.request : d.auto.response;
            return d.automatic && auto ? auto : { type: d.pauseAt, mode: "ask" };
        }
        case "mock": {
            const { delayMs, ...response } = d.mock;
            return { type: "request", mode: "respond", delayMs: Math.max(0, delayMs || 0), response };
        }
        case "delay": return { type: "request", mode: "send", delayMs: Math.max(0, d.delayMs || 0), edit: {} };
        default: return { type: d.choice };
    }
}

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "TRACE"];

export const isHttpUrl = (text: string) => URL.canParse(text) && /^https?:$/.test(new URL(text).protocol);

// -------------------------------------------------------------------------------------------------
// THE EXAMPLE URL AS A PATTERN
// The editor shows the sample URL part by part; clicking a part changes the pattern there: the
// origin on or off (off: any origin), a path segment exact → `:name` (any one segment) → `*` (any
// number) → exact. That works while the pattern lines up with the sample, segment by segment.
// -------------------------------------------------------------------------------------------------

/** How the pattern matches a sample path segment: exactly, `:name` any one segment, `*` any text. */
export type SegmentMatch = "exact" | "one" | "many";

/** The sample's path segments, as the URL has them (a trailing `/` makes an empty last one). */
export const sampleSegments = (url: string) => new URL(url).pathname.split("/").slice(1);

/** The pattern's origin part ("" for a path-only pattern: any origin) and path part. */
export function splitPattern(pattern: string): { origin: string; path: string } {
    if (!pattern || pattern.startsWith("/")) return { origin: "", path: pattern };
    const m = /^([^/]*\/\/[^/]*)(\/.*)?$/s.exec(pattern);
    return m ? { origin: m[1], path: m[2] ?? "" } : { origin: pattern, path: "" };
}

/** How the pattern matches each of the sample's path segments, or null when it doesn't line up with them. */
export function segmentMatches(pattern: string, sampleUrl: string): SegmentMatch[] | null {
    const { path } = splitPattern(pattern);
    const segments = sampleSegments(sampleUrl);
    const parts = path.split("/").slice(1);
    if (parts.length !== segments.length) return null;
    const matched = parts.map((p, i): SegmentMatch | null => (p === "*" ? "many" : /^:[A-Za-z_]\w*$/.test(p) ? "one" : p === escapePattern(segments[i]) ? "exact" : null));
    return matched.every((m) => m !== null) ? matched as SegmentMatch[] : null;
}

/** The pattern for the sample's path with these segment matches (named after the segments before them). */
function pathPattern(segments: string[], matches: SegmentMatch[]): string {
    const names: string[] = [];
    return "/" + segments.map((s, i) => {
        if (matches[i] === "many") return "*";
        if (matches[i] !== "one") return escapePattern(s);
        const name = segmentName(segments, i, names);
        names.push(name);
        return `:${name}`;
    }).join("/");
}

/** The sample URL as a pattern matching just it (but its query). */
export const patternFromSample = (url: string) => new URL(url).origin + pathPattern(sampleSegments(url), []);

/** The pattern with segment `i` matched the next way: exact → one → many → exact. */
export function cycleSegment(pattern: string, sampleUrl: string, i: number): string {
    const matches = segmentMatches(pattern, sampleUrl);
    if (!matches) return pattern;
    const next: Record<SegmentMatch, SegmentMatch> = { exact: "one", one: "many", many: "exact" };
    matches[i] = next[matches[i]];
    return splitPattern(pattern).origin + pathPattern(sampleSegments(sampleUrl), matches);
}

/** The pattern on the sample's origin, or on any origin. */
export function toggleOrigin(pattern: string, sampleUrl: string): string {
    const { origin, path } = splitPattern(pattern);
    return origin ? path || "/*" : new URL(sampleUrl).origin + (path || "/*");
}

/** The pattern on any path, or (from any path) back on the sample's. */
export function toggleAnyPath(pattern: string, sampleUrl: string): string {
    const { origin, path } = splitPattern(pattern);
    return origin + (path === "/*" ? pathPattern(sampleSegments(sampleUrl), []) : "/*");
}

/** The pattern for a new sample URL: the old one's origin choice and segment matches, where the segments still line up. */
function carryPattern(pattern: string, oldUrl: string, newUrl: string): string {
    const { origin } = splitPattern(pattern);
    const before = segmentMatches(pattern, oldUrl);
    if (!before) return pattern;
    const oldSegments = sampleSegments(oldUrl);
    const segments = sampleSegments(newUrl);
    const matches = segments.map((s, i): SegmentMatch => (s === oldSegments[i] ? before[i] ?? "exact" : "exact"));
    const oldOrigin = new URL(oldUrl).origin;
    return (origin === oldOrigin ? new URL(newUrl).origin : origin) + pathPattern(segments, matches);
}
