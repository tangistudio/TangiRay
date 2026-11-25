import { describeAction, describeFilter, matches } from "../../domain/filter";
import { folderNames } from "../../domain/folders";
import type { LoggedRequest, Rule } from "../../domain/types";
import { editorAction } from "../rule-editor/draft";
import { statusPhrase } from "../../shared/http/status-codes";
import { Enriched, EnrichedUrl } from "../entities/Capsule";
import { shortUrl } from "../format";
import { ActionHeading } from "../rule-editor/ActionIcon";
import { Body, Section, Table } from "./RequestDetails";

// -------------------------------------------------------------------------------------------------
// RULE PREVIEW
// The selected rule, beside the list: what it matches, what it does, and the requests on this page
// it matches (whether or not it acted on them: a rule that's off, or was added later, still shows).
// -------------------------------------------------------------------------------------------------

const MAX_MATCHES = 12;
/** the newest matches shown; the rest (up to MAX_MATCHES) folded */
const SHOWN_MATCHES = 2;

export function RulePreview({ rule, log, hits, pathOnly, onShowRequest }: { rule: Rule; log: readonly LoggedRequest[]; hits: number; pathOnly: boolean; onShowRequest: (entry: LoggedRequest) => void }) {
    const { filter, action } = rule;
    const query = Object.entries(filter.query ?? {});
    const matched = log.filter((e) => e.ruleIds.includes(rule.id) || matches(filter, e.method, e.url, e.body));
    return (
        <aside className="aip-details aip-rule-preview">
            <div className="aip-details-head">
                <span className={`aip-badge ${rule.enabled ? "on" : ""}`}>{rule.enabled ? "on" : "off"}</span>
                <span className="aip-preview-name">{rule.name || <Enriched text={describeFilter(filter, pathOnly)} />}</span>
                {rule.tags.map((t) => <span key={t} className="aip-badge tag">{t}</span>)}
                <span className="aip-seq">{hits} hit{hits === 1 ? "" : "s"}</span>
            </div>

            <section className="aip-card">
                <h4>When a request matches</h4>
                <div className="aip-pattern-view">
                    <span className="aip-method">{filter.method ?? <span className="aip-hint">any</span>}</span>
                    {filter.url !== undefined ? <code><Enriched text={filter.url} /></code> : <span className="aip-hint">any URL</span>}
                </div>
                {query.length > 0 && (
                    <div className="aip-url-text">
                        {query.map(([k, v], i) => (
                            <span key={k} className="aip-part aip-param on">
                                {i === 0 ? "?" : "&"}<span className="aip-param-key"><span className="aip-param-mark" aria-hidden>✓</span>{k}=</span><Enriched text={v} />
                            </span>
                        ))}
                    </div>
                )}
                {filter.bodyContains && <div className="aip-hint">Body contains <code>{filter.bodyContains}</code></div>}
            </section>

            <section className="aip-card">
                <h4>Then</h4>
                <div className="aip-action-detail">
                    <ActionHeading choice={editorAction(action)} />
                    {action.type === "request" && action.mode === "ask" && <Table rows={[["At", "request"], ["Do", "ask each time"]]} />}
                    {action.type === "response" && action.mode === "ask" && <Table rows={[["At", "response"], ["Do", "ask each time"]]} />}
                    {action.type === "request" && action.mode === "send" && (Object.keys(action.edit).length || action.response ? <>
                        <Table rows={[
                            ["At", "request"],
                            ["Do", `automatically: ${Object.keys(action.edit).length ? "sent as this request" : "sent as is"}${action.response ? ", response replaced" : ""}`],
                            ...(action.delayMs ? [["after", `${action.delayMs} ms`] as [string, React.ReactNode]] : []),
                            ...(action.edit.method !== undefined ? [["Method", action.edit.method] as [string, React.ReactNode]] : []),
                            ...(action.edit.url !== undefined ? [["URL", <code key="u"><Enriched text={action.edit.url} /></code>] as [string, React.ReactNode]] : []),
                            ...Object.entries(action.edit.headers ?? {}),
                        ]} />
                        {action.edit.body !== undefined && <Body label="Request body" text={action.edit.body} />}
                        {action.response && <>
                            <Table rows={[["Response status", `${action.response.status} ${statusPhrase(action.response.status)}`.trim()]]} />
                            {action.response.body && <Body label="Response body" text={action.response.body} />}
                        </>}
                    </> : <Table rows={[["by", `${action.delayMs} ms`]]} />)}
                    {action.type === "request" && action.mode === "respond" && <>
                        <Table rows={[
                            ["Status", `${action.response.status} ${statusPhrase(action.response.status)}`.trim()],
                            ["Content-Type", action.response.mime || <span className="aip-hint">none</span>],
                            ...(action.delayMs ? [["after", `${action.delayMs} ms`] as [string, React.ReactNode]] : []),
                        ]} />
                        {action.response.body && <Body label="Response body" text={action.response.body} />}
                    </>}
                    {action.type === "response" && action.mode === "replace" && <>
                        <Table rows={[
                            ["At", "response"], ["Do", "automatically: replaced with this one"],
                            ["Status", `${action.response.status} ${statusPhrase(action.response.status)}`.trim()],
                            ...(action.delayMs ? [["after", `${action.delayMs} ms`] as [string, React.ReactNode]] : []),
                        ]} />
                        {action.response.body && <Body label="Response body" text={action.response.body} />}
                    </>}
                </div>
            </section>

            <Section title={`Matches in this tab · ${matched.length}`}>
                {matched.length ? (() => {
                    const newest = matched.slice(-MAX_MATCHES).reverse();
                    const row = (e: LoggedRequest) => (
                        <button key={e.id} type="button" className={`aip-preview-match${e.ruleIds.includes(rule.id) ? "" : " idle"}`}
                            title={`${e.url} · ${e.ruleIds.includes(rule.id) ? "" : "Rule did not apply to this request · "}show request`}
                            aria-label={`Show request #${e.seq}: ${e.url}${e.ruleIds.includes(rule.id) ? "" : " (rule did not apply)"}`}
                            onClick={() => onShowRequest(e)}
                            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}>
                            <span className="aip-seq">#{e.seq}</span>
                            <span className="aip-method">{e.method}</span>
                            <span className="aip-title aip-clip-url" title={pathOnly ? e.url : undefined}><EnrichedUrl text={shortUrl(e.url, pathOnly)} /></span>
                            <span className={`aip-status s${Math.floor((e.status ?? 0) / 100)}`}>{e.status ?? "…"}</span>
                        </button>
                    );
                    return (
                        <div className="aip-preview-matches">
                            {newest.slice(0, SHOWN_MATCHES).map(row)}
                            {matched.length > SHOWN_MATCHES && (
                                <details key={rule.id} className="aip-fold-section">
                                    <summary className="aip-hint">{matched.length - SHOWN_MATCHES} more</summary>
                                    {newest.slice(SHOWN_MATCHES).map(row)}
                                    {matched.length > MAX_MATCHES && <div className="aip-hint">and {matched.length - MAX_MATCHES} older</div>}
                                </details>
                            )}
                        </div>
                    );
                })() : <div className="aip-hint">No request in this tab matches it yet.</div>}
            </Section>

            <div className="aip-hint">F2 or ⌘E to edit</div>
        </aside>
    );
}

/** The selected folder, beside the list: what's in it. */
export function FolderPreview({ path, rules, pathOnly }: { path: string; rules: readonly Rule[]; pathOnly: boolean }) {
    const on = rules.filter((r) => r.enabled).length;
    return (
        <aside className="aip-details aip-rule-preview">
            <div className="aip-details-head">
                <span className="aip-preview-name">📁 {folderNames(path).join(" / ")}</span>
                <span className="aip-seq">{on} of {rules.length} on</span>
            </div>
            {rules.length ? (
                <Section title="Rules in it">
                    <div className="aip-preview-matches">
                        {rules.map((r) => (
                            <div key={r.id} className="aip-preview-match">
                                <span className={`aip-badge ${r.enabled ? "on" : ""}`}>{r.enabled ? "on" : "off"}</span>
                                <span className={`aip-title${r.name ? "" : " aip-clip-url"}`} title={pathOnly && !r.name ? describeFilter(r.filter) : undefined}>{r.name || <EnrichedUrl text={describeFilter(r.filter, pathOnly)} />}</span>
                                <span className="aip-hint">{describeAction(r.action)}</span>
                            </div>
                        ))}
                    </div>
                </Section>
            ) : <div className="aip-hint">Empty: drag rules or folders onto it.</div>}
            <div className="aip-hint">↵ turns them all {rules.length && on === rules.length ? "off" : "on"} · F2 / ⌘E rename · ⌘⌫ delete the folder (its rules move up) · drag to move</div>
        </aside>
    );
}
