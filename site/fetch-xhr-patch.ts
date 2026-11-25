import { tweak } from "tangitweak";
import { sleep } from "../shared/util/async";
import { newId } from "../shared/util/id";
import { matches } from "../domain/filter";
import { MAX_LOGGED_BODY } from "../domain/log";
import type { Action, MockResponse, Pause, RequestDecision, RequestEdit, ResponseDecision, SiteRule, SiteState } from "../domain/types";
import { appliesTo, type InterceptorPlugin, type SitePart } from "../plugin";
import { Journal, parseHeaderLines, type Transaction } from "./journal";
import { recordClicks } from "./clicks";
import { patchNavigation } from "./navigation";
import { MAX_PAUSED_BODY, waitForDecision } from "./pauses";
import { SiteEvents } from "./site-events";

// -------------------------------------------------------------------------------------------------
// SITE PATCH
// The page's own fetch/XHR, patched (a `tweak.onSite` handler): every request is logged (reported to
// the page's log, see ./site-events.ts) and recorded in full (./journal.ts), and the rules run
// here: delays, pauses (a request can wait as long as the user takes and be changed entirely:
// method, URL, headers, body, or answered; a response's status and body), edits and responses.
// -------------------------------------------------------------------------------------------------

// response bodies that can be shown and edited as text
const TEXT_MIME = /json|text|xml|javascript|graphql|x-www-form-urlencoded|yaml/i;


interface Plan {
    /** every matching rule, hide rules included (the log shows them) */
    ruleIds: string[];
    /** the delays of every matching request rule, added up */
    delayMs: number;
    /** the first request rule that changes something (asks, edits or responds): it decides the request */
    requestRule?: SiteRule;
    /** the first response rule: it decides the response */
    responseRule?: SiteRule;
    /** the delays of every matching response rule, added up */
    responseDelayMs: number;
}

const delayOf = (a: Action) => ("delayMs" in a ? a.delayMs : 0);
// a send rule that edits nothing (and doesn't replace the response) is only its delay
const changesRequest = (a: Action) => a.type === "request" && (a.mode !== "send" || Object.keys(a.edit).length > 0 || !!a.response);

function planFor(rules: SiteRule[], method: string, url: string, body: string | undefined): Plan {
    const matching = rules.filter((r) => matches(r.filter, method, url, body));
    const requestRules = matching.filter((r) => r.action.type === "request");
    const responseRules = matching.filter((r) => r.action.type === "response");
    return {
        ruleIds: matching.map((r) => r.id),
        delayMs: requestRules.reduce((ms, r) => ms + delayOf(r.action), 0),
        requestRule: requestRules.find((r) => changesRequest(r.action)),
        responseRule: responseRules[0],
        responseDelayMs: responseRules.reduce((ms, r) => ms + delayOf(r.action), 0),
    };
}

const acts = (p: Plan) => !!(p.delayMs || p.requestRule || p.responseRule || p.responseDelayMs);

/** Whether a rule would match but for its body condition: then the body must be read first. */
const needsBody = (rules: SiteRule[], method: string, url: string) =>
    rules.some((r) => r.filter.bodyContains && matches({ ...r.filter, bodyContains: undefined }, method, url, undefined));

const hasBody = (method: string) => !["GET", "HEAD"].includes(method.toUpperCase());

async function pause<D>(site: SiteState, rule: SiteRule, fields: Omit<Extract<Pause, { stage: "request" }>, "id" | "ruleId" | "ruleName" | "createdAt"> | Omit<Extract<Pause, { stage: "response" }>, "id" | "ruleId" | "ruleName" | "createdAt">): Promise<D | undefined> {
    const id = newId();
    site.pauses[id] = { ...fields, id, ruleId: rule.id, ruleName: rule.name, createdAt: Date.now() } as Pause;
    const decision = await waitForDecision<D>(site.pauses, id);
    // a plain copy: the store's copy goes away with the pause
    return decision === undefined ? undefined : JSON.parse(JSON.stringify(decision));
}

/** What the rule does to the request: its edit or response, or else (asking) the user's decision. */
function decideRequest(site: SiteState, rule: SiteRule, request: RequestEdit, logId: string | undefined): Promise<RequestDecision | undefined> {
    const a = rule.action;
    if (a.type === "request" && a.mode === "send") {
        // a response to replace: the response goes through this rule (see replacement)
        const pauseResponse = !!a.response;
        return Promise.resolve(Object.keys(a.edit).length ? { kind: "modify", request: { ...request, ...a.edit }, pauseResponse } : { kind: "continue", pauseResponse });
    }
    if (a.type === "request" && a.mode === "respond") return Promise.resolve({ kind: "respond", ...a.response });
    return pause<RequestDecision>(site, rule, { stage: "request", logId, request: { ...request, body: request.body?.slice(0, MAX_PAUSED_BODY) } });
}

/** The response a rule gives without pausing: a replace rule's, or a send rule's that also replaces it. */
function replacement(rule: SiteRule): Extract<ResponseDecision, { kind: "modify" }> | undefined {
    const a = rule.action;
    if (a.type === "response" && a.mode === "replace") return { kind: "modify", ...a.response };
    if (a.type === "request" && a.mode === "send" && a.response) return { kind: "modify", ...a.response };
    return undefined;
}

const editedOutcome = (rule: SiteRule) => (rule.action.type === "request" && rule.action.mode === "send" ? "edited (by the rule)" : "edited");
const respondedOutcome = (r: MockResponse) => `responded ${r.status}`;

/**
 * `tweak.onSite` handler body: patches `fetch` and `XMLHttpRequest`, and runs the site parts of the
 * plugins for this page (../plugin.ts); returns the handle functions that read the recorded
 * transactions, the events for the page's log, and the plugins' calls.
 */
export function installSitePatches(ctx: TangiTweak.SiteCtx, site: SiteState, plugins: readonly InterceptorPlugin[]) {
    // both survive script saves
    const journal = ctx.once("api-interceptor-journal", () => new Journal());
    const events = ctx.once("api-interceptor-events", () => new SiteEvents());
    const checkNavigation = window === window.top ? patchNavigation(ctx, events) : undefined;
    if (window === window.top) recordClicks(ctx, site, events);
    const parts = new Map<string, SitePart>();
    // a plugin switched off in ⋯ → Plugins: its part still starts (the switch isn't known this early), but nothing it reports or answers counts
    const isOff = (id: string) => site.pluginsOff?.includes(id) === true;
    for (const plugin of plugins) {
        if (!plugin.site || !appliesTo(plugin, location.href)) continue;
        try {
            const part = plugin.site(ctx, { emit: (e) => { if (!isOff(plugin.id)) events.emit(e); }, checkNavigation, options: <T>() => site.plugins?.[plugin.id] as T | undefined, isOn: () => !isOff(plugin.id) });
            if (part) parts.set(plugin.id, part);
        } catch (e) {
            tweak.log(`[tangiray] plugin "${plugin.id}" failed to start`, String(e));
        }
    }
    const log = new RequestLog(events, () => [...parts].filter(([id]) => !isOff(id)).map(([, part]) => part), checkNavigation);
    patchFetch(ctx, site, journal, log);
    const xhrProto = xhrPrototype();
    if (xhrProto) patchXhr(ctx, xhrProto, site, journal, log);
    else tweak.log("[tangiray] this page's XMLHttpRequest can't be patched: its XHR calls aren't logged");
    return {
        transaction: (method: string, urls: string[], startedAt: number, logId?: string) => journal.find(method, urls, startedAt, logId),
        transactionBody: (id: number, kind: "request" | "response", offset: number) => journal.body(id, kind, offset),
        call: (plugin: string, name: string, args: unknown[]) => {
            const fn = isOff(plugin) ? undefined : parts.get(plugin)?.rpc?.[name];
            if (!fn) throw new Error(`plugin "${plugin}" has no "${name}" here${isOff(plugin) ? " (switched off)" : ""}`);
            return fn(...args);
        },
        nextEvents: () => events.next(),
    };
}

/** Reports requests and their responses to the page's log. */
class RequestLog {
    /** `parts`: the site parts of the plugins switched on, read for each response */
    constructor(private events: SiteEvents, private parts: () => SitePart[], private checkNavigation?: () => void) {}

    /** Logs a request starting; returns its log id. */
    request(method: string, url: string, headers: Record<string, string>, body: string | undefined, ruleIds: string[]): { id: string; startedAt: number } {
        this.checkNavigation?.();
        const entry = { id: newId(), method: method.toUpperCase(), url, headers, body: body?.slice(0, MAX_LOGGED_BODY), startedAt: Date.now(), ruleIds };
        this.events.emit({ kind: "request", request: entry });
        return entry;
    }

    update(id: string, patch: Extract<Parameters<SiteEvents["emit"]>[0], { kind: "update" }>["patch"]) {
        this.events.emit({ kind: "update", id, patch });
    }

    response(entry: { id: string; startedAt: number }, status: number, mime: string | undefined) {
        this.update(entry.id, { status, mime: mime || undefined, durationMs: Date.now() - entry.startedAt });
    }

    /** The plugins that read `url`'s JSON response. */
    jsonReaders(url: string, mime: string) {
        return /json/i.test(mime) ? this.parts().filter((p) => p.json && p.readsJson?.(url)) : [];
    }

    json(readers: SitePart[], url: string, value: unknown) {
        for (const p of readers) {
            try { p.json!(url, value); } catch (e) { tweak.log("[tangiray] a plugin failed to read a response", url, String(e)); }
        }
    }

    jsonFromText(readers: SitePart[], url: string, text: string) {
        let value: unknown;
        try { value = JSON.parse(text); } catch { tweak.log("[tangiray] a plugin wanted a non-JSON response", url); return; }
        this.json(readers, url, value);
    }
}

function describeBody(body: unknown): string | undefined {
    if (body == null) return undefined;
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) return `(form data: ${[...body.keys()].join(", ")})`;
    if (body instanceof Blob) return `(blob, ${body.size} bytes)`;
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return `(binary, ${(body as ArrayBuffer).byteLength} bytes)`;
    return `(${Object.prototype.toString.call(body)})`;
}

// -------------------------------------------------------------------------------------------------
// FETCH
// -------------------------------------------------------------------------------------------------

function patchFetch(ctx: TangiTweak.SiteCtx, site: SiteState, journal: Journal, log: RequestLog) {
    ctx.patch(window, "fetch", (orig) => async function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        let request: Request;
        try {
            request = new Request(input, init);
        } catch {
            return orig.call(this, input, init); // fetch itself reports it
        }
        // `new Request` took `input`'s (or a stream's) body: from here on only `request` can be sent
        const { method, url } = request;
        const headers = Object.fromEntries(request.headers);
        const txn = journal.begin(method, url, headers);
        // read the body now only when a rule needs it to decide; otherwise for the record, on the side
        const bodyRead = request.body ? request.clone().text().catch(() => undefined) : Promise.resolve(undefined);
        const body = needsBody(site.rules, method, url) ? await bodyRead : undefined;
        const plan = planFor(site.rules, method, url, body);
        const entry = log.request(method, url, headers, body, plan.ruleIds);
        txn.logId = entry.id;
        void bodyRead.then((text) => {
            journal.setBody(txn, "requestBody", text);
            if (text !== undefined && body === undefined) log.update(entry.id, { body: text.slice(0, MAX_LOGGED_BODY) });
        });
        try {
            const response = acts(plan) ? await intercept.call(this, orig, request, body, txn, plan, entry.id) : await orig.call(this, request);
            recordFetchResponse(journal, txn, response);
            log.response(entry, response.status, response.headers.get("content-type") ?? undefined);
            const mime = response.headers.get("content-type") ?? "";
            const readers = log.jsonReaders(response.url || url, mime);
            if (readers.length) response.clone().text().then((t) => log.jsonFromText(readers, url, t), () => {});
            return response;
        } catch (e) {
            journal.finish(txn, { error: String(e) });
            log.update(entry.id, { outcome: "network error", durationMs: Date.now() - entry.startedAt });
            throw e;
        }
    } as typeof fetch);

    async function intercept(this: unknown, orig: typeof fetch, request: Request, body: string | undefined,
        txn: Transaction, plan: Plan, logId: string): Promise<Response> {
        const { method, url } = request;
        if (plan.delayMs) await sleep(plan.delayMs);

        let sent: RequestEdit = { method, url, headers: Object.fromEntries(request.headers), body };
        let send = () => orig.call(this, request);
        let edited = false;
        let responseRule = plan.responseRule;
        if (plan.requestRule) {
            const decision = await decideRequest(site, plan.requestRule, sent, logId);
            if ((decision?.kind === "continue" || decision?.kind === "modify") && decision.pauseResponse) responseRule = plan.requestRule;
            if (decision?.kind === "block") {
                log.update(logId, { outcome: "blocked" });
                throw new TypeError("Failed to fetch (blocked by TangiRay)");
            }
            if (decision?.kind === "respond") {
                log.update(logId, { outcome: respondedOutcome(decision) });
                return new Response(decision.body, { status: decision.status, headers: { "content-type": decision.mime } });
            }
            if (decision?.kind === "modify") {
                sent = decision.request;
                edited = true;
                Object.assign(txn, { method: sent.method.toUpperCase(), url: sent.url, requestHeaders: { ...sent.headers } });
                journal.setBody(txn, "requestBody", sent.body);
                log.update(logId, { finalUrl: sent.url, outcome: editedOutcome(plan.requestRule) });
                send = () => orig.call(this, sent.url, {
                    method: sent.method, headers: sent.headers, body: hasBody(sent.method) ? sent.body : undefined,
                    credentials: request.credentials, mode: request.mode, cache: request.cache, redirect: request.redirect,
                    keepalive: request.keepalive, signal: request.signal,
                });
            }
        }

        const response = await send();
        if (plan.responseDelayMs) await sleep(plan.responseDelayMs);
        if (!responseRule) return response;
        let decision: ResponseDecision | undefined = replacement(responseRule);
        if (!decision) {
            const mime = response.headers.get("content-type") ?? "";
            const text = TEXT_MIME.test(mime) ? await response.clone().text() : undefined;
            if (text === undefined || text.length > MAX_PAUSED_BODY) {
                tweak.log(`[tangiray] "${responseRule.name}": not pausing a binary or over-256kB response`, url);
                return response;
            }
            decision = await pause<ResponseDecision>(site, responseRule, {
                stage: "response", logId, status: response.status, mime, body: text, request: { ...sent, body: sent.body?.slice(0, MAX_PAUSED_BODY) },
            });
        }
        if (decision?.kind !== "modify") return response;
        const replaced = new Response(decision.body, {
            status: decision.status,
            statusText: decision.status === response.status ? response.statusText : "",
            headers: response.headers,
        });
        Object.defineProperties(replaced, { url: { value: response.url }, redirected: { value: response.redirected } });
        return replaced;
    }
}

function recordFetchResponse(journal: Journal, txn: Transaction, response: Response) {
    journal.finish(txn, { status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers) });
    const mime = response.headers.get("content-type") ?? "";
    // a stream may never end, and binary isn't readable as text
    if (/event-stream/i.test(mime) || !TEXT_MIME.test(mime)) journal.setBody(txn, "responseBody", `(${mime || "untyped"} body, not recorded)`);
    else response.clone().text().then((t) => journal.setBody(txn, "responseBody", t), () => {});
}

// -------------------------------------------------------------------------------------------------
// XHR
// A request the rules act on is sent (possibly re-opened with edits or a rewritten URL) on the
// page's own XHR. A failure, or a paused response (which needs the body before the page sees it:
// an internal XHR fetches it), answers the page's XHR through faked properties and events.
// -------------------------------------------------------------------------------------------------

interface XhrInfo {
    method: string;
    url: string;
    async: boolean;
    headers: Record<string, string>;
    aborted?: boolean;
    inner?: XMLHttpRequest;
    txn?: Transaction;
    logId?: string;
}

const FAKED = ["readyState", "status", "statusText", "responseURL", "responseText", "response", "getResponseHeader", "getAllResponseHeaders"];

const XHR_METHODS = ["open", "setRequestHeader", "abort", "send"] as const;

/**
 * The prototype that holds the XHR methods the page's requests go through. A page (or a library on
 * it) may have swapped `XMLHttpRequest` for a wrapper whose own `prototype` lacks them, e.g. a
 * constructor that returns the original XHR: then they're on its instances' prototype.
 */
function xhrPrototype(): XMLHttpRequest | undefined {
    if (typeof XMLHttpRequest !== "function") return undefined;
    const hasAll = (p: unknown): p is XMLHttpRequest =>
        !!p && XHR_METHODS.every((m) => typeof (p as Record<string, unknown>)[m] === "function");
    if (hasAll(XMLHttpRequest.prototype)) return XMLHttpRequest.prototype;
    try {
        const p: unknown = Object.getPrototypeOf(new XMLHttpRequest());
        return hasAll(p) ? p : undefined;
    } catch {
        return undefined;
    }
}

function patchXhr(ctx: TangiTweak.SiteCtx, proto: XMLHttpRequest, site: SiteState, journal: Journal, log: RequestLog) {
    const info = new WeakMap<XMLHttpRequest, XhrInfo>();
    const internal = new WeakSet<XMLHttpRequest>();
    let open!: XMLHttpRequest["open"];
    let setHeader!: XMLHttpRequest["setRequestHeader"];
    let send!: XMLHttpRequest["send"];

    ctx.patch(proto, "open", (orig) => (open = orig, function (this: XMLHttpRequest, method: string, url: string | URL, async?: boolean, user?: string | null, password?: string | null) {
        for (const key of FAKED) delete (this as any)[key]; // a reused XHR: drop a previous fake answer
        info.set(this, { method: method.toUpperCase(), url: new URL(String(url), location.href).href, async: async !== false, headers: {} });
        return arguments.length <= 2 ? orig.call(this, method, url, true) : orig.call(this, method, url, async ?? true, user, password);
    } as XMLHttpRequest["open"]));

    ctx.patch(proto, "setRequestHeader", (orig) => (setHeader = orig, function (this: XMLHttpRequest, name: string, value: string) {
        const x = info.get(this);
        if (x) x.headers[name] = name in x.headers ? `${x.headers[name]}, ${value}` : value;
        return orig.call(this, name, value);
    }));

    ctx.patch(proto, "abort", (orig) => function (this: XMLHttpRequest) {
        const x = info.get(this);
        if (x) {
            x.aborted = true;
            x.inner?.abort();
        }
        return orig.call(this);
    });

    ctx.patch(proto, "send", (orig) => (send = orig, function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
        const x = info.get(this);
        if (!x || internal.has(this)) return orig.call(this, body);
        const bodyText = typeof body === "string" ? body : body instanceof URLSearchParams ? body.toString() : undefined;
        const described = describeBody(body);
        const txn = x.txn = journal.begin(x.method, x.url, { ...x.headers });
        journal.setBody(txn, "requestBody", described);
        const plan = planFor(site.rules, x.method, x.url, bodyText);
        const entry = log.request(x.method, x.url, { ...x.headers }, described, plan.ruleIds);
        txn.logId = x.logId = entry.id;
        this.addEventListener("loadend", () => {
            recordXhrResponse(journal, txn, this);
            if (!this.status) log.update(entry.id, { outcome: x.aborted ? "aborted" : "network error", durationMs: Date.now() - entry.startedAt });
            else {
                log.response(entry, this.status, this.getResponseHeader("content-type") ?? undefined);
                readXhrJson(log, this);
            }
        }, { once: true });
        if (!x.async || !acts(plan)) return orig.call(this, body);
        void run(this, x, body, bodyText, plan).catch((e) => tweak.log("[tangiray] XHR interception failed", x.url, String(e)));
    }));

    async function run(xhr: XMLHttpRequest, x: XhrInfo, body: Document | XMLHttpRequestBodyInit | null | undefined, bodyText: string | undefined, plan: Plan) {
        if (plan.delayMs) await sleep(plan.delayMs);
        if (x.aborted) return;

        let req: RequestEdit = { method: x.method, url: x.url, headers: { ...x.headers }, body: bodyText };
        let sendBody = body;
        let edited = false;
        let responseRule = plan.responseRule;
        if (plan.requestRule) {
            const decision = await decideRequest(site, plan.requestRule, req, x.logId);
            if (x.aborted) return;
            if ((decision?.kind === "continue" || decision?.kind === "modify") && decision.pauseResponse) responseRule = plan.requestRule;
            if (decision?.kind === "block") {
                log.update(x.logId!, { outcome: "blocked" });
                return answerWithError(xhr, "error");
            }
            if (decision?.kind === "respond") {
                log.update(x.logId!, { outcome: respondedOutcome(decision) });
                return answer(xhr, { status: decision.status, statusText: "", url: req.url, headers: `content-type: ${decision.mime}\r\n`, body: decision.body });
            }
            if (decision?.kind === "modify") {
                req = decision.request;
                sendBody = hasBody(req.method) ? req.body ?? null : null;
                edited = true;
                if (x.txn) {
                    Object.assign(x.txn, { method: req.method.toUpperCase(), url: req.url, requestHeaders: { ...req.headers } });
                    journal.setBody(x.txn, "requestBody", req.body);
                }
                log.update(x.logId!, { finalUrl: req.url, outcome: editedOutcome(plan.requestRule) });
            }
        }

        const textual = ["", "text", "json"].includes(xhr.responseType);
        if (!responseRule || !textual) {
            if (edited) {
                open.call(xhr, req.method, req.url, true);
                for (const [name, value] of Object.entries(req.headers)) setHeader.call(xhr, name, value);
                Object.assign(x, { method: req.method, url: req.url, headers: { ...req.headers } });
            }
            return send.call(xhr, sendBody);
        }

        const pausing = responseRule;
        const inner = new XMLHttpRequest();
        internal.add(inner);
        x.inner = inner;
        inner.open(req.method, req.url, true);
        inner.withCredentials = xhr.withCredentials;
        inner.timeout = xhr.timeout;
        for (const [name, value] of Object.entries(req.headers)) inner.setRequestHeader(name, value);
        inner.onerror = () => !x.aborted && answerWithError(xhr, "error");
        inner.ontimeout = () => !x.aborted && answerWithError(xhr, "timeout");
        inner.onload = async () => {
            const mime = inner.getResponseHeader("content-type") ?? "";
            let status = inner.status;
            let text = inner.responseText;
            if (plan.responseDelayMs) await sleep(plan.responseDelayMs);
            const replaced = replacement(pausing);
            if (replaced) ({ status, body: text } = replaced);
            else if (TEXT_MIME.test(mime) && text.length <= MAX_PAUSED_BODY) {
                const decision = await pause<ResponseDecision>(site, pausing, {
                    stage: "response", logId: x.logId, status, mime, body: text, request: { ...req, body: req.body?.slice(0, MAX_PAUSED_BODY) },
                });
                if (decision?.kind === "modify") ({ status, body: text } = decision);
            } else {
                tweak.log(`[tangiray] "${pausing.name}": not pausing a binary or over-256kB response`, req.url);
            }
            if (x.aborted) return;
            answer(xhr, {
                status, statusText: status === inner.status ? inner.statusText : "", url: inner.responseURL,
                headers: inner.getAllResponseHeaders(), body: text,
            });
        };
        inner.send(sendBody);
    }
}

function readXhrJson(log: RequestLog, xhr: XMLHttpRequest) {
    const url = xhr.responseURL;
    const readers = url ? log.jsonReaders(url, xhr.getResponseHeader("content-type") ?? "") : [];
    if (!readers.length) return;
    if (xhr.responseType === "json") log.json(readers, url, xhr.response);
    else if (xhr.responseType === "" || xhr.responseType === "text") log.jsonFromText(readers, url, xhr.responseText);
}

function recordXhrResponse(journal: Journal, txn: Transaction, xhr: XMLHttpRequest) {
    if (!xhr.status) {
        journal.finish(txn, { error: "network error, timeout or aborted" });
        return;
    }
    journal.finish(txn, { status: xhr.status, statusText: xhr.statusText, headers: parseHeaderLines(xhr.getAllResponseHeaders()) });
    const type = xhr.responseType;
    journal.setBody(txn, "responseBody", type === "" || type === "text" ? xhr.responseText
        : type === "json" ? JSON.stringify(xhr.response) : `(${type} response, not recorded)`);
}

function define(xhr: XMLHttpRequest, values: Record<string, unknown>) {
    for (const [key, value] of Object.entries(values)) Object.defineProperty(xhr, key, { value, configurable: true });
}

function answer(xhr: XMLHttpRequest, r: { status: number; statusText: string; url: string; headers: string; body: string }) {
    const headers = new Map(r.headers.trim().split(/\r?\n/).filter(Boolean).map((line) => {
        const at = line.indexOf(":");
        return [line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim()] as [string, string];
    }));
    let response: unknown = r.body;
    if (xhr.responseType === "json") {
        try { response = JSON.parse(r.body); } catch { response = null; }
    }
    define(xhr, {
        readyState: 4, status: r.status, statusText: r.statusText, responseURL: r.url, responseText: r.body, response,
        getResponseHeader: (name: string) => headers.get(name.toLowerCase()) ?? null,
        getAllResponseHeaders: () => r.headers,
    });
    const size = r.body.length;
    xhr.dispatchEvent(new Event("readystatechange"));
    xhr.dispatchEvent(new ProgressEvent("load", { lengthComputable: true, loaded: size, total: size }));
    xhr.dispatchEvent(new ProgressEvent("loadend", { lengthComputable: true, loaded: size, total: size }));
}

function answerWithError(xhr: XMLHttpRequest, type: "error" | "timeout") {
    define(xhr, { readyState: 4, status: 0, statusText: "", responseText: "", response: xhr.responseType === "" || xhr.responseType === "text" ? "" : null });
    xhr.dispatchEvent(new Event("readystatechange"));
    xhr.dispatchEvent(new ProgressEvent(type));
    xhr.dispatchEvent(new ProgressEvent("loadend"));
}
