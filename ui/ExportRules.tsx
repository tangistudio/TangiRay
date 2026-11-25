import { tweak } from "tangitweak";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { describeAction, describeFilter } from "../domain/filter";
import { exportRules } from "../domain/rules-io";
import type { Rule } from "../domain/types";
import { matchesWordStarts, tokenWords } from "../shared/search/word-starts";
import { Enriched } from "./entities/Capsule";

// -------------------------------------------------------------------------------------------------
// RULES EXPORT
// Pick the rules to download as a JSON file ("Import rules" reads it back). The rules the list
// showed (its search) start picked.
// -------------------------------------------------------------------------------------------------

export function ExportRules({ store, picked: initial, download, onDone }: {
    store: { rules: Rule[] };
    /** ids of the rules picked at first */
    picked: readonly string[];
    download: (filename: string, text: string, mime: string) => Promise<void>;
    onDone: () => void;
}) {
    const { rules } = useSnapshot(store) as { rules: Rule[] };
    const [picked, setPicked] = useState(() => new Set(initial));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const searchRef = useRef<HTMLInputElement>(null);
    const allRef = useRef<HTMLInputElement>(null);
    useEffect(() => searchRef.current?.focus(), []);

    // as the list's search: text, or (3+ characters) starts of words in order
    const shown = useMemo(() => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return rules;
        return rules.filter((r) => {
            const raw = [r.name, r.tags.join(" "), describeFilter(r.filter), describeAction(r.action)].join(" ");
            const text = raw.toLowerCase();
            return words.every((w) => text.includes(w) || (w.length >= 3 && tokenWords(raw).some((t) => matchesWordStarts(t, w))));
        });
    }, [rules, query]);
    const chosen = rules.filter((r) => picked.has(r.id));
    const shownPicked = shown.filter((r) => picked.has(r.id)).length;
    const allShown = shown.length > 0 && shownPicked === shown.length;
    useEffect(() => { if (allRef.current) allRef.current.indeterminate = shownPicked > 0 && !allShown; }, [shownPicked, allShown]);
    // (un)picks the shown rules, leaving the others as they are
    const pickShown = (on: boolean) => setPicked((prev) => {
        const next = new Set(prev);
        for (const r of shown) if (on) next.add(r.id); else next.delete(r.id);
        return next;
    });
    const toggle = (id: string) => setPicked((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
    });

    const doExport = () => {
        if (!chosen.length || busy) return;
        setBusy(true);
        setError("");
        download(`tangiray-rules-${new Date().toISOString().slice(0, 10)}.json`, exportRules(chosen), "application/json")
            .then(onDone, (e) => { setError(String(e)); tweak.log("[tangiray] rules export failed", String(e)); })
            .finally(() => setBusy(false));
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.defaultPrevented) return;
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onDone(); }
        else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doExport(); }
        else if ((e.metaKey || e.ctrlKey) && e.code === "KeyA" && (e.target as HTMLInputElement).type !== "text") {
            e.preventDefault();
            pickShown(!allShown);
        }
    };

    return (
        <div className="aip-root aip-editor" tabIndex={-1} onKeyDown={onKeyDown}>
            <div className="aip-editor-title">
                Export rules
                <span className="aip-hint">{chosen.length} of {rules.length} picked</span>
            </div>
            <div className="aip-form">
                <input ref={searchRef} className="aip-export-search" value={query} placeholder="Filter rules…" aria-label="Filter rules"
                    onChange={(e) => setQuery(e.target.value)} />
                {shown.length > 0 && (
                    <label className="aip-check aip-pick aip-pick-all">
                        <input ref={allRef} type="checkbox" checked={allShown} onChange={() => pickShown(!allShown)} />
                        <span className="aip-main"><span className="aip-title">{query ? `All ${shown.length} shown` : "All"}</span></span>
                        {shownPicked > 0 && <button className="aip-link" onClick={(e) => { e.preventDefault(); pickShown(false); }}>None</button>}
                    </label>
                )}
                {shown.map((r) => (
                    <label key={r.id} className="aip-check aip-pick">
                        <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                        <span className="aip-main">
                            <span className="aip-title">{r.name || <Enriched text={describeFilter(r.filter)} />}</span>
                            <span className="aip-sub"><Enriched text={describeFilter(r.filter)} /> → {describeAction(r.action)}{r.enabled ? "" : " · off"}</span>
                        </span>
                        {r.tags.map((t) => <span key={t} className="aip-badge tag">{t}</span>)}
                    </label>
                ))}
                {!rules.length ? <div className="aip-hint">No rules yet.</div> : !shown.length && <div className="aip-hint">No rule matches.</div>}
                {error && <div className="aip-error">Export failed: {error}</div>}
            </div>
            <div className="aip-footer">
                <span>Space picks · ⌘A all / none shown · ⌘↵ export · esc back</span>
                <span>
                    <button onClick={onDone}>Cancel</button>
                    <button className="primary" disabled={!chosen.length || busy} onClick={doExport}>
                        {busy ? "Exporting…" : `Export ${chosen.length} rule${chosen.length === 1 ? "" : "s"}`}
                    </button>
                </span>
            </div>
        </div>
    );
}
