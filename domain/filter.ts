import type { Action, Filter } from "./types";

// -------------------------------------------------------------------------------------------------
// FILTERS AND ACTIONS
// Which requests a rule matches, and what rules do, in words.
// -------------------------------------------------------------------------------------------------

export function pathSegments(pathname: string): string[] {
    return pathname.split("/").filter(Boolean);
}

export function matches(filter: Filter, method: string, url: string, body: string | undefined): boolean {
    if (filter.method && filter.method !== method.toUpperCase()) return false;
    if (filter.url !== undefined) {
        const pattern = compiled(filter.url);
        if (!pattern || !pattern.test(url)) return false;
    }
    // a rule saved before URL patterns (origin/path): it matches nothing until it's made again
    else if ("origin" in filter || "path" in filter) return false;
    if (Object.keys(filter.query ?? {}).length) {
        const params = new URL(url).searchParams;
        for (const [key, value] of Object.entries(filter.query!)) if (params.get(key) !== value) return false;
    }
    if (filter.bodyContains && !(body ?? "").includes(filter.bodyContains)) return false;
    return true;
}

// -------------------------------------------------------------------------------------------------
// URL PATTERNS
// A filter's URL is a URLPattern (https://developer.mozilla.org/docs/Web/API/URL_Pattern_API) for
// everything but the query, which the filter matches param by param: ":name" matches one path
// segment (or a part of the host), "*" any text, "/" included, "(a|b)" a regular expression. A
// pattern starting with "/" is just a path, on any origin.
// -------------------------------------------------------------------------------------------------

const patternCache = new Map<string, URLPattern | Error>();
function compile(text: string): URLPattern | Error {
    let p = patternCache.get(text);
    if (!p) {
        try {
            p = text.startsWith("/") ? new URLPattern({ pathname: text }) : new URLPattern(text);
            if (p.search !== "*" || p.hash !== "*") p = new Error("Match query params with the conditions below the pattern, not in it");
        } catch (e) {
            p = new Error(`Not a URL pattern: ${(e as Error).message}`);
        }
        patternCache.set(text, p);
    }
    return p;
}
const compiled = (text: string) => { const p = compile(text); return p instanceof Error ? undefined : p; };

/** A name for a `:name` at segment `i`: after the segment before it ("groups" → "group"), unique in the pattern. */
export function segmentName(segments: string[], i: number, taken: string[]): string {
    const before = (segments[i - 1] ?? "").replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ?? "").toUpperCase()).replace(/(?<=[a-z]{3}[^su])s$/, "");
    const base = /^[A-Za-z]+$/.test(before) ? before : `part${i + 1}`;
    let name = base;
    for (let n = 2; taken.includes(name); n++) name = `${base}${n}`;
    return name;
}

/** What's wrong with a URL pattern, if anything. */
export function urlPatternError(text: string): string | undefined {
    const p = compile(text);
    return p instanceof Error ? p.message : undefined;
}

/** A URL pattern's special characters escaped, to match `text` as is. */
export const escapePattern = (text: string) => text.replace(/[:*?+(){}\\]/g, "\\$&");

/** A filter in words; without its query conditions when `pathOnly` ("Hide query and hash": a URL pattern has no query or hash of its own). */
export function describeFilter(filter: Filter, pathOnly = false): string {
    const parts: string[] = [];
    if (filter.method) parts.push(filter.method);
    let target = filter.url === undefined ? "*" : filter.url.replace(/^https?:\/\//, "");
    const query = pathOnly ? [] : Object.entries(filter.query ?? {});
    if (query.length) target += "?" + query.map(([k, v]) => `${k}=${v}`).join("&");
    parts.push(target);
    if (filter.bodyContains) parts.push(`body∋"${filter.bodyContains}"`);
    return parts.join(" ");
}

export function describeAction(action: Action): string {
    const after = (ms: number) => (ms ? ` after ${ms}ms` : "");
    switch (action.type) {
        case "request":
            if (action.mode === "ask") return "pause request";
            if (action.mode === "respond") return `mock ${action.response.status}${after(action.delayMs)}`;
            if (action.response) return `${Object.keys(action.edit).length ? "auto-edit request, " : ""}auto-replace response: ${action.response.status}${after(action.delayMs)}`;
            return Object.keys(action.edit).length ? `auto-edit request${after(action.delayMs)}` : `delay ${action.delayMs}ms`;
        case "response":
            return action.mode === "ask" ? "pause response" : `auto-replace response: ${action.response.status}${after(action.delayMs)}`;
        case "hide": return "hide from list";
        case "favourite": return "★ pin in list";
        case "fold": return "fold in list";
    }
}
