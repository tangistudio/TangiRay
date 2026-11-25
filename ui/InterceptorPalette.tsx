import { useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { PaletteFrame } from "../shared/ui/dock";
import { type Directory, learnPathTemplates, mergeHints } from "../domain/entities";
import { trackHistory } from "../domain/history";
import type { LoggedRequest, PageClick, PageNavigation, PageState, Pause, SiteState, TransactionSource } from "../domain/types";
import { livePlugins } from "../plugin";
import { pageState as page, palette, pluginSwitches, prefs, store } from "../state";
import { ExportRules } from "./ExportRules";
import { ImportRules } from "./ImportRules";
import { PauseEditor } from "./PauseEditor";
import { copyCapsulesRaw, DirectoryContext } from "./entities/Capsule";
import { ListView } from "./list/ListView";
import { RuleEditor } from "./rule-editor/RuleEditor";
import { blankDraft, type Draft } from "./rule-editor/draft";

// -------------------------------------------------------------------------------------------------
// TANGIRAY PALETTE
// list: paused requests, then rules (Enter toggles), then the page's requests in execution
// order (Enter makes a rule from it; ⌥N makes one from scratch). Editors and the rules import
// cover the list until Esc, then it's back as it was, focused.
// -------------------------------------------------------------------------------------------------

export interface InterceptorPaletteProps {
    /** paused requests/responses (shared with the page's fetch/XHR patch) */
    site: SiteState;
    /** full transactions recorded in the page */
    transactions: TransactionSource;
    /** saves a file the user exports */
    download: (filename: string, text: string, mime: string) => Promise<void>;
    /** the page's origin: where a rule made from scratch starts */
    origin: string;
}

type View = { kind: "list" } | { kind: "rule"; draft: Draft } | { kind: "pause"; id: string } | { kind: "import-rules" } | { kind: "export-rules"; picked: string[] };

export function InterceptorPalette({ site, transactions, download, origin }: InterceptorPaletteProps) {
    const { open } = useSnapshot(palette);
    const { directory, entities: fromResponses, log, pauseFlash = 0 } = useSnapshot(page) as PageState;
    const [flashing, setFlashing] = useState(0);
    const seenFlash = useRef(pauseFlash);
    useEffect(() => {
        if (pauseFlash !== seenFlash.current) {
            seenFlash.current = pauseFlash;
            if (open) setFlashing(pauseFlash);
        }
    }, [pauseFlash, open]);
    useEffect(() => { if (!open) setFlashing(0); }, [open]);
    const { rules } = useSnapshot(store);
    // the page's state is the authority; responses add what it doesn't have
    const DirectoryProvider = DirectoryContext().Provider;
    // only the entity plugins switched on now: the names found stay in the page's state, for when one is switched back on
    const { off: pluginsOff } = useSnapshot(pluginSwitches);
    const entityPlugins = livePlugins(pluginsOff).filter((p) => p.entities);
    const entityKey = entityPlugins.map((p) => p.id).join(" ");
    const ids = useMemo(() => (entityKey ? { ...fromResponses, ...directory.ids } : {}), [fromResponses, directory, entityKey]);
    const hints = useMemo(() => mergeHints(entityPlugins.map((p) => p.entities?.hints)), [entityKey]); // eslint-disable-line react-hooks/exhaustive-deps
    // path shapes come from the URLs seen: the page's requests and the rules' samples
    const urls = [...new Set([...log.map((e) => e.url), ...rules.map((r) => r.sample.url)])].join("\n");
    const merged = useMemo<Directory>(() => ({ ids, hints, pathTemplates: learnPathTemplates(urls.split("\n"), ids, hints.opaqueId) }), [ids, hints, urls]);
    const { pauses } = useSnapshot(site) as SiteState;
    const [view, setView] = useState<View>({ kind: "list" });
    // kept here, not in the list: paused updates stay paused through the editors
    const [frozenLog, setFrozenLog] = useState<{ log: readonly LoggedRequest[]; navigations: readonly PageNavigation[]; clicks: readonly PageClick[] } | null>(null);
    // here too, so it records what the editors save
    const history = useRef<ReturnType<typeof trackHistory> | null>(null);
    useEffect(() => {
        history.current = trackHistory(store);
        return history.current.dispose;
    }, []);
    const close = () => { palette.open = false; palette.openedByPause = false; };
    // clicking away from a paused request or response sends it
    const pauseSend = useRef<(() => void) | null>(null);
    const toList = () => { setFlashing(0); setView({ kind: "list" }); };

    // jump to a newly paused request unless the user is busy in an editor
    const pauseIds = Object.keys(pauses);
    const seen = useRef(new Set<string>());
    useEffect(() => {
        const fresh = pauseIds.find((id) => !seen.current.has(id) && !pauses[id].decision);
        seen.current = new Set(pauseIds);
        if (fresh && view.kind === "list") setView({ kind: "pause", id: fresh });
    }, [pauseIds.join()]); // eslint-disable-line react-hooks/exhaustive-deps

    // a pause that timed out or was answered elsewhere: leave its editor
    useEffect(() => {
        if (view.kind === "pause" && !pauses[view.id]) toList();
    }, [view, pauses]);

    return (
        <DirectoryProvider value={merged}>
        <PaletteFrame name="api-interceptor" label="TangiRay"
            className={`aip-backdrop${flashing ? ` aip-flash-${flashing % 2 ? "a" : "b"}` : ""}`} open={open} onCopy={copyCapsulesRaw}
            onAnimationEnd={(e) => { if (e.animationName.startsWith("aip-flash-")) setFlashing(0); }}
            onDismiss={() => {
                if (view.kind === "pause" && pauseSend.current) pauseSend.current();
                else close();
            }}>
            {view.kind === "rule" && <RuleEditor key={view.draft.ruleId ?? view.draft.sample.url} initial={view.draft} store={store} page={page} prefs={prefs}
                onDone={toList} />}
            {view.kind === "import-rules" && <ImportRules store={store} onDone={toList} />}
            {view.kind === "export-rules" && <ExportRules store={store} picked={view.picked} download={download} onDone={toList} />}
            {view.kind === "pause" && pauses[view.id] && <PauseEditor key={view.id} pause={pauses[view.id] as Pause} site={site} store={store} sendRef={pauseSend}
                seq={log.find((e) => e.id === pauses[view.id].logId)?.seq}
                onBack={toList}
                onDecided={(awaitingResponse) => {
                    const next = Object.keys(site.pauses).find((id) => id !== view.id && !site.pauses[id].decision);
                    // another pause takes this one's place: flash, or the swap goes unnoticed (a↔b restarts a running flash)
                    setFlashing(next ? (f) => f + 1 : 0);
                    setView(next ? { kind: "pause", id: next } : { kind: "list" });
                    // its response pauses next: the list waits for it (and jumps to it)
                    if (!next && !awaitingResponse && palette.openedByPause) close();
                }} />}
            {/* last, so an editor is the frame's first child (its panel when docked); kept behind the editors,
                not unmounted, so they go back to the list as it was: tab, search, selection, scroll */}
            <ListView open={open} behind={view.kind !== "list" && (view.kind !== "pause" || !!pauses[view.id])} prefs={prefs} store={store} page={page} site={site} transactions={transactions} onClose={close}
                frozenLog={frozenLog} onFreeze={setFrozenLog} download={download}
                onUndo={() => history.current?.undo()} onRedo={() => history.current?.redo()}
                onEditRule={(draft) => setView({ kind: "rule", draft })}
                onNewRule={() => setView({ kind: "rule", draft: blankDraft(origin) })}
                onImport={() => setView({ kind: "import-rules" })}
                onExport={(picked) => setView({ kind: "export-rules", picked })}
                onOpenPause={(id) => setView({ kind: "pause", id })} />
        </PaletteFrame>
        </DirectoryProvider>
    );
}
