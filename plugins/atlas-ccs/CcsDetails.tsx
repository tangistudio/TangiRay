import { useEffect, useState } from "react";
import { describeAction, describeFilter, matches } from "../../domain/filter";
import type { EntryDetailsProps } from "../../plugin";
import { Body, formatBytes, Group, Section, Table } from "../../ui/list/RequestDetails";
import { ccsOf, ccsResult, ccsStatus, ccsTitle } from "./format";

type CcsDocKind = "command" | "reply";
type CcsDoc = { text: string; size: number } | null;

/** A CCS exchange (a MongoDB command and its reply): its summary, and the documents from the page's memory (the site part's `document` call), read when shown. */
export function CcsDetails({ entry, rules, call, pinned, onUnpin, folded, foldedBy, onUnfold, onShowRule }: EntryDetailsProps) {
    const c = ccsOf(entry);
    // null: not in the page's memory (too large, from before a reload, or dropped for room)
    const [docs, setDocs] = useState<{ id: string; command?: CcsDoc; reply?: CcsDoc }>({ id: "" });
    const readDocument = (kind: CcsDocKind, offset: number) => call("document", entry.id, kind, offset) as Promise<{ text: string; size: number } | undefined>;
    useEffect(() => {
        let stale = false;
        const read = (kind: CcsDocKind) => readDocument(kind, 0).then((d) => d ?? null, () => null);
        // hovering moves fast: load once it settles
        const timer = setTimeout(async () => {
            const [command, reply] = await Promise.all([read("command"), c.replyBytes !== undefined ? read("reply") : undefined]);
            if (!stale) setDocs({ id: entry.id, command, reply });
        }, 120);
        return () => { stale = true; clearTimeout(timer); };
    }, [entry.id, c.replyBytes]); // eslint-disable-line react-hooks/exhaustive-deps
    const loadMore = async (kind: CcsDocKind) => {
        const current = docs[kind];
        if (!current) return;
        const more = await readDocument(kind, current.text.length).catch(() => undefined);
        if (more) setDocs((d) => (d.id === entry.id && d[kind] ? { ...d, [kind]: { ...d[kind]!, text: d[kind]!.text + more.text } } : d));
    };
    const shown = docs.id === entry.id ? docs : { id: entry.id };
    const documentSection = (kind: CcsDocKind, title: string) => {
        const doc = shown[kind];
        return (
            <Section fold title={title} aside={doc ? formatBytes(doc.size) : undefined}>
                {doc === undefined ? <div className="aip-hint">Loading…</div>
                    : doc === null ? <div className="aip-hint">Not in this page's memory (too large, from before a reload, or dropped to make room).</div>
                    : <Body key={`${entry.id}-${kind}`} label={title} text={doc.text} size={doc.size} onMore={() => void loadMore(kind)} />}
            </Section>
        );
    };
    const status = ccsStatus(entry);
    const matched = rules.filter((r) => matches(r.filter, entry.method, entry.url, entry.body));
    const replied = c.replyBytes !== undefined;
    const row = (label: string, value: unknown): [string, React.ReactNode][] => (value === undefined || value === "" ? [] : [[label, String(value)]]);
    return (
        <aside className="aip-details">
            <div className="aip-details-head">
                <span className="aip-method">{entry.method}</span>
                <span className={`aip-status ${status.className}`}>{status.text}</span>
                {entry.durationMs !== undefined && <span className="aip-time">{entry.durationMs}ms</span>}
                {c.background && <span className="aip-badge tag">{c.background}</span>}
                {entry.outcome && <span className="aip-badge paused">{entry.outcome}</span>}
                <span className="aip-seq">{entry.seq ? `#${entry.seq} · ` : ""}{new Date(entry.startedAt).toLocaleTimeString()}</span>
                {pinned && (
                    <button className="aip-pin" aria-label="Pinned: click to unpin" onMouseDown={(e) => e.preventDefault()} onClick={onUnpin}
                        title="Pinned: this command stays here while you move through the list · click (or esc) to unpin">📌</button>
                )}
            </div>
            {folded && (
                <div className="aip-hint aip-details-folded">
                    Newest of {folded.length} {foldedBy ? "commands" : "identical commands"} (#{folded.map((f) => f.seq).join(", #")}){foldedBy ? <>, folded by the rule “{foldedBy}”.</> : "."}
                    {" "}<button className="aip-link" onClick={onUnfold}>Unfold</button> (→) to see each one.
                </div>
            )}
            <code className="aip-details-url">{ccsTitle(c)}</code>
            {matched.length > 0 && (
                <div className="aip-details-rules">
                    {matched.map((r) => (
                        <button key={r.id} className="aip-badge tag aip-rule-link" onMouseDown={(e) => e.preventDefault()} onClick={() => onShowRule(r.id)}
                            title={`${describeFilter(r.filter)} → ${describeAction(r.action)} · click to show it in the rules`}>⚑ {r.name || describeAction(r.action)}</button>
                    ))}
                </div>
            )}
            <Group title="Command">
                <Section fold title="Summary">
                <Table rows={[
                    ...row("Command", c.command), ...row("Database", c.db), ...row("Collection", c.collection), ...row("Server", c.server),
                    ...row("Kind", c.background ?? "operation"), ...row("Statements", c.items), ...row("Size", formatBytes(c.requestBytes)), ...row("Compression", c.compressor),
                ]} />
                </Section>
                {documentSection("command", "Document")}
            </Group>
            <Group title="Reply">
                {replied ? (
                    <>
                        <Section fold title="Summary">
                            <Table rows={[
                                ...row("Status", c.ok === undefined ? undefined : c.ok ? "OK" : "error"), ...row("Error code", c.code), ...row("Code name", c.codeName),
                                ...row("Result", ccsResult(c)), ...row("Size", formatBytes(c.replyBytes!)), ...row("Compression", c.replyCompressor), ...row("Round trip", entry.durationMs !== undefined ? `${entry.durationMs}ms` : undefined),
                            ]} />
                        </Section>
                        {documentSection("reply", "Document")}
                    </>
                ) : <div className="aip-hint">{entry.outcome ?? "Waiting for the reply…"}</div>}
            </Group>
            <div className="aip-hint">The documents stay in the page's memory (like HTTP bodies) and are decoded when shown; the list keeps only the summary. The batch is the reply's, not every match; the time is what the browser saw from command to reply, not the server's execution time.</div>
        </aside>
    );
}
