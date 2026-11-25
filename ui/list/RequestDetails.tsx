import { useEffect, useMemo, useState } from "react";
import { activeElementIn } from "../../shared/ui/shadow-root";
import { describeAction, describeFilter, matches } from "../../domain/filter";
import type { EditorPrefs, LoggedRequest, Pause, Rule, TransactionSource } from "../../domain/types";
import type { TransactionSummary } from "../../site/journal";
import { useSnapshot } from "valtio";
import { livePlugins } from "../../plugin";
import { pluginSwitches } from "../../state";
import { Enriched, EntityOr } from "../entities/Capsule";
import { HeaderTable } from "./HeaderTable";
import { prettyJson } from "../format";

// -------------------------------------------------------------------------------------------------
// REQUEST DETAILS
// The whole transaction of the selected request, beside the list, read from the page's own record
// (../../site/journal.ts) when it's shown; bodies come in chunks, "Load more" fetches the rest.
// -------------------------------------------------------------------------------------------------

type BodyKind = "request" | "response";
/** bodies bigger than this aren't fetched or shown until asked for: they make hovering through the list sluggish */
const LAZY_BODY = 25 * 1024;

interface Shown {
    entry: LoggedRequest;
    foldKey?: string;
    /** null: not recorded in the page */
    txn: TransactionSummary | null;
    bodies: Record<BodyKind, string>;
    error?: string;
}

export function RequestDetails({ entry: selected, paused, rules, transactions, prefs, pinned, onUnpin, folded, foldKey, foldedBy, onUnfold, onShowRule }: {
    entry?: LoggedRequest; rules: Rule[]; transactions: TransactionSource;
    /** the pause it waits in, if any: a paused response isn't recorded yet, the pause has it */
    paused?: Pause;
    /** where the headers marked minor are kept */
    prefs: EditorPrefs;
    /** shown whatever the list's selection, until unpinned */
    pinned?: boolean;
    onUnpin?: () => void;
    /** the folded group the selected row stands for (it shows the newest) */
    folded?: readonly LoggedRequest[];
    foldKey?: string;
    /** the fold rule that folded them (named), when one did */
    foldedBy?: string;
    onUnfold: () => void;
    /** shows the rule in the rules tab */
    onShowRule: (id: string) => void;
}) {
    const { off: pluginsOff } = useSnapshot(pluginSwitches);
    // what's on screen: replaced in one go once the next request has loaded, so nothing flickers
    const [shown, setShown] = useState<Shown>();

    useEffect(() => {
        if (!selected) return;
        let stale = false;
        // hovering moves fast: load once it settles
        const timer = setTimeout(async () => {
            const next: Shown = { entry: selected, foldKey, txn: null, bodies: { request: "", response: "" } };
            try {
                next.txn = (await transactions.find(selected)) ?? null;
                if (next.txn) {
                    const t = next.txn;
                    const [request, response] = await Promise.all([
                        t.requestBodySize ? transactions.body(t, "request", 0) : "",
                        t.responseBodySize && t.responseBodySize <= LAZY_BODY ? transactions.body(t, "response", 0) : "",
                    ]);
                    next.bodies = { request, response };
                }
            } catch (e) {
                next.error = String(e);
            }
            if (!stale) setShown(next);
        }, shown ? 120 : 0);
        return () => { stale = true; clearTimeout(timer); };
    }, [selected?.id, selected?.status, foldKey]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!selected) return <aside className="aip-details empty">Hover or select a request or rule to see it here.</aside>;
    if (!shown) return <aside className="aip-details empty">Loading…</aside>;
    const switching = shown.entry.id !== selected.id;
    // the live log entry for what's shown (its outcome, duration… change after loading)
    const entry = switching ? shown.entry : selected;
    const { txn, bodies, error } = shown;
    const loadMore = async (kind: BodyKind) => {
        if (!txn) return;
        const more = await transactions.body(txn, kind, bodies[kind].length);
        setShown((s) => (s && s.txn === txn ? { ...s, bodies: { ...s.bodies, [kind]: s.bodies[kind] + more } } : s));
    };
    const url = new URL(entry.url);
    // the rules that acted on it, and the others its filter matches (off, or added since)
    const matched = rules.filter((r) => entry.ruleIds.includes(r.id) || matches(r.filter, entry.method, entry.url, entry.body));
    const pausedResponse = paused?.stage === "response" ? paused : undefined;
    const status = txn?.status ?? entry.status ?? pausedResponse?.status;
    const requestHeaders = txn?.requestHeaders ?? entry.headers;
    return (
        <aside className={`aip-details ${switching && !(foldKey && foldKey === shown.foldKey) ? "switching" : ""}`}>
            <div className="aip-details-head">
                <span className="aip-method">{entry.method}</span>
                <span className={`aip-status s${Math.floor((status ?? 0) / 100)}`}>{status ?? "pending"}</span>
                {txn?.statusText && <span className="aip-hint">{txn.statusText}</span>}
                {entry.durationMs !== undefined && <span className="aip-time">{entry.durationMs}ms</span>}
                {paused && <span className="aip-badge paused">⏸ {paused.stage}</span>}
                {entry.outcome && <span className="aip-badge paused">{entry.outcome}</span>}
                <span className="aip-seq">{entry.seq ? `#${entry.seq} · ` : ""}{new Date(entry.startedAt).toLocaleTimeString()}</span>
                {pinned && (
                    <button className="aip-pin" aria-label="Pinned: click to unpin" onMouseDown={(e) => e.preventDefault()} onClick={onUnpin}
                        title="Pinned: this request stays here while you move through the list · click (or esc) to unpin">📌</button>
                )}
            </div>
            {folded && (
                <div className="aip-hint aip-details-folded">
                    {switching ? `Showing #${entry.seq}; updating to newest of` : "Newest of"} {folded.length} {foldedBy ? "requests" : "identical requests"} (#{folded.map((f) => f.seq).join(", #")}): {foldedBy ? <>folded by the rule “{foldedBy}”.</> : "same method, URL and body."}
                    {" "}<button className="aip-link" onClick={onUnfold}>Unfold</button> (→) to see each one.
                </div>
            )}
            <code className="aip-details-url"><Enriched text={entry.url} /></code>
            {entry.finalUrl && <code className="aip-details-url">→ <Enriched text={entry.finalUrl} /></code>}
            {matched.length > 0 && (
                <div className="aip-details-rules">
                    {matched.map((r) => {
                        const acted = entry.ruleIds.includes(r.id);
                        return (
                            // a press keeps focus in the filter box, where the list's keys work
                            <button key={r.id} className={`aip-badge tag aip-rule-link${acted ? "" : " idle"}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onShowRule(r.id)}
                                title={`${acted ? "" : `Its filter matches, but it didn't act on this request${r.enabled ? "" : " (it's off)"} · `}${describeFilter(r.filter)} → ${describeAction(r.action)} · click to show it in the rules`}>
                                ⚑ {r.name || describeAction(r.action)}
                            </button>
                        );
                    })}
                </div>
            )}
            {error && <div className="aip-error">Couldn't read the page's record: {error}</div>}
            {txn === null && <div className="aip-hint">Not in this page's memory (from before a navigation or reload, from a worker, or from a frame that's gone): showing what the network log kept.</div>}
            {txn?.error && <div className="aip-error">{txn.error}</div>}
            <Group title="Request">
                {url.searchParams.size > 0 && (
                    <Section fold title="Query" aside={url.searchParams.size}>
                        <Table rows={[...url.searchParams].map(([k, v]) => [k, <EntityOr key={k} text={v} before={k} />])} />
                    </Section>
                )}
                <Section fold title="Headers" aside={`${Object.keys(requestHeaders).length} · set by the page`}>
                    <HeaderTable headers={requestHeaders} prefs={prefs} />
                </Section>
                {livePlugins(pluginsOff).map(({ id, RequestSection }) => RequestSection && (
                    <RequestSection key={id} url={entry.finalUrl ?? entry.url} body={txn ? bodies.request : entry.body ?? ""}
                        complete={txn ? bodies.request.length >= (txn.requestBodySize ?? 0) : entry.body !== undefined} />
                ))}
                {txn ? (
                    txn.requestBodySize ? <Section fold title="Body" aside={formatBytes(txn.requestBodySize)}><Body key={txn.id} label="Request body" text={bodies.request} size={txn.requestBodySize} onMore={() => void loadMore("request")} /></Section> : null
                ) : entry.body !== undefined && <Section fold title="Body" aside={formatBytes(entry.body.length)}><Body label="Request body" text={entry.body} /></Section>}
            </Group>
            <Group title="Response">
                {txn?.responseHeaders && (
                    <Section fold title="Headers" aside={Object.keys(txn.responseHeaders).length}>
                        <HeaderTable headers={txn.responseHeaders} prefs={prefs} />
                    </Section>
                )}
                {pausedResponse && !txn?.responseBodySize ? (
                    <Section fold title="Body" aside={[pausedResponse.mime, formatBytes(pausedResponse.body.length)].filter(Boolean).join(" · ")}>
                        <div className="aip-hint">Paused: the page gets it once you release it (↵ to open).</div>
                        <Body label="Response body" text={pausedResponse.body} />
                    </Section>
                ) : (
                    <Section fold title="Body" aside={[entry.mime, txn?.responseBodySize ? formatBytes(txn.responseBodySize) : undefined].filter(Boolean).join(" · ") || undefined}>
                        {txn?.responseBodySize ? <Body key={txn.id} label="Response body" text={bodies.response} size={txn.responseBodySize} onMore={() => void loadMore("response")} />
                            : <div className="aip-hint">{paused?.stage === "request" ? "Paused before sending (↵ to open)." : status === undefined && txn !== null ? "Waiting for the response…" : "No body recorded."}</div>}
                    </Section>
                )}
            </Group>
        </aside>
    );
}

/** The request's or the response's sections, under a heading. */
export function Group({ title, children }: { title: string; children: React.ReactNode }) {
    return <div className="aip-details-group"><div className="aip-details-group-head">{title}</div>{children}</div>;
}

/** `fold`: a header bar that folds it (open at first); `aside`: a count, a size… beside the title. */
export function Section({ title, aside, fold, children }: { title: string; aside?: React.ReactNode; fold?: boolean; children: React.ReactNode }) {
    if (!fold) return <section className="aip-details-section"><h4>{title}</h4>{children}</section>;
    return (
        <details className="aip-details-section aip-fold-section" open>
            <summary><span className="aip-fold-title">{title}</span>{aside !== undefined && <span className="aip-hint">{aside}</span>}</summary>
            {children}
        </details>
    );
}

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`);

export function Table({ rows }: { rows: [string, React.ReactNode][] }) {
    if (!rows.length) return <div className="aip-hint">none</div>;
    return <table className="aip-table"><tbody>{rows.map(([k, v], i) => <tr key={i}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>;
}

/** `size`: the full length, when `text` may be only its start. */
export function Body({ text, size, onMore, label = "Body" }: { text: string; size?: number; onMore?: () => void; label?: string }) {
    const complete = size === undefined || text.length >= size;
    const shown = useMemo(() => (complete ? prettyJson(text) : text), [text, complete]);
    const rows = useMemo(() => {
        if (!shown) return 1;
        let n = 0;
        for (const line of shown.split("\n")) {
            n += Math.max(1, Math.ceil(line.length / 72));
            if (n >= 20) return 20;
        }
        return n;
    }, [shown]);
    const [requested, setRequested] = useState(false);
    if (size && !text && size > LAZY_BODY && onMore && !requested) {
        return <div className="aip-hint">Large body ({formatBytes(size)}) not shown · <button className="aip-link" onClick={() => { setRequested(true); onMore(); }}>Load it</button></div>;
    }
    if (size && !text) return <div className="aip-hint">Loading…</div>;
    return (
        <>
            <textarea className="aip-pre" readOnly spellCheck={false} aria-label={label} rows={rows} value={shown} placeholder="(empty)"
                onContextMenu={(e) => { e.stopPropagation(); if (activeElementIn(e.currentTarget) !== e.currentTarget) e.currentTarget.focus(); }}
                onKeyDown={(e) => {
                    if (e.key === "Escape" || e.key === "Tab" || (e.code === "Backslash" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey)) return;
                    e.stopPropagation();
                    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === "KeyA") {
                        e.preventDefault();
                        e.currentTarget.select();
                    }
                }} />
            {!complete && (
                <div className="aip-hint">
                    Showing {Math.round(text.length / 1024)} of {Math.round(size! / 1024)} kB · <button className="aip-link" onClick={onMore}>Load more</button>
                </div>
            )}
        </>
    );
}
