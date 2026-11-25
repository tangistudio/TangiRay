import { useState } from "react";
import { useSnapshot } from "valtio";
import type { EditorPrefs } from "../../domain/types";
import { livePlugins } from "../../plugin";
import { pluginSwitches } from "../../state";

// -------------------------------------------------------------------------------------------------
// HEADER TABLE
// A request's or response's headers, the minor ones (caching, transport, security policies,
// tracing, browser hints, and what the plugins add) folded away under the rest. The user marks any
// header minor or important from its row; the marks are kept in the prefs, for every request.
// -------------------------------------------------------------------------------------------------

/** Minor unless marked otherwise: headers whose values rarely matter when reading a request. */
const DEFAULT_MINOR = new Set([
    "cache-control", "pragma", "expires", "age", "etag", "last-modified",
    "content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive", "date", "vary", "server", "via", "alt-svc",
    "accept-encoding", "accept-language", "user-agent", "priority",
    "strict-transport-security", "x-frame-options", "x-content-type-options", "x-xss-protection", "x-permitted-cross-domain-policies",
    "referrer-policy", "permissions-policy", "content-security-policy", "content-security-policy-report-only", "report-to", "reporting-endpoints", "nel",
    "baggage", "sentry-trace", "traceparent", "tracestate",
]);
const DEFAULT_MINOR_PREFIX = /^(sec-ch-|sec-fetch-|cross-origin-|x-envoy-)/;

type Marks = Readonly<Record<string, boolean>> | undefined;

export function isMinorHeader(name: string, marks: Marks): boolean {
    const key = name.toLowerCase();
    return marks && key in marks ? marks[key]
        : DEFAULT_MINOR.has(key) || DEFAULT_MINOR_PREFIX.test(key) || livePlugins(pluginSwitches.off).some((p) => p.minorHeaders?.includes(key));
}

/** Flips a header between minor and important; a mark that matches the default is dropped. */
export function toggleMinorHeader(prefs: EditorPrefs, name: string): void {
    const key = name.toLowerCase();
    const next = !isMinorHeader(key, prefs.minorHeaders);
    const marks = { ...prefs.minorHeaders };
    delete marks[key];
    if (next !== isMinorHeader(key, marks)) marks[key] = next;
    prefs.minorHeaders = marks;
}

export function HeaderTable({ headers, prefs }: { headers: Record<string, string>; prefs: EditorPrefs }) {
    const { minorHeaders } = useSnapshot(prefs);
    const [showMinor, setShowMinor] = useState(false);
    const rows = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
    if (!rows.length) return <div className="aip-hint">none</div>;
    const important = rows.filter(([k]) => !isMinorHeader(k, minorHeaders));
    const minor = rows.filter(([k]) => isMinorHeader(k, minorHeaders));
    const row = ([k, v]: [string, string], isMinor: boolean) => (
        <tr key={k} className={isMinor ? "aih-minor-row" : undefined}>
            <th>{k}</th>
            <td>{v}</td>
            <td className="aih-toggle-cell">
                {/* out of the Tab order, and a click leaves focus where it was */}
                <button className="aih-toggle" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => toggleMinorHeader(prefs, k)}
                    title={isMinor ? `Unfold ${k}: show it in every request` : `Fold ${k}: a minor header, folded away in every request`}>
                    {isMinor ? "👁️" : "🙈"}
                </button>
            </td>
        </tr>
    );
    // one table, so the minor rows line up with the others
    return (
        <table className="aip-table aih-table">
            <tbody>
                {important.map((r) => row(r, false))}
                {minor.length > 0 && (
                    <tr className="aih-fold-row" onClick={() => setShowMinor(!showMinor)} aria-expanded={showMinor}>
                        <td colSpan={3}>
                            <div className="aih-fold">
                                <span className={`aih-chevron ${showMinor ? "open" : ""}`}>▸</span>
                                <span className="aih-count">{minor.length} minor header{minor.length > 1 ? "s" : ""}</span>
                                {!showMinor && <span className="aih-names">{minor.map(([k]) => k).join(", ")}</span>}
                            </div>
                        </td>
                    </tr>
                )}
                {/* the minor rows open under their fold row */}
                {showMinor && minor.map((r) => row(r, true))}
            </tbody>
        </table>
    );
}

/** Styles for {@link HeaderTable}; part of the palette's CSS. */
export const HEADER_TABLE_CSS = `
.aip-table.aih-table { border: 1px solid var(--wt-border-soft); }
.aip-table.aih-table th, .aip-table.aih-table td { padding: 3px 8px; border-bottom: 1px solid var(--wt-border-soft); vertical-align: middle; }
.aip-table.aih-table th { width: 1%; border-right: 1px solid var(--wt-border-soft); }
.aip-table.aih-table tr:last-child > * { border-bottom: 0; }
.aip-table.aih-table .aih-toggle-cell { width: 1%; padding: 1px 4px; text-align: right; white-space: nowrap; }
.aih-toggle { visibility: hidden; padding: 0 3px; border: 0; border-radius: 4px; background: transparent; font-size: 12px; line-height: 16px; cursor: pointer; opacity: .7; }
.aip-table.aih-table tr:hover .aih-toggle { visibility: visible; }
.aih-toggle:hover { opacity: 1; background: var(--wt-fill); }
.aih-minor-row th, .aih-minor-row td { color: var(--wt-text-muted); }
.aih-fold-row { cursor: pointer; }
/* a cell that doesn't widen the table: the names get cut instead */
.aih-fold-row td { max-width: 0; }
.aih-fold { display: flex; align-items: center; gap: 6px; font: 10px system-ui, -apple-system, sans-serif; color: var(--wt-text-faint); }
.aih-fold-row:hover .aih-fold { color: var(--wt-text-muted); }
.aih-chevron { flex: none; width: 10px; transition: transform .12s; }
.aih-chevron.open { transform: rotate(90deg); }
.aih-count { flex: none; white-space: nowrap; }
.aih-names { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .7; }
`;
