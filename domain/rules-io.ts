import { urlPatternError } from "./filter";
import { FOLDER_SEP, folderNames, normalizeFolder } from "./folders";
import { newId } from "../shared/util/id";
import type { Action, Filter, Rule } from "./types";

// -------------------------------------------------------------------------------------------------
// RULES FILES
// Rules exported to / imported from JSON, to back them up or share them. Hit counts stay behind.
// -------------------------------------------------------------------------------------------------

const RULES_FORMAT = "wiretrick-api-interceptor-rules";

export function exportRules(rules: readonly Rule[]): string {
    return JSON.stringify({
        format: RULES_FORMAT,
        version: 1,
        // a folder as its names, outermost first: ["team", "billing"]
        rules: rules.map(({ id, name, tags, folder, enabled, filter, action, sample }) => ({ id, name, tags, ...(folder ? { folder: folderNames(folder) } : {}), enabled, filter, action, sample })),
    }, null, 2);
}

/** The rules in an exported file (or a bare array of rules); throws an Error saying what's wrong. */
export function parseRules(text: string): Rule[] {
    let json: unknown;
    try { json = JSON.parse(text); } catch (e) { throw new Error(`Not valid JSON: ${(e as Error).message}`); }
    const list = Array.isArray(json) ? json : isObject(json) && Array.isArray(json.rules) ? json.rules : null;
    if (!list) throw new Error("Expected exported rules: { \"rules\": [...] } or an array of rules.");
    return list.map((raw, i) => {
        try { return parseRule(raw); } catch (e) { throw new Error(`Rule ${i + 1}: ${(e as Error).message}`); }
    });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** What the rule editor's code view shows: a rule as exported, without its id and hit count. */
export type RuleFields = Pick<Rule, "name" | "tags" | "enabled" | "filter" | "action" | "sample">;

export function ruleToJson({ name, tags, enabled, filter, action, sample }: RuleFields): string {
    return JSON.stringify({ name, tags, enabled, filter, action, sample }, null, 2);
}

/** A rule typed in the code view, checked as an import is; throws an Error saying what's wrong. */
export function parseRuleJson(text: string): RuleFields {
    let json: unknown;
    try { json = JSON.parse(text); } catch (e) { throw new Error(`Not valid JSON: ${(e as Error).message}`); }
    const { name, tags, enabled, filter, action, sample } = parseRule(json);
    return { name, tags, enabled, filter, action, sample };
}
const isStringRecord = (v: unknown): v is Record<string, string> => isObject(v) && Object.values(v).every((x) => typeof x === "string");

function parseRule(raw: unknown): Rule {
    if (!isObject(raw)) throw new Error("not an object");
    const filter = parseFilter(raw.filter);
    const action = parseAction(raw.action);
    const s = raw.sample;
    // the editor needs a sample request: make one from the filter when missing
    const sample = isObject(s) && typeof s.url === "string" && URL.canParse(s.url) && typeof s.method === "string"
        ? { method: s.method, url: s.url, ...(typeof s.body === "string" ? { body: s.body } : {}) }
        : sampleFromFilter(filter);
    if (raw.folder !== undefined && !(Array.isArray(raw.folder) && raw.folder.every((n) => typeof n === "string"))) throw new Error('folder must be its names, outermost first: ["team", "billing"]');
    const folder = normalizeFolder(((raw.folder ?? []) as string[]).join(FOLDER_SEP));
    return {
        id: typeof raw.id === "string" && raw.id ? raw.id : newId(),
        name: typeof raw.name === "string" ? raw.name : "",
        tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
        ...(folder ? { folder } : {}),
        enabled: raw.enabled !== false,
        filter,
        action,
        sample,
        hits: 0,
    };
}

function parseFilter(raw: unknown): Filter {
    if (!isObject(raw)) throw new Error("missing filter");
    const filter: Filter = {};
    if (raw.method !== undefined) {
        if (typeof raw.method !== "string") throw new Error("filter.method must be a string");
        filter.method = raw.method.toUpperCase();
    }
    if (raw.url !== undefined) {
        if (typeof raw.url !== "string") throw new Error('filter.url must be a URL pattern like "https://host/api/:group/*"');
        const error = urlPatternError(raw.url);
        if (error) throw new Error(`filter.url: ${error}`);
        filter.url = raw.url;
    }
    if (raw.query !== undefined) {
        if (!isStringRecord(raw.query)) throw new Error("filter.query must map names to strings");
        filter.query = raw.query;
    }
    if (raw.bodyContains !== undefined) {
        if (typeof raw.bodyContains !== "string") throw new Error("filter.bodyContains must be a string");
        filter.bodyContains = raw.bodyContains;
    }
    return filter;
}

function parseAction(raw: unknown): Action {
    if (!isObject(raw)) throw new Error("missing action");
    const num = (o: Record<string, unknown>, key: string, at: string) => { if (typeof o[key] !== "number") throw new Error(`${at}.${key} must be a number`); return o[key] as number; };
    const str = (o: Record<string, unknown>, key: string, at: string) => { if (typeof o[key] !== "string") throw new Error(`${at}.${key} must be a string`); return o[key] as string; };
    const obj = (key: string) => { if (!isObject(raw[key])) throw new Error(`action.${key} must be an object`); return raw[key] as Record<string, unknown>; };
    const delayMs = () => (raw.delayMs === undefined ? 0 : num(raw, "delayMs", "action"));
    switch (raw.type) {
        case "request":
            if (raw.mode === "ask") return { type: "request", mode: "ask" };
            if (raw.mode === "send") {
                const e = raw.edit === undefined ? {} : obj("edit");
                for (const key of ["method", "url", "body"] as const) if (e[key] !== undefined) str(e, key, "action.edit");
                if (e.headers !== undefined && !isStringRecord(e.headers)) throw new Error("action.edit.headers must map names to strings");
                const edit = Object.fromEntries(Object.entries({ method: e.method, url: e.url, headers: e.headers, body: e.body }).filter(([, v]) => v !== undefined));
                if (raw.response === undefined) return { type: "request", mode: "send", delayMs: delayMs(), edit };
                const r = obj("response");
                return { type: "request", mode: "send", delayMs: delayMs(), edit, response: { status: num(r, "status", "action.response"), body: str(r, "body", "action.response") } };
            }
            if (raw.mode === "respond") {
                const r = obj("response");
                return { type: "request", mode: "respond", delayMs: delayMs(), response: { status: num(r, "status", "action.response"), mime: str(r, "mime", "action.response"), body: str(r, "body", "action.response") } };
            }
            throw new Error('action.mode must be "ask", "send" or "respond" for a request');
        case "response":
            if (raw.mode === "ask") return { type: "response", mode: "ask" };
            if (raw.mode === "replace") {
                const r = obj("response");
                return { type: "response", mode: "replace", delayMs: delayMs(), response: { status: num(r, "status", "action.response"), body: str(r, "body", "action.response") } };
            }
            throw new Error('action.mode must be "ask" or "replace" for a response');
        case "hide": case "favourite": case "fold": return { type: raw.type };
        default: throw new Error(`unknown action type ${JSON.stringify(raw.type)} (request, response, hide, favourite, fold)`);
    }
}

/** A request like the ones the filter matches: its pattern's wildcards and `:name`s filled in roughly. */
function sampleFromFilter(filter: Filter): Rule["sample"] {
    const pattern = filter.url ?? "/";
    const literal = pattern.replace(/:([A-Za-z_]\w*)/g, "$1").replace(/[*?+(){}]/g, "").replace(/\\(.)/g, "$1");
    const absolute = URL.canParse(literal) ? new URL(literal) : null;
    const u = new URL(absolute && /^https?:$/.test(absolute.protocol) ? absolute.origin : "https://example.com");
    u.pathname = absolute ? absolute.pathname : literal.startsWith("/") ? literal : "/";
    for (const [k, v] of Object.entries(filter.query ?? {})) u.searchParams.set(k, v);
    return { method: filter.method ?? "GET", url: u.toString(), ...(filter.bodyContains ? { body: filter.bodyContains } : {}) };
}
