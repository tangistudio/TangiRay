import { StatusInput } from "../shared/ui/StatusInput";
import { useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor, languageFor } from "../shared/ui/code-editor/CodeEditor";
import { runShortcut } from "../shared/ui/dead-keys";
import type { MockResponse, Pause, Rule, SiteState } from "../domain/types";
import { Enriched } from "./entities/Capsule";
import { ButtonKey } from "./Kbd";
import { prettyJson } from "./format";
import { useFieldNavigation } from "./rule-editor/field-navigation";

// -------------------------------------------------------------------------------------------------
// PAUSE EDITOR
// A paused request: edit and send it (method/body edits are replayed from the page and their
// response served), send it as is, respond to it on the spot (it's never sent), or block it;
// either send can also pause its response. A paused response: edit its body and release it.
// Clicking away (on the backdrop) sends, as the Send button does.
// "Remember" turns the rule from asking into doing it every time, without pausing: send this
// request, give this response, or replace the response with this one.
// -------------------------------------------------------------------------------------------------

export function PauseEditor({ pause, seq, site, store, onBack, onDecided, sendRef }: {
    pause: Pause;
    /** the request's #number in the log (unknown until the log has it) */
    seq?: number; site: SiteState; store: { rules: Rule[] }; onBack: () => void; onDecided: (awaitingResponse?: boolean) => void;
    /** set to this pause's Send, for the palette's backdrop */
    sendRef: React.MutableRefObject<(() => void) | null>;
}) {
    const [remember, setRemember] = useState(false);
    const [method, setMethod] = useState(pause.request.method);
    const [url, setUrl] = useState(pause.request.url);
    const [headers, setHeaders] = useState(JSON.stringify(pause.request.headers, null, 2));
    const [status, setStatus] = useState(pause.stage === "response" ? pause.status : 0);
    // a JSON response starts formatted; formatting alone isn't an edit (the original bytes go through)
    const initialBody = useMemo(() => (pause.stage === "response" ? prettyJson(pause.body) : pause.request.body ?? ""), [pause]);
    const [body, setBody] = useState(initialBody);
    const [error, setError] = useState<string | null>(null);
    // a paused request: answer it instead of sending it
    const [responding, setResponding] = useState(false);
    // a request sent: pause its response too, to edit it (⇧⌘↵ sends this way too)
    const [pauseResponseToo, setPauseResponseToo] = useState(false);
    const [mock, setMock] = useState<MockResponse>({ status: 200, mime: "application/json", body: "" });
    // a GET/HEAD without a body has none to edit (changing the method brings the editor back)
    const showBody = pause.stage === "response" || body !== "" || !["GET", "HEAD"].includes(method.trim());
    const urlRef = useRef<HTMLInputElement>(null);
    useEffect(() => urlRef.current?.focus(), []);
    const bodyLanguage = useMemo(() => {
        const contentType = pause.stage === "response" ? pause.mime
            : Object.entries(pause.request.headers).find(([k]) => k.toLowerCase() === "content-type")?.[1];
        return languageFor(initialBody, contentType);
    }, [pause, initialBody]);

    const decide = (decision: NonNullable<Pause["decision"]>) => {
        const live = site.pauses[pause.id];
        if (live) live.decision = decision;
        onDecided("pauseResponse" in decision && decision.pauseResponse);
    };

    /** `pauseResponse` (a request): pause its response too, to edit it. */
    const send = (pauseResponse = pauseResponseToo) => {
        setError(null);
        const badStatus = (n: number) => !Number.isInteger(n) || n < 200 || n > 599;
        if (pause.stage === "response") {
            if (badStatus(status)) {
                setError("The status must be between 200 and 599.");
                return;
            }
            const unchanged = body === initialBody && status === pause.status;
            if (remember && !unchanged) rememberResponse({ status, body });
            decide(unchanged ? { kind: "continue" } : { kind: "modify", status, body });
            return;
        }
        if (responding) {
            if (badStatus(mock.status)) {
                setError("The status must be between 200 and 599.");
                return;
            }
            if (remember) rememberOnRule({ type: "request", mode: "respond", delayMs: 0, response: mock });
            decide({ kind: "respond", ...mock });
            return;
        }
        let parsed: Record<string, string>;
        try {
            parsed = JSON.parse(headers);
        } catch (e) {
            setError(`Headers aren't valid JSON: ${(e as Error).message}`);
            return;
        }
        const original = pause.request;
        const unchanged = method === original.method && url === original.url && body === (original.body ?? "")
            && JSON.stringify(parsed) === JSON.stringify(original.headers);
        // the body only when there's one: a GET keeps each request's own (none)
        if (remember && !unchanged) rememberOnRule({ type: "request", mode: "send", delayMs: 0, edit: { method, url, headers: parsed, ...(showBody ? { body } : {}) } });
        decide(unchanged ? { kind: "continue", pauseResponse } : { kind: "modify", request: { method, url, headers: parsed, body }, pauseResponse });
    };

    useEffect(() => {
        const fn = () => send();
        sendRef.current = fn;
        return () => { if (sendRef.current === fn) sendRef.current = null; };
    });

    const pauseRule = () => store.rules.find((r) => r.id === pause.ruleId);
    // the rule asking at this stage; or, for a response paused from its request ("Send & pause
    // response"), the request rule: asking, or already sending a remembered request
    const askingRule = () => {
        const rule = pauseRule();
        const a = rule?.action;
        if (!a || !("mode" in a)) return undefined;
        if (a.type === pause.stage && a.mode === "ask") return rule;
        return pause.stage === "response" && a.type === "request" && (a.mode === "ask" || a.mode === "send") ? rule : undefined;
    };
    const rememberOnRule = (action: Rule["action"]) => {
        const rule = askingRule();
        if (rule) rule.action = action;
    };
    // on a request rule: send the request as remembered (or as is), then replace its response
    const rememberResponse = (response: { status: number; body: string }) => {
        const a = askingRule()?.action;
        if (a?.type === "request") rememberOnRule({ type: "request", mode: "send", delayMs: a.mode === "send" ? a.delayMs : 0, edit: a.mode === "send" ? a.edit : {}, response });
        else rememberOnRule({ type: "response", mode: "replace", delayMs: 0, response });
    };
    const canRemember = !!askingRule();
    const showRemember = canRemember && (pause.stage === "request" || showBody);
    const canSendAndPause = pause.stage === "request" && !responding;
    const fromRequest = pause.stage === "response" && pauseRule()?.action.type === "request";
    const rememberHint = fromRequest
        ? "Replace the response of every later request matching this rule with this status and body; the request is sent as remembered (or as is), without pausing (change it back in the rule editor)"
        : pause.stage === "response"
        ? "Replace every later response matching this rule with this status and body, without pausing (change it back in the rule editor)"
        : responding
        ? "Answer every later request matching this rule with this response, without pausing (change it back in the rule editor)"
        : "Send every later request matching this rule as this one (method, URL, headers and body), without pausing (change it back in the rule editor)";

    // ↑ / ↓ out of an editor's first / last line: the field or button before / after it
    const rootRef = useRef<HTMLDivElement>(null);
    const navigate = useFieldNavigation(rootRef);
    const arrowOut = (direction: "up" | "down") => {
        const fields = [...(rootRef.current?.querySelectorAll<HTMLElement>("input, textarea, select, button, .cm-content") ?? [])].filter((f) => f.getClientRects().length > 0);
        const active = fields.find((f) => f.contains((f.getRootNode() as Document | ShadowRoot).activeElement));
        const next = active && fields[fields.indexOf(active) + (direction === "up" ? -1 : 1)];
        next?.focus();
        return !!next;
    };

    const formatJson = () => {
        try { setBody(JSON.stringify(JSON.parse(body), null, 2)); } catch { setError("The body isn't valid JSON."); }
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.defaultPrevented) return;
        // esc: let it through untouched (edits are dropped); "Keep paused" goes back without deciding
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); decide({ kind: "continue" }); }
        else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(pauseResponseToo || (e.shiftKey && pause.stage === "request" && !responding)); }
        // e.code: on macOS ⌥ turns the key into another character
        else if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === "KeyK") runShortcut(e, onBack);
        // ↑↓←→ between fields, as in the rule editor
        else if (navigate(e)) e.preventDefault();
    };

    return (
        <div className="aip-root aip-editor" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
            <div className="aip-editor-title">
                <span className="aip-badge paused">⏸ {pause.stage}</span>{seq !== undefined && <span className="aip-hint">#{seq}</span>} {pause.ruleName || "unnamed rule"}
                {pause.stage === "response" && <> · <code>{pause.mime}</code></>}
            </div>
            <div className="aip-form">
                {pause.stage === "request" && (
                    <div className="aip-chips" role="radiogroup" aria-label="What to do with the request">
                        {[["send", "Send it"], ["respond", "Respond instead"]].map(([value, label]) => (
                            <label key={value} className={`aip-chip ${responding === (value === "respond") ? "on" : ""}`}>
                                <input type="radio" name="aip-pause-mode" checked={responding === (value === "respond")} onChange={() => setResponding(value === "respond")} />{label}
                            </label>
                        ))}
                    </div>
                )}
                {pause.stage === "request" && responding ? (
                    <>
                        <div className="aip-row aip-wrap">
                            <label>Status <StatusInput openOnFocus={false} value={mock.status} onChange={(n) => setMock({ ...mock, status: n })} /></label>
                            <label>Content-Type <input value={mock.mime} onChange={(e) => setMock({ ...mock, mime: e.target.value })} /></label>
                        </div>
                        <div className="aip-field">Response body
                            <CodeEditor value={mock.body} language={languageFor(mock.body, mock.mime)} onSubmit={() => send()} onArrowOut={arrowOut} autoFocus
                                minHeight="200px" maxHeight="48vh" aria-label="Response body to answer with" onChange={(b) => setMock({ ...mock, body: b })} />
                        </div>
                    </>
                ) : pause.stage === "request" ? (
                    <>
                        <div className="aip-row">
                            <label className="narrow">Method <input value={method} onChange={(e) => setMethod(e.target.value.toUpperCase())} /></label>
                            <label>URL <input ref={urlRef} value={url} onChange={(e) => setUrl(e.target.value)} /></label>
                        </div>
                        <div className="aip-field">Headers (JSON)
                            <CodeEditor value={headers} language="json" onSubmit={() => send()} onArrowOut={arrowOut} minHeight="80px" maxHeight="22vh" aria-label="Headers" onChange={setHeaders} />
                        </div>
                    </>
                ) : (
                    <>
                        <div className="aip-hint"><span className="aip-method">{pause.request.method}</span> <code><Enriched text={pause.request.url} /></code></div>
                        <label className="aip-pause-status">Status <StatusInput openOnFocus={false} value={status} onChange={setStatus} /></label>
                    </>
                )}
                {showBody && !responding && <div className="aip-field">
                    <span className="aip-field-head">{pause.stage === "request" ? "Body" : "Response body"}
                        <button className="aip-link aip-small" onClick={formatJson} title="Format the body as JSON">Format JSON</button>
                    </span>
                    <CodeEditor value={body} language={bodyLanguage} onSubmit={() => send()} onArrowOut={arrowOut} autoFocus={pause.stage === "response"}
                        minHeight={pause.stage === "request" ? "120px" : "260px"} maxHeight={pause.stage === "request" ? "32vh" : "52vh"}
                        aria-label={pause.stage === "request" ? "Request body" : "Response body"} onChange={setBody} />
                </div>}
                {error && <div className="aip-error">{error}</div>}
                {(canSendAndPause || showRemember) && (
                    <div className="aip-pause-options">
                        {canSendAndPause && <label className="aip-check" title="Send it (with your edits), then pause its response to edit it (⇧⌘↵ does it once)">
                            <input type="checkbox" checked={pauseResponseToo} onChange={(e) => setPauseResponseToo(e.target.checked)} /> Pause its response too
                        </label>}
                        {showRemember && <label className="aip-check" title={rememberHint}>
                            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember {pause.stage === "response" || responding ? "this response" : "these edits"} for next time
                        </label>}
                    </div>
                )}
            </div>
            <div className="aip-footer">
                <span className="aip-footer-actions">
                    <button className="aip-quiet" onClick={onBack} title="Back to the list; it stays paused (5 min max)">Keep paused<ButtonKey k="⌥K" /></button>
                    {pause.stage === "request" && <button className="aip-quiet" onClick={() => decide({ kind: "block" })} title="Fail the request, as a network error">Block</button>}
                </span>
                <span className="aip-footer-actions">
                    <button onClick={() => decide({ kind: "continue" })} title={`${pause.stage === "request" ? "Send" : "Release"} the original, without your edits`}>{pause.stage === "request" ? "Send" : "Release"} original<ButtonKey k="esc" /></button>
                    <button className="primary" onClick={() => send()}>{responding ? "Respond" : pause.stage === "response" ? "Release" : "Send"}<ButtonKey k="⌘↵" /></button>
                </span>
            </div>
        </div>
    );
}
