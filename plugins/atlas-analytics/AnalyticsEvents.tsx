import { useMemo, useState } from "react";
import { EntityOr } from "../../ui/entities/Capsule";

// -------------------------------------------------------------------------------------------------
// ANALYTICS EVENTS
// What Atlas' analytics calls say, above their request body: Atlas tracks through Heliotrope
// (@mongodb-js/heliotrope), a wrapper of Segment's analytics.js that posts its events to
// api.blue.mongodb.com/v1/<t|p|i|g|a|s> (track, page, identify, group, alias, screen) or /b (a
// batch). Heliotrope and Atlas merge the same properties into every event (app, URL, user agent,
// campaign cookies, org/project/user ids): shown apart, so what's left is what the call itself sent.
// The rest is folded away below it, a section each: the page (org, project, URL parts), the user
// and their device, Segment's own `context` (at the message's root) and destinations, the A/B
// test assignments (three parallel lists, one entry per assignment: mms
// abTestUtil.getAbTestPersistedProps; long, so with a search), the campaign cookies.
// -------------------------------------------------------------------------------------------------

const ANALYTICS_URL = new URLPattern("https://api.blue.mongodb.com/v1/*");

export const isAnalyticsRequest = (url: string) => ANALYTICS_URL.test(url);

const TYPE_BY_PATH: Record<string, string> = {
    t: "track", p: "page", i: "identify", g: "group", a: "alias", s: "screen",
    track: "track", page: "page", identify: "identify", group: "group", alias: "alias", screen: "screen",
};

/**
 * Merged into every event by Heliotrope (URL parts, user agent, mongodb.com cookies) or Atlas
 * (persisted ids), each shown in its section: the page, the user, the campaign cookies.
 */
const PAGE_PROPERTIES = ["url", "path", "hash", "search", "referrer", "title"];
const STANDARD = new Set([
    ...PAGE_PROPERTIES, "appId", "org_id", "group_id",
    "userAgent", "auid", "cloud_user_id",
    "external_referrer", "utm_campaign", "utm_source", "utm_term", "utm_medium", "utm_content", "optimizelyEndUserId", "tck",
]);
/** The standard properties that are mongodb.com's campaign cookies (Heliotrope's dotComCookie). */
const CAMPAIGN = /^(external_referrer|utm_\w+|optimizelyEndUserId|tck)$/;

/** Parallel lists, one entry per A/B test assignment; `test_assignments`: "test_<name>_variant_<group>". */
const ASSIGNMENT_FIELDS = ["test_assignments", "experiment_ids", "experiment_variant_ids"] as const;
type AssignmentField = (typeof ASSIGNMENT_FIELDS)[number];
const LISTED = new Set<string>(ASSIGNMENT_FIELDS);

export interface AnalyticsEvent {
    type: string;
    /** track: the event; page/screen: category and name; group: the group id; alias: previous → new id. */
    name?: string;
    time?: string;
    /** Where in Atlas it happened: the `context` property most of Atlas' events have ("Org Settings Page"…). */
    context?: string;
    /** What the user did: the `action` property many of Atlas' events have. */
    action?: string;
    /** Where it happened: org, project, app, then the page's URL parts. */
    page: [string, unknown][];
    /** The page section in short: the path and route. */
    pageSummary?: string;
    /** The call's own properties (identify, group: traits), but the assignments. */
    fields: [string, unknown][];
    /** The A/B test assignment lists it has. */
    assignments: Partial<Record<AssignmentField, string[]>>;
    /** The mongodb.com campaign cookies merged into it (`utm_*`, `tck`…). */
    campaign: [string, unknown][];
    /** Where Segment sends it (its `integrations`), then its `context` (the message's, not the property), flattened: `library.version`…; the page's and user's parts aside. */
    segmentContext: [string, unknown][];
    /** Who sent it, from what: ids, browser, OS, platform, locale, screen… */
    user: [string, unknown][];
    /** The user section in short: "Chrome 131 · macOS · en-US". */
    userSummary?: string;
}

/** Event properties about the user and their device (Atlas adds `browser_name`, `os_versionName`, `platform_vendor`, `email`…). */
const USER_PROPERTY = /^(browser|os|platform|device|screen)_|^(email|first_name|last_name|username)$/i;

/** Segment `context` keys about the user's device and place: shown with the user, not the rest of the context. */
const USER_CONTEXT = /^(userAgent|userAgentData|locale|timezone|screen|ip|device|os|network)(\.|$)/;

type Json = Record<string, any>;

const str = (v: unknown) => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined);

/** The events an analytics request sends (`body`: its whole request body); an error message when it can't be read. */
export function parseAnalytics(url: string, body: string): AnalyticsEvent[] | string {
    let json: unknown;
    try {
        json = JSON.parse(body);
    } catch {
        return "The body isn't JSON.";
    }
    if (!json || typeof json !== "object") return "The body isn't a JSON object.";
    const pathType = TYPE_BY_PATH[new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? ""];
    const messages: Json[] = Array.isArray((json as Json).batch) ? (json as Json).batch : [json];
    return messages.filter((m) => m && typeof m === "object").map((m) => toEvent(m, pathType));
}

function toEvent(m: Json, pathType: string | undefined): AnalyticsEvent {
    const type = str(m.type) ?? pathType ?? "event";
    const props: Json = (type === "identify" || type === "group" ? m.traits ?? m.context?.traits : m.properties) ?? {};
    const name = type === "track" ? str(m.event)
        : type === "page" || type === "screen" ? [str(m.category), str(m.name) ?? str(props.name)].filter(Boolean).join(" / ") || undefined
            : type === "group" ? str(m.groupId)
                : type === "alias" ? `${str(m.previousId) ?? "?"} → ${str(m.userId) ?? "?"}` : undefined;
    const keys = Object.keys(props);
    const context = str(props.context);
    const action = str(props.action);
    const segmentContext: [string, unknown][] = m.context && typeof m.context === "object" ? flatten(m.context) : [];
    const pageContext = (key: string) => segmentContext.find(([k]) => k === `page.${key}`)?.[1];
    const pageParts: [string, unknown][] = PAGE_PROPERTIES.map((k) => [k, k in props ? props[k] : pageContext(k)]);
    const destinations = describeIntegrations(m.integrations);
    const { user, userSummary } = describeUser(m, props, segmentContext.filter(([k]) => USER_CONTEXT.test(k)),
        keys.filter((k) => USER_PROPERTY.test(k)).sort().map((k) => [k, props[k]]));
    return {
        type,
        name,
        time: str(m.timestamp) ?? str(m.originalTimestamp) ?? str(m.sentAt),
        context,
        action,
        page: ([["org", str(props.org_id)], ["project", str(props.group_id)], ["app", str(props.appId)], ...pageParts] as [string, unknown][])
            .filter(([, v]) => v !== undefined),
        pageSummary: [str(props.path) ?? str(pageContext("path")), str(props.hash)].filter(Boolean).join("") || undefined,
        fields: keys.filter((k) => !STANDARD.has(k) && !LISTED.has(k) && !(k === "context" && context) && !(k === "action" && action) && !USER_PROPERTY.test(k)).sort().map((k) => [k, props[k]]),
        assignments: Object.fromEntries(ASSIGNMENT_FIELDS.flatMap((k) => {
            const list = toList(props[k]);
            return list ? [[k, list]] : [];
        })),
        campaign: keys.filter((k) => CAMPAIGN.test(k)).sort().map((k) => [k, props[k]]),
        segmentContext: [
            ...(destinations ? [["destinations", destinations] as [string, unknown]] : []),
            ...segmentContext.filter(([k]) => !USER_CONTEXT.test(k) && !k.startsWith("page.")),
        ],
        user,
        userSummary,
    };
}

/**
 * The user's ids, then what they used. `device`: Segment context about it, flattened; `own`: the
 * event's properties about them (`browser_name`, `email`…).
 */
function describeUser(m: Json, props: Json, device: [string, unknown][], own: [string, unknown][]): { user: [string, unknown][]; userSummary?: string } {
    const get = (key: string) => device.find(([k]) => k === key)?.[1];
    const ua = str(get("userAgent")) ?? str(props.userAgent);
    const parsed = ua ? parseUserAgent(ua) : {};
    // Client Hints, when the browser sent them, over the user-agent string
    const brands = (m.context?.userAgentData?.brands as { brand?: string; version?: string }[] | undefined)
        ?.filter((b) => b.brand && !/not.?a.?brand|chromium/i.test(b.brand)).map((b) => `${b.brand} ${b.version ?? ""}`.trim());
    const named = str(props.browser_name) && `${props.browser_name} ${str(props.browser_version)?.split(".")[0] ?? ""}`.trim();
    const browser = brands?.length ? brands.join(", ") : named || parsed.browser;
    const os = str(get("userAgentData.platform")) ?? str(props.os_name) ?? parsed.os;
    const mobile = get("userAgentData.mobile");
    const screen = get("screen.width") !== undefined ? `${get("screen.width")}×${get("screen.height")}${get("screen.density") ? ` @${get("screen.density")}x` : ""}` : undefined;
    const user: [string, unknown][] = [
        ["user id", str(m.userId)],
        ["anonymous id", str(m.anonymousId)],
        ["auid", str(props.auid) !== str(m.userId) ? str(props.auid) : undefined],
        ["cloud user", str(props.cloud_user_id)],
        ["browser", browser],
        ["os", os],
        ["mobile", typeof mobile === "boolean" ? (mobile ? "yes" : "no") : undefined],
        ["locale", str(get("locale"))],
        ["timezone", str(get("timezone"))],
        ["screen", screen],
        ["ip", str(get("ip"))],
    ];
    const shown = new Set(["userAgent", "userAgentData.platform", "userAgentData.mobile", "userAgentData.brands", "locale", "timezone", "screen.width", "screen.height", "screen.density", "ip"]);
    const rest = device.filter(([k]) => !shown.has(k));
    return {
        user: [...user.filter(([, v]) => v !== undefined), ...own, ...rest, ...(ua ? [["user agent", ua] as [string, unknown]] : [])],
        userSummary: [str(props.email), browser, os, str(get("locale"))].filter(Boolean).join(" · ") || undefined,
    };
}

/** The browser and OS a user-agent string names, roughly: "Chrome 131", "macOS 10.15". */
export function parseUserAgent(ua: string): { browser?: string; os?: string } {
    const v = (re: RegExp) => re.exec(ua)?.[1];
    const browser = v(/Edg\/(\d+)/) ? `Edge ${v(/Edg\/(\d+)/)}`
        : v(/OPR\/(\d+)/) ? `Opera ${v(/OPR\/(\d+)/)}`
            : v(/Firefox\/(\d+)/) ? `Firefox ${v(/Firefox\/(\d+)/)}`
                : v(/(?:Chrome|CriOS)\/(\d+)/) ? `Chrome ${v(/(?:Chrome|CriOS)\/(\d+)/)}`
                    : v(/Version\/([\d.]+).*Safari/) ? `Safari ${v(/Version\/([\d.]+).*Safari/)}` : undefined;
    const os = /iPhone|iPad/.test(ua) ? `iOS ${(v(/OS (\d+[_\d]*)/) ?? "").replace(/_/g, ".")}`.trim()
        : /Android/.test(ua) ? `Android ${v(/Android ([\d.]+)/) ?? ""}`.trim()
            : /Mac OS X/.test(ua) ? `macOS ${(v(/Mac OS X (\d+[_\d]*)/) ?? "").replace(/_/g, ".")}`.trim()
                : /Windows NT/.test(ua) ? `Windows ${v(/Windows NT ([\d.]+)/) ?? ""}`.trim()
                    : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : undefined;
    return { browser, os };
}

/** `{ page: { title: "x" } }` → `[["page.title", "x"]]`; arrays (and objects past `depth`) stay whole. */
function flatten(o: Json, prefix = "", depth = 3): [string, unknown][] {
    return Object.entries(o).flatMap(([k, v]): [string, unknown][] =>
        v && typeof v === "object" && !Array.isArray(v) && depth > 1 && Object.keys(v).length
            ? flatten(v, `${prefix}${k}.`, depth - 1)
            : [[`${prefix}${k}`, v]]);
}

/** An array, or a comma-separated string, as strings. */
function toList(v: unknown): string[] | undefined {
    if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
    if (typeof v === "string") return v.split(",").map((x) => x.trim()).filter(Boolean);
    return undefined;
}

/** `{ All: false, Amplitude: {…}, Intercom: false }` → "only Amplitude · not Intercom". */
function describeIntegrations(integrations: unknown): string | undefined {
    if (!integrations || typeof integrations !== "object") return undefined;
    const entries = Object.entries(integrations as Json).filter(([k]) => k !== "All");
    const on = entries.filter(([, v]) => v !== false).map(([k]) => k);
    const off = entries.filter(([, v]) => v === false).map(([k]) => k);
    const allOff = (integrations as Json).All === false;
    const parts = [on.length ? `${allOff ? "only " : ""}${on.join(", ")}` : allOff ? "none" : "", off.length ? `not ${off.join(", ")}` : ""];
    return parts.filter(Boolean).join(" · ") || undefined;
}

const MAX_EVENTS = 50;

/** Above an analytics request's body: its events, the important parts first. Nothing for other requests. */
export function AnalyticsEvents({ url, body, complete }: { url: string; body: string; complete: boolean }) {
    const matches = isAnalyticsRequest(url);
    const parsed = useMemo(() => (matches && complete && body ? parseAnalytics(url, body) : null), [matches, complete, url, body]);
    if (!matches) return null;
    return (
        <section className="aip-details-section aia-box">
            <h4>Analytics{Array.isArray(parsed) && parsed.length > 1 ? ` · ${parsed.length} events` : ""}</h4>
            {!body ? <div className="aip-hint">No body.</div>
                : !complete ? <div className="aip-hint">Load the whole body below to read its events.</div>
                    : typeof parsed === "string" ? <div className="aip-hint">{parsed}</div>
                        : parsed && <>
                            {parsed.slice(0, MAX_EVENTS).map((event, i) => <EventCard key={i} event={event} />)}
                            {parsed.length > MAX_EVENTS && <div className="aip-hint">And {parsed.length - MAX_EVENTS} more in the body below.</div>}
                        </>}
        </section>
    );
}

/** What a call's name is, by its type. */
const NAME_LABEL: Record<string, string> = { track: "event", page: "name", screen: "name", group: "group", alias: "alias" };

function EventCard({ event: e }: { event: AnalyticsEvent }) {
    const context: [string, React.ReactNode][] = [];
    if (e.name) context.push([NAME_LABEL[e.type] ?? "name", <strong>{e.name}</strong>]);
    if (e.context) context.push(["context", <strong>{e.context}</strong>]);
    if (e.action) context.push(["action", <strong>{e.action}</strong>]);
    return (
        <div className="aia-event">
            <div className="aia-head">
                <span className={`aia-type ${e.type}`}>{e.type}</span>
                {e.time && <span className="aip-hint" title={e.time}>{formatTime(e.time)}</span>}
            </div>
            {context.length > 0 && (
                <div className="aia-context">
                    {context.map(([k, v]) => <span key={k} className="aia-ctx"><span className="aia-ctx-key">{k}</span>{v}</span>)}
                </div>
            )}
            {e.fields.length > 0
                ? <Rows rows={e.fields.map(([k, v]) => [k, formatValue(v)])} />
                : <div className="aip-hint">No {e.type === "identify" || e.type === "group" ? "traits" : "properties"} of its own.</div>}
            <Fold title="Page" summary={e.pageSummary} rows={e.page} />
            <Fold title="User & device" summary={e.userSummary} rows={e.user} />
            <Fold title="Segment context" summary={[...new Set(e.segmentContext.map(([k]) => k.split(".")[0]))].join(", ")} rows={e.segmentContext} />
            {Object.keys(e.assignments).length > 0 && <Assignments lists={e.assignments} />}
            <Fold title="Campaign cookies" summary={e.campaign.map(([k]) => k).join(", ")} rows={e.campaign} />
        </div>
    );
}

/** Ids shown as entity capsules (a name when Atlas knows it), by row. */
const ENTITY_BEFORE: Record<string, string> = { org: "orgs", project: "groups", "cloud user": "users" };

/** A section folded by default: its title and `summary`, then its `rows`; nothing without rows. */
function Fold({ title, summary, rows }: { title: string; summary?: string; rows: [string, unknown][] }) {
    if (!rows.length) return null;
    return (
        <details className="aia-fold">
            <summary>
                <span className="aia-fold-title">{title}</span>
                {summary && <span className="aip-hint">{summary}</span>}
            </summary>
            <div className="aia-list">
                <Rows rows={rows.map(([k, v]) => [k, ENTITY_BEFORE[k] && typeof v === "string" ? <EntityOr text={v} before={ENTITY_BEFORE[k]} /> : formatValue(v)])} />
            </div>
        </details>
    );
}

/** The A/B test assignments: a row each (the lists are parallel), filtered by every word typed. */
function Assignments({ lists }: { lists: Partial<Record<AssignmentField, string[]>> }) {
    const [search, setSearch] = useState("");
    const fields = ASSIGNMENT_FIELDS.filter((k) => lists[k]);
    const lengths = fields.map((k) => lists[k]!.length);
    const total = Math.max(...lengths);
    const rows = useMemo(() => Array.from({ length: total }, (_, i) => fields.map((k) => lists[k]![i] ?? "")), [lists]); // eslint-disable-line react-hooks/exhaustive-deps
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = words.length ? rows.filter((row) => { const text = row.join(" ").toLowerCase(); return words.every((w) => text.includes(w)); }) : rows;
    return (
        <details className="aia-fold aia-assignments">
            <summary>
                <span className="aia-fold-title" title={fields.join(", ")}>A/B test assignments</span>
                <span className="aip-hint">{total}</span>
            </summary>
            <div className="aia-assignments-head">
                <input className="aia-search" type="search" placeholder="Filter…" value={search} onChange={(ev) => setSearch(ev.target.value)}
                    // the palette's keys (tabs, selection, Esc to close) aren't for this box; Esc clears it first
                    onKeyDown={(ev) => { if (ev.key !== "Escape" || search) ev.stopPropagation(); if (ev.key === "Escape" && search) setSearch(""); }} />
                <span className="aip-hint">{shown.length === total ? total : `${shown.length} of ${total}`}</span>
            </div>
            {new Set(lengths).size > 1 && <div className="aip-hint">The lists have different lengths ({fields.map((k, i) => `${k}: ${lengths[i]}`).join(", ")}): rows may not line up.</div>}
            <div className="aia-list">
                <table className="aip-table">
                    <thead><tr>{fields.map((k) => <th key={k}>{k}</th>)}</tr></thead>
                    <tbody>
                        {shown.map((row, i) => (
                            <tr key={i}>{row.map((cell, j) => <td key={j}>{fields[j] === "test_assignments" ? <Assignment text={cell} /> : cell}</td>)}</tr>
                        ))}
                    </tbody>
                </table>
                {!shown.length && <div className="aip-hint">No assignment matches.</div>}
            </div>
        </details>
    );
}

/** "test_<name>_variant_<group>": the name, and the group as a badge. */
function Assignment({ text }: { text: string }) {
    const m = /^test_(.+)_variant_(.+)$/.exec(text);
    return m ? <span title={text}>{m[1]} <span className="aia-variant">{m[2]}</span></span> : <>{text}</>;
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
    if (!rows.length) return null;
    return <table className="aip-table"><tbody>{rows.map(([k, v], i) => <tr key={i}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>;
}

const formatValue = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

function formatTime(iso: string) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

/** Styles for {@link AnalyticsEvents}; part of the palette's CSS. */
export const ANALYTICS_EVENTS_CSS = `
.aia-box { border: 1px solid var(--wt-purple-border); background: var(--wt-purple-bg); border-radius: 8px; padding: 2px 10px 8px; }
.aia-box h4 { color: var(--wt-purple); }
.aia-event { display: flex; flex-direction: column; gap: 4px; padding: 6px 0; }
.aia-event + .aia-event { border-top: 1px dashed var(--wt-purple-border); }
.aia-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.aia-type { flex: none; font-size: 10px; line-height: 14px; text-transform: uppercase; letter-spacing: .4px; padding: 0 5px; border-radius: 4px; background: var(--wt-purple); color: var(--wt-surface); }
.aia-type.page, .aia-type.screen { background: var(--wt-blue); }
.aia-type.identify, .aia-type.group, .aia-type.alias { background: var(--wt-text-muted); }
.aia-context { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; }
.aia-ctx { display: inline-flex; align-items: baseline; gap: 4px; min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.aia-ctx-key { flex: none; font-size: 9px; font-weight: 600; line-height: 14px; text-transform: uppercase; letter-spacing: .4px; padding: 0 5px; border-radius: 7px; background: var(--wt-surface); border: 1px solid var(--wt-purple-border); color: var(--wt-purple); }
.aia-fold > summary { display: flex; align-items: baseline; gap: 6px; cursor: pointer; list-style: none; }
.aia-fold > summary::-webkit-details-marker { display: none; }
.aia-fold > summary::before { content: "▸"; flex: none; width: 10px; color: var(--wt-purple); transition: transform .12s; }
.aia-fold[open] > summary::before { transform: rotate(90deg); }
.aia-fold > summary .aip-hint { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aia-fold[open] > summary { margin-bottom: 4px; }
.aia-assignments[open] { display: flex; flex-direction: column; gap: 4px; }
.aia-assignments-head { display: flex; align-items: center; gap: 8px; }
.aia-fold-title { font-size: 11px; font-weight: 600; color: var(--wt-purple); white-space: nowrap; }
.aia-search { flex: 1; min-width: 0; padding: 2px 6px; border: 1px solid var(--wt-purple-border); border-radius: 4px; background: var(--wt-surface); color: inherit; font: 12px system-ui, -apple-system, sans-serif; }
.aia-list { max-height: 220px; overflow: auto; border: 1px solid var(--wt-purple-border); border-radius: 4px; background: var(--wt-surface); padding: 2px 6px; }
.aia-list .aip-table { width: max-content; min-width: 100%; }
.aia-list .aip-table th, .aia-list .aip-table td { white-space: nowrap; word-break: normal; padding-right: 14px; }
.aia-list thead th { position: sticky; top: 0; background: var(--wt-surface); }
.aia-variant { font-size: 10px; padding: 0 4px; border-radius: 4px; background: var(--wt-purple-bg); color: var(--wt-purple); }
`;
