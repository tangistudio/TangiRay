import { useMemo, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { CodeEditor } from "../shared/ui/code-editor/CodeEditor";
import { describeAction, describeFilter } from "../domain/filter";
import { parseRules } from "../domain/rules-io";
import type { Rule } from "../domain/types";
import { Enriched } from "./entities/Capsule";

// -------------------------------------------------------------------------------------------------
// RULES IMPORT
// Rules from an exported file (picked or pasted) join the list on top; one with the id of an
// existing rule replaces it, keeping its hit count.
// -------------------------------------------------------------------------------------------------

export function ImportRules({ store, onDone }: { store: { rules: Rule[] }; onDone: () => void }) {
    const { rules } = useSnapshot(store) as { rules: Rule[] };
    const [text, setText] = useState("");
    const [fileError, setFileError] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);

    const parsed = useMemo((): { rules?: Rule[]; error?: string } => {
        if (!text.trim()) return {};
        try { return { rules: parseRules(text) }; } catch (e) { return { error: (e as Error).message }; }
    }, [text]);
    const existingIds = new Set(rules.map((r) => r.id));
    const replacing = parsed.rules?.filter((r) => existingIds.has(r.id)).length ?? 0;

    const pickFile = (file: File | undefined) => {
        if (!file) return;
        setFileError("");
        file.text().then(setText, (e) => setFileError(`Couldn't read ${file.name}: ${String(e)}`));
    };

    const doImport = () => {
        if (!parsed.rules?.length) return;
        // backwards, so the file's order stays at the top
        for (const r of [...parsed.rules].reverse()) {
            const existing = store.rules.find((x) => x.id === r.id);
            if (existing) Object.assign(existing, { ...r, hits: existing.hits });
            else store.rules.unshift(r);
        }
        onDone();
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.defaultPrevented) return;
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onDone(); }
        else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doImport(); }
    };

    return (
        <div className="aip-root aip-editor" tabIndex={-1} onKeyDown={onKeyDown}>
            <div className="aip-editor-title">Import rules</div>
            <div className="aip-form">
                <div className="aip-hint">
                    Choose a file exported with "Export rules", or paste its JSON.{" "}
                    <button className="aip-link" onClick={() => fileRef.current?.click()}>Choose file…</button>
                    <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }}
                        onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
                </div>
                <div className="aip-field">Rules JSON
                    <CodeEditor value={text} language="json" autoFocus onSubmit={doImport} placeholder='{ "rules": [ … ] }' minHeight="200px" maxHeight="40vh"
                        aria-label="Rules JSON" onChange={setText} />
                </div>
                {fileError && <div className="aip-error">{fileError}</div>}
                {parsed.error && <div className="aip-error">{parsed.error}</div>}
                {parsed.rules && (
                    <section>
                        <h4>{parsed.rules.length} rule{parsed.rules.length === 1 ? "" : "s"}
                            <span className="aip-hint">{parsed.rules.length - replacing} new{replacing ? `, ${replacing} replacing existing ones` : ""}</span></h4>
                        {parsed.rules.map((r) => (
                            <div key={r.id} className="aip-check">
                                <span className={`aip-switch ${r.enabled ? "on" : ""}`} title={r.enabled ? "Enabled" : "Disabled"} />
                                <span className="aip-main">
                                    <span className="aip-title">{r.name || <Enriched text={describeFilter(r.filter)} />}</span>
                                    <span className="aip-sub"><Enriched text={describeFilter(r.filter)} /> → {describeAction(r.action)}</span>
                                </span>
                                {existingIds.has(r.id) && <span className="aip-badge paused">replaces</span>}
                            </div>
                        ))}
                    </section>
                )}
            </div>
            <div className="aip-footer">
                <span>⌘↵ import · esc back</span>
                <span>
                    <button onClick={onDone}>Cancel</button>
                    <button className="primary" disabled={!parsed.rules?.length} onClick={doImport}>
                        Import{parsed.rules?.length ? ` ${parsed.rules.length} rule${parsed.rules.length === 1 ? "" : "s"}` : ""}
                    </button>
                </span>
            </div>
        </div>
    );
}
