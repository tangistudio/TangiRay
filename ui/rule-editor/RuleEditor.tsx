import { StatusInput } from "../../shared/ui/StatusInput";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { CodeEditor, languageFor } from "../../shared/ui/code-editor/CodeEditor";
import { showEditorKeys } from "../../shared/ui/code-editor/keys-help";
import { runShortcut } from "../../shared/ui/dead-keys";
import { selectionIn } from "../../shared/ui/shadow-root";
import { newId } from "../../shared/util/id";
import { describeAction, describeFilter, matches, urlPatternError } from "../../domain/filter";
import { ruleSchema } from "../../domain/rule-schema";
import { parseRuleJson, type RuleFields, ruleToJson } from "../../domain/rules-io";
import type { EditorPrefs, PageState, Rule } from "../../domain/types";
import { ButtonKey, Kbd } from "../Kbd";
import { Enriched, EntityOr } from "../entities/Capsule";
import { ActionHeading, ActionIcon } from "./ActionIcon";
import { ACTION_GROUPS, actionFromDraft, ACTIONS, cycleSegment, type Draft, draftFromFields, type EditorAction, fieldsFromDraft, patternFromSample, filterFromDraft, HTTP_METHODS, isHttpUrl, sampleSegments, segmentMatches, splitPattern, stableJson, toggleAnyPath, toggleOrigin, withSample } from "./draft";
import { useFieldNavigation } from "./field-navigation";
import { Table } from "../list/RequestDetails";

// -------------------------------------------------------------------------------------------------
// RULE EDITOR
// A URL pattern for the requests to match (built by clicking parts of a sample request, or typed),
// what to do, and a name/tags. The sample comes from a logged request or is typed in.
// -------------------------------------------------------------------------------------------------

/** Space / ↵ on a role="button" span. */
const activate = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); fn(); }
};

export function RuleEditor({ initial, store, page, prefs, onDone }: { initial: Draft; store: { rules: Rule[] }; page: PageState; prefs: EditorPrefs; onDone: () => void }) {
    const [d, setD] = useState(initial);
    // code view: the rule as JSON (the shape "Export rules" writes), checked as an import is
    const { ruleEditorMode: mode } = useSnapshot(prefs);
    const [code, setCode] = useState(() => (prefs.ruleEditorMode === "code" ? ruleToJson(fieldsFromDraft(initial)) : ""));
    const parsedCode = useMemo((): { fields: RuleFields } | { error: string } | null => {
        if (mode !== "code") return null;
        try { return { fields: parseRuleJson(code) }; } catch (e) { return { error: (e as Error).message }; }
    }, [mode, code]);
    const [modeError, setModeError] = useState<string | null>(null);
    // switching to the GUI would change the rule: asked once, the next switch goes ahead
    const [confirmLossy, setConfirmLossy] = useState(false);
    const update = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
    const { log } = useSnapshot(page) as PageState;
    const { rules: allRules } = useSnapshot(store) as { rules: Rule[] };
    // completion examples: what the page requested and the rules were made from
    const schema = useMemo(() => {
        if (mode !== "code") return undefined;
        const urls = [...new Set([...log.map((e) => e.url), ...allRules.map((r) => r.sample.url)])].slice(-50).reverse();
        return ruleSchema({ origins: [...new Set(urls.map((u) => new URL(u).origin))], urls });
    }, [mode, log, allRules]);
    const nameRef = useRef<HTMLInputElement>(null);
    const urlRef = useRef<HTMLInputElement>(null);
    const patternRef = useRef<HTMLInputElement>(null);
    useEffect(() => { if (prefs.ruleEditorMode === "gui") (initial.blank ? patternRef : nameRef).current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    // what's typed, which may not parse yet: the sample keeps the last URL that did
    const [urlText, setUrlText] = useState(initial.sample.url);
    const urlValid = isHttpUrl(urlText);
    // the example URL's text field shows when asked (or needed)
    const [editingUrl, setEditingUrl] = useState(false);
    const showUrl = editingUrl || !urlValid;
    // shortcut badges show only while ⌥ is held
    const [showKeys, setShowKeys] = useState(false);
    const changeUrl = (text: string) => {
        setUrlText(text);
        if (isHttpUrl(text)) setD((prev) => withSample(prev, { ...prev.sample, url: new URL(text).toString() }));
    };

    const filter = useMemo(() => filterFromDraft(d), [d]);
    const action = useMemo(() => actionFromDraft(d), [d]);
    const codeFields = parsedCode && "fields" in parsedCode ? parsedCode.fields : null;
    const shownFilter = mode === "code" ? codeFields?.filter : filter;
    const matchCount = useMemo(() => (shownFilter ? log.filter((e) => matches(shownFilter, e.method, e.url, e.body)).length : 0), [log, shownFilter]);
    const u = new URL(d.sample.url);
    const patternError = d.urlPattern.trim() ? urlPatternError(d.urlPattern.trim()) : undefined;
    // the sample's parts, clickable while the pattern lines up with them
    const segments = sampleSegments(d.sample.url);
    const segMatches = segmentMatches(d.urlPattern, d.sample.url);
    const { origin: patternOrigin, path: patternPath } = splitPattern(d.urlPattern);
    const anyPath = patternPath === "/*" && !(segMatches && segments.length === 1);
    const setPattern = (urlPattern: string) => update({ urlPattern });

    const save = () => {
        let fields: RuleFields;
        if (mode === "code") {
            if (!codeFields) { setModeError(parsedCode && "error" in parsedCode ? parsedCode.error : "The rule isn't valid."); return; }
            fields = codeFields;
        } else {
            if (!urlValid) { setEditingUrl(true); requestAnimationFrame(() => urlRef.current?.focus()); return; }
            if (patternError) { patternRef.current?.focus(); return; }
            fields = fieldsFromDraft(d);
        }
        const existing = d.ruleId && store.rules.find((r) => r.id === d.ruleId);
        if (existing) Object.assign(existing, fields);
        else store.rules.unshift({ id: newId(), hits: 0, ...fields });
        onDone();
    };

    const switchMode = (to: EditorPrefs["ruleEditorMode"]) => {
        if (to === mode) return;
        setModeError(null);
        if (to === "code") {
            setCode(ruleToJson(fieldsFromDraft(d)));
            setConfirmLossy(false);
            prefs.ruleEditorMode = "code";
            return;
        }
        if (!codeFields) { setModeError(`Fix the rule to switch to the GUI: ${parsedCode && "error" in parsedCode ? parsedCode.error : "it isn't valid"}`); return; }
        const next = draftFromFields(codeFields, d.ruleId);
        // the GUI builds the filter from the sample URL: some filters it can't show
        const asGui = fieldsFromDraft(next);
        if (!confirmLossy && (stableJson(asGui.filter) !== stableJson(codeFields.filter) || stableJson(asGui.action) !== stableJson(codeFields.action))) {
            setModeError(`The GUI builds the filter from the sample URL, so it would change this rule to: ${describeFilter(asGui.filter)} → ${describeAction(asGui.action)}. Switch again to accept that, or keep editing the code.`);
            setConfirmLossy(true);
            return;
        }
        setD(next);
        setUrlText(next.sample.url);
        prefs.ruleEditorMode = "gui";
        requestAnimationFrame(() => nameRef.current?.focus());
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Alt") setShowKeys(true);
        if (e.defaultPrevented) return;
        const mod = e.metaKey || e.ctrlKey;
        const target = e.target as HTMLElement;
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onDone(); }
        // ⌘S, as in an editor (e.code: the key, whatever the layout or ⇧)
        else if (mod && !e.altKey && e.code === "KeyS") { e.preventDefault(); save(); }
        else if (e.altKey && !mod && e.code === "KeyJ") runShortcut(e, () => switchMode(mode === "code" ? "gui" : "code"));
        // the code view: the editor has the other keys
        else if (mode === "code") { if (e.key === "Enter" && mod) { e.preventDefault(); save(); } }
        // Enter saves from any field but a multi-line one, where ⌘↵ does
        else if (e.key === "Enter" && !e.nativeEvent.isComposing && (mod || target.tagName === "INPUT")) { e.preventDefault(); save(); }
        else if (e.altKey && !mod) {
            // e.code: on macOS ⌥ turns the key into another character
            const digit = /^Digit([1-9])$/.exec(e.code);
            const shortcut = digit ? () => pickAction(ACTIONS[Number(digit[1]) - 1]?.choice) : FILTER_KEYS[e.code];
            if (shortcut) runShortcut(e, shortcut);
        }
        else if (navigate(e)) e.preventDefault();
    };

    const rootRef = useRef<HTMLDivElement>(null);
    const navigate = useFieldNavigation(rootRef);

    const formRef = useRef<HTMLDivElement>(null);
    const focusIn = (...selectors: string[]) => requestAnimationFrame(() => {
        for (const s of selectors) {
            const el = formRef.current?.querySelector<HTMLElement>(s);
            if (el) { el.focus(); return; }
        }
    });
    const pickAction = (choice: EditorAction | undefined) => {
        if (!choice) return;
        update({ choice });
        // straight to the action's first field, or its radio when it has none
        focusIn(".aip-action-fields :is(input, textarea, select)", `input[name="aip-action"][value="${choice}"]`);
    };
    const FILTER_KEYS: Record<string, () => void> = {
        KeyN: () => nameRef.current?.focus(),
        KeyM: () => { update({ useMethod: !d.useMethod }); focusIn(".aip-method-pick"); },
        KeyU: () => patternRef.current?.focus(),
        KeyO: () => { setPattern(toggleOrigin(d.urlPattern, d.sample.url)); focusIn(".aip-origin"); },
        KeyP: () => { setPattern(toggleAnyPath(d.urlPattern, d.sample.url)); focusIn(".aip-segment"); },
        KeyB: () => focusIn(".aip-body-input"),
    };

    return (
        <div className={`aip-root aip-editor ${showKeys ? "show-keys" : ""}`} ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}
            onKeyUp={(e) => { if (e.key === "Alt") setShowKeys(false); }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setShowKeys(false); }}>
            <div className="aip-editor-title aip-rule-title">
                {mode === "code"
                    ? <span>{d.ruleId ? "Edit rule" : "New rule"} <span className="aip-hint">as JSON</span></span>
                    : <>
                        <span className="aip-title-field"><input ref={nameRef} className="aip-name" value={d.name} aria-label="Name (⌥N)"
                            placeholder={`${d.ruleId ? "Unnamed rule" : "New rule"}: ${describeFilter(filter)}`} onChange={(e) => update({ name: e.target.value })} /><Kbd k="N" /></span>
                        <input className="aip-tags" value={d.tags} aria-label="Tags" placeholder="tags, comma separated" onChange={(e) => update({ tags: e.target.value })} />
                    </>}
                <span className="aip-mode">
                    <Kbd k="J" />
                    <button role="switch" aria-checked={mode === "code"} className="aip-mode-switch" onClick={() => switchMode(mode === "code" ? "gui" : "code")}
                        title={mode === "code" ? "Editing as JSON: switch off to use the form (⌥J)" : "Edit the rule as JSON (⌥J)"}>
                        <span className={`aip-switch ${mode === "code" ? "on" : ""}`} aria-hidden />JSON
                    </button>
                </span>
            </div>
            {mode === "code" ? (
                <div className="aip-form">
                    <div className="aip-hint">
                        The rule as JSON, as "Export rules" writes it: <code>filter</code> (every field set must match: <code>method</code>,{" "}
                        <code>url</code>, a URL pattern like <code>https://host/api/:group/*</code>, <code>query</code>, <code>bodyContains</code>), <code>action</code>{" "}
                        (Pause: <code>request</code>/<code>response</code> + <code>"mode": "ask"</code>; Mock: <code>request</code> + <code>respond</code>;
                        Delay: <code>request</code> + <code>send</code> with no <code>edit</code>; or <code>hide</code> | <code>favourite</code> | <code>fold</code>; hover for the rest) and the <code>sample</code> request the GUI edits it from.
                    </div>
                    <CodeEditor value={code} language="json" schema={schema} autoFocus onSubmit={save} onSave={save} minHeight="260px" maxHeight="58vh" aria-label="Rule JSON"
                        onChange={(text) => { setCode(text); setModeError(null); setConfirmLossy(false); }} />
                    {parsedCode && "error" in parsedCode && <div className="aip-error">{parsedCode.error}</div>}
                    {modeError && <div className="aip-error">{modeError}</div>}
                    {codeFields && (
                        <div className="aip-hint">
                            {matchCount} of {log.length} logged requests match · <Enriched text={describeFilter(codeFields.filter)} /> → {describeAction(codeFields.action)}
                        </div>
                    )}
                </div>
            ) : (
            <div className="aip-form aip-rule" ref={formRef}>
                <section className="aip-card" data-nav>
                    <h4>When a request matches <span className="aip-hint">{matchCount} of {log.length} logged</span></h4>
                    <div className="aip-pattern-row">
                        <select className="aip-method-pick" aria-label="Method (⌥M)" value={d.useMethod ? d.sample.method : "*"}
                            onChange={(e) => update(e.target.value === "*" ? { useMethod: false } : { useMethod: true, sample: { ...d.sample, method: e.target.value } })}>
                            <option value="*">any</option>
                            {(HTTP_METHODS.includes(d.sample.method) ? HTTP_METHODS : [d.sample.method, ...HTTP_METHODS]).map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <span className="aip-title-field aip-pattern-field">
                            <input ref={patternRef} className={`aip-pattern ${patternError ? "invalid" : ""}`} value={d.urlPattern} spellCheck={false} aria-label="URL pattern (⌥U)"
                                placeholder="any URL, e.g. https://host/api/:team/items/* or /api/*" aria-invalid={!!patternError}
                                title=":name matches one path segment, * any text (/ included); start with / for any origin. Query params: below."
                                onChange={(e) => setPattern(e.target.value)} />
                            <Kbd k="U" />
                        </span>
                    </div>
                    {patternError && <div className="aip-error">{patternError}</div>}
                    {/* the example request, part by part: click a part to change the pattern there. Inline text, not buttons
                        or flex items, so selecting part of it copies just that part */}
                    <div className="aip-url aip-example">
                        <span className="aip-example-label" title="Click a part to match anything there">Example</span>
                        <span className="aip-url-text">
                            <span role="button" tabIndex={0} className={`aip-part aip-origin ${patternOrigin ? "" : "any"}`}
                                title={patternOrigin ? "Click to match any origin (⌥O)" : "Any origin: click to match this one (⌥O)"}
                                onClick={() => setPattern(toggleOrigin(d.urlPattern, d.sample.url))} onKeyDown={activate(() => setPattern(toggleOrigin(d.urlPattern, d.sample.url)))}>
                                {u.origin}
                            </span>
                            {anyPath
                                ? <span role="button" tabIndex={0} className="aip-part aip-segment any many" title="Any path: click to match this one (⌥P)"
                                    onClick={() => setPattern(toggleAnyPath(d.urlPattern, d.sample.url))} onKeyDown={activate(() => setPattern(toggleAnyPath(d.urlPattern, d.sample.url)))}>/*</span>
                                : !segMatches
                                ? <span className="aip-part" title="The pattern doesn't line up with this URL's path: edit it above, or rebuild it from here">{u.pathname}</span>
                                : segments.map((seg, i) => {
                                    const m = segMatches[i];
                                    const toggle = () => setPattern(cycleSegment(d.urlPattern, d.sample.url, i));
                                    const shown = patternPath.split("/")[i + 1];
                                    if (seg === "") return <span key={i} className="aip-part">/</span>;
                                    return (
                                        <span key={i} role="button" tabIndex={0} title={m === "exact" ? "Click: match any one segment here (:name)" : m === "one" ? "Any one segment: click again for any text, / included (*)" : "Any text: click to match this segment exactly"}
                                            className={`aip-part aip-segment ${m !== "exact" ? "any" : ""} ${m === "many" ? "many" : ""}`}
                                            // a click that ends a text selection is for copying, not toggling
                                            onClick={(e) => { if (selectionIn(e.currentTarget)?.isCollapsed !== false) toggle(); }} onKeyDown={activate(toggle)}>
                                            /{m !== "exact" ? shown : <EntityOr text={seg} before={segments[i - 1]} />}
                                        </span>
                                    );
                                })}
                            {d.params.map((p, i) => {
                                const set = (patch: Partial<Draft["params"][number]>) => update({ params: d.params.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
                                return (
                                    <span key={i} className={`aip-part aip-param ${p.use ? "on" : "any"}`}>
                                        {i === 0 ? "?" : "&"}
                                        <span role="checkbox" aria-checked={p.use} tabIndex={0} className="aip-param-key"
                                            title={p.use ? `Matching ${p.key}: click to ignore it` : `Ignoring ${p.key}: click to match its value`}
                                            onClick={() => set({ use: !p.use })} onKeyDown={activate(() => set({ use: !p.use }))}>
                                            <span className="aip-param-mark" aria-hidden>{p.use ? "✓" : "+"}</span>{p.key}=
                                        </span>
                                        {p.use
                                            ? <input className="aip-param-value" value={p.value} aria-label={`${p.key} value`} size={Math.max(4, p.value.length)} onChange={(e) => set({ value: e.target.value })} />
                                            : <span>{p.value}</span>}
                                    </span>
                                );
                            })}
                        </span>
                        {!segMatches && !anyPath
                            ? <button className="aip-link aip-small" title="Replace the pattern with this URL's origin and path" onClick={() => setPattern(patternFromSample(d.sample.url))}>rebuild</button>
                            : !anyPath && segments.some(Boolean) && <button className="aip-link aip-small" title="Match any path (⌥P)" onClick={() => setPattern(toggleAnyPath(d.urlPattern, d.sample.url))}>any path</button>}
                        <Kbd k="P" />
                    </div>
                    {/* hiding it while the URL is invalid would hide the fix */}
                    <button className="aip-link aip-small" aria-expanded={showUrl} disabled={!urlValid}
                        onClick={() => { setEditingUrl(!showUrl); if (!showUrl) requestAnimationFrame(() => urlRef.current?.focus()); }}>
                        {showUrl ? "▾" : "▸"} Edit the example URL
                    </button>
                    {showUrl && (
                        <input ref={urlRef} value={urlText} aria-label="Example request URL" title="A request the pattern should match: click its parts above to build the pattern"
                            placeholder="https://host/api/items/1?param=value" onChange={(e) => changeUrl(e.target.value)} />
                    )}
                    {!urlValid && <div className="aip-error">Enter a full http(s) URL, e.g. https://host/path</div>}
                    <label><span>Body contains <Kbd k="B" /></span>
                        <input className="aip-body-input" value={d.bodyContains} placeholder="anything (optional)"
                            onChange={(e) => update({ bodyContains: e.target.value, useBody: !!e.target.value })} />
                    </label>
                </section>

                <section className="aip-card">
                    <h4>Then</h4>
                    <div className="aip-action-groups" role="radiogroup" aria-label="Action" data-nav>
                        {ACTION_GROUPS.map((g) => (
                            <div key={g.id} className={`aip-action-group ${g.id}`} role="group" aria-label={g.label}>
                                <span className="aip-action-group-label" title={g.hint}>{g.label}</span>
                                <div className="aip-chips">
                                    {ACTIONS.map((a, i) => a.group === g.id && (
                                        <label key={a.choice} className={`aip-chip ${d.choice === a.choice ? "on" : ""}`} title={a.hint}>
                                            <input type="radio" name="aip-action" value={a.choice} checked={d.choice === a.choice} onChange={() => update({ choice: a.choice })} />
                                            <ActionIcon choice={a.choice} />{a.label}<Kbd k={String(i + 1)} />
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="aip-action-detail">
                    <ActionHeading choice={d.choice} />
                    <div className="aip-action-fields" data-nav>
                    {d.choice === "pause" && (() => {
                        const auto = d.pauseAt === "request" ? d.auto.request : d.auto.response;
                        const automatic = d.automatic && !!auto;
                        const segmented = (name: string, label: string, options: [string, string, string?][], value: string, onPick: (v: string) => void) => (
                            <div className="aip-check aip-segmented" role="radiogroup" aria-label={label}>
                                <span className="aip-segmented-label">{label}</span>
                                <div className="aip-chips">
                                    {options.map(([v, text, disabledTitle]) => (
                                        <label key={v} className={`aip-chip ${value === v ? "on" : ""} ${disabledTitle ? "disabled" : ""}`} title={disabledTitle}>
                                            <input type="radio" name={name} value={v} checked={value === v} disabled={!!disabledTitle} onChange={() => onPick(v)} />{text}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        );
                        return (
                            <>
                                {segmented("aip-pause-at", "At", [["request", "Request"], ["response", "Response"]], d.pauseAt, (v) => update({ pauseAt: v as Draft["pauseAt"] }))}
                                {segmented("aip-pause-mode", "Do", [["ask", "Each time"], ["auto", "Automatic", auto ? undefined : `Tick Remember on a paused ${d.pauseAt} to make it automatic`]],
                                    automatic ? "auto" : "ask", (v) => update({ automatic: v === "auto" }))}
                                {!automatic && <div className="aip-hint">{d.pauseAt === "request"
                                    ? "In the palette: send it (edited or not), respond to it instead, or block it. Tick Remember there to do the same automatically."
                                    : "In the palette: edit its status and body, then release it. Tick Remember there to do the same automatically."}</div>}
                                {automatic && d.auto.request && d.pauseAt === "request" && (() => {
                                    const a = d.auto.request;
                                    const set = (patch: Partial<typeof a.edit>) => update({ auto: { ...d.auto, request: { ...a, edit: { ...a.edit, ...patch } } } });
                                    const setResponse = (patch: Partial<NonNullable<typeof a.response>>) => update({ auto: { ...d.auto, request: { ...a, response: { ...a.response!, ...patch } } } });
                                    const edited = Object.keys(a.edit).length > 0;
                                    return (
                                        <>
                                            <div className="aip-hint">
                                                {edited ? "Every matching request is sent as this one" : "Every matching request is sent as is"}
                                                {a.response ? ", and its response replaced with the one below" : ""}, without pausing.
                                            </div>
                                            {(a.edit.method !== undefined || a.edit.url !== undefined) && (
                                                <div className="aip-row">
                                                    {a.edit.method !== undefined && <label className="narrow">Method <input value={a.edit.method} onChange={(e) => set({ method: e.target.value.toUpperCase() })} /></label>}
                                                    {a.edit.url !== undefined && <label>URL <input value={a.edit.url} onChange={(e) => set({ url: e.target.value })} /></label>}
                                                </div>
                                            )}
                                            {a.edit.headers && Object.keys(a.edit.headers).length > 0 && (
                                                <div className="aip-field">Headers <span className="aip-hint">(pause again to change them)</span><Table rows={Object.entries(a.edit.headers)} /></div>
                                            )}
                                            {a.edit.body !== undefined && (
                                                <div className="aip-field">Request body
                                                    <CodeEditor value={a.edit.body} language={languageFor(a.edit.body, undefined)} onSubmit={save} onSave={save}
                                                        minHeight="100px" maxHeight="32vh" aria-label="Request body sent" onChange={(body) => set({ body })} />
                                                </div>
                                            )}
                                            {a.response && (
                                                <>
                                                    <label>Response status <StatusInput value={a.response.status} onChange={(status) => setResponse({ status })} /></label>
                                                    <div className="aip-field">Response body
                                                        <CodeEditor value={a.response.body} language={languageFor(a.response.body, undefined)} onSubmit={save} onSave={save}
                                                            minHeight="100px" maxHeight="32vh" aria-label="Response body returned" onChange={(body) => setResponse({ body })} />
                                                    </div>
                                                </>
                                            )}
                                        </>
                                    );
                                })()}
                                {automatic && d.auto.response && d.pauseAt === "response" && (() => {
                                    const a = d.auto.response;
                                    const set = (patch: Partial<typeof a.response>) => update({ auto: { ...d.auto, response: { ...a, response: { ...a.response, ...patch } } } });
                                    return (
                                        <>
                                            <div className="aip-hint">Every matching response is replaced with this one, without pausing.</div>
                                            <label>Status <StatusInput value={a.response.status} onChange={(status) => set({ status })} /></label>
                                            <div className="aip-field">Response body
                                                <CodeEditor value={a.response.body} language={languageFor(a.response.body, undefined)} onSubmit={save} onSave={save}
                                                    minHeight="100px" maxHeight="32vh" aria-label="Response body returned" onChange={(body) => set({ body })} />
                                            </div>
                                        </>
                                    );
                                })()}
                            </>
                        );
                    })()}
                    {d.choice === "mock" && (
                        <>
                            <div className="aip-row aip-wrap">
                                <label>Status <StatusInput value={d.mock.status} onChange={(status) => update({ mock: { ...d.mock, status } })} /></label>
                                <label>Content-Type <input value={d.mock.mime} onChange={(e) => update({ mock: { ...d.mock, mime: e.target.value } })} /></label>
                            </div>
                            <div className="aip-field">Body
                                <CodeEditor value={d.mock.body} language={languageFor(d.mock.body, d.mock.mime)} onSubmit={save} onSave={save} minHeight="100px" maxHeight="32vh"
                                    aria-label="Response body" onChange={(body) => update({ mock: { ...d.mock, body } })} />
                            </div>
                            <label className="aip-check">after
                                <input className="aip-inline" type="number" min={0} step={100} value={d.mock.delayMs} aria-label="Delay before answering, in milliseconds"
                                    onChange={(e) => update({ mock: { ...d.mock, delayMs: Number(e.target.value) } })} /> ms
                            </label>
                        </>
                    )}
                    {d.choice === "delay" && (
                        <label className="aip-check">by
                            <input className="aip-inline" type="number" min={0} step={100} value={d.delayMs} aria-label="Delay in milliseconds" onChange={(e) => update({ delayMs: Number(e.target.value) })} /> ms
                        </label>
                    )}
                    </div>
                    </div>
                </section>
                {modeError && <div className="aip-error aip-wide">{modeError}</div>}
            </div>
            )}
            <div className="aip-footer">
                {mode === "code"
                    ? <span>⌥J JSON off · ⌃Space complete · hover a property for help · <button className="aip-link" onMouseDown={(e) => e.preventDefault()} onClick={() => showEditorKeys()}
                        title="All the editor's keyboard shortcuts (F1 in the editor)">VS Code keys (⌘F, ⌘D, ⌥↑↓, ⌥Z wrap… F1 for all)</button></span>
                    : <span title="Tab / ⇧Tab: next / previous section · ↑↓←→: nearest field · ⌥N name · ⌥M ⌥U method / URL pattern · ⌥O ⌥P any origin / path · ⌥B body · ⌥1–6 action · ⌥J JSON">hold ⌥ for shortcuts</span>}
                <span data-nav className="aip-footer-actions">
                    <button onClick={onDone}>Cancel<ButtonKey k="esc" /></button>
                    <button className="primary" disabled={mode === "code" ? !codeFields : !urlValid || !!patternError} onClick={save}
                        title={mode === "code" ? "⌘S or ⌘↵" : "⌘S, or ↵ in a field"}>{d.ruleId ? "Save" : "Add rule"}<ButtonKey k="⌘S" /></button>
                </span>
            </div>
        </div>
    );
}
