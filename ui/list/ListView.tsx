import { tweak } from "tangitweak";
import { newId } from "../../shared/util/id";
import { Fragment, useContext, useEffect, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { Command } from "cmdk";
import { docks, DockSwitch } from "../../shared/ui/dock";
import { matchesWordStarts, tokenWords } from "../../shared/search/word-starts";
import { entityNames } from "../../domain/entities";
import { describeAction, describeFilter, matches } from "../../domain/filter";
import { foldKeyer, foldRuleId } from "../../domain/log";
import { type EditorPrefs, isListAction, type ListTab, type LoggedRequest, type PageClick, type PageNavigation, type PageState, type Pause, type Rule, type RuleStore, type SiteState, type TransactionSource } from "../../domain/types";
import { addFolder, allFolders, deleteFolder, type FolderNode, folderName, folderTree, isWithin, joinFolder, moveFolder, moveFolderInto, moveRule, newFolderPath, parentFolder, rulesWithin } from "../../domain/folders";
import { buildHar } from "../../export/har";
import type { InterceptorPaletteProps } from "../InterceptorPalette";
import { DirectoryContext, Enriched, EnrichedUrl } from "../entities/Capsule";
import { entryPlugin, pagePlugins, palettePlugins } from "../../plugin";
import { MoreMenu } from "../MoreMenu";
import { pluginSwitches } from "../../state";
import { formatRequestGap, shortUrl } from "../format";
import { type Draft, draftFromRequest, draftFromRule, fieldsFromDraft } from "../rule-editor/draft";
import { RequestDetails } from "./RequestDetails";
import { Splitter } from "./Splitter";
import { FolderPreview, RulePreview } from "./RulePreview";
import { foldRepeats, requestGaps, type Row, rowValue, timelineMarkers } from "./fold";
import { useScrollAnchor } from "./scroll-anchor";
import { runShortcut } from "../../shared/ui/dead-keys";

// -------------------------------------------------------------------------------------------------
// LIST
// -------------------------------------------------------------------------------------------------

/** For buttons inside list items, which all have shortcuts: out of the Tab order, and a click leaves focus in the search box (where the list's keys work). */
const LIST_BUTTON = { tabIndex: -1, onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

export function ListView({ open, behind = false, prefs, store, page, site, transactions, download, frozenLog, onFreeze, onClose, onEditRule, onNewRule, onImport, onExport, onOpenPause, onUndo, onRedo }: {
    open: boolean;
    /** covered by an editor: hidden, but kept as it is for when the editor's done */
    behind?: boolean;
    prefs: EditorPrefs;
    store: RuleStore;
    page: PageState;
    site: SiteState;
    transactions: TransactionSource;
    download: InterceptorPaletteProps["download"];
    /** the requests shown while updates are paused (they keep being recorded) */
    frozenLog: { log: readonly LoggedRequest[]; navigations: readonly PageNavigation[]; clicks: readonly PageClick[] } | null;
    onFreeze: (log: { log: readonly LoggedRequest[]; navigations: readonly PageNavigation[]; clicks: readonly PageClick[] } | null) => void;
    onClose: () => void;
    onEditRule: (draft: Draft) => void;
    onNewRule: () => void;
    onImport: () => void;
    /** opens the export, with these rules picked */
    onExport: (picked: string[]) => void;
    onOpenPause: (id: string) => void;
    /** undo / redo the last change to the rules and folders */
    onUndo: () => void;
    onRedo: () => void;
}) {
    const snap = useSnapshot(store) as RuleStore;
    const { rules } = snap;
    const { log: liveLog, navigations: liveNavigations = [], clicks: liveClicks = [], hideHits } = useSnapshot(page) as PageState;
    const log = frozenLog?.log ?? liveLog;
    const navigations = frozenLog?.navigations ?? liveNavigations;
    const clicks = frozenLog?.clicks ?? liveClicks;
    const togglePaused = () => onFreeze(frozenLog ? null : { log: liveLog, navigations: liveNavigations, clicks: liveClicks });
    const { pauses } = useSnapshot(site) as SiteState;
    const tab: ListTab = useSnapshot(prefs).listTab ?? "requests";
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState("");
    const [showHidden, setShowHidden] = useState(false);
    // hide rules sit folded in one row of the rules: they're there to declutter, not to be looked at
    const [hidesOpen, setHidesOpen] = useState(false);
    const toggleShowHidden = () => { setShowHidden(!showHidden); setHidesOpen(!showHidden); };
    // fold keys of the repeated-request groups the user unfolded
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const toggleFold = (row: Row, open: boolean) => {
        if (!row.foldKey) return;
        const key = row.foldKey;
        setExpanded((prev) => {
            const next = new Set(prev);
            if (open) next.add(key); else next.delete(key);
            return next;
        });
        // the folded row goes away: keep its newest request selected, not cmdk's fallback (the first item)
        if (open) setSelected(`req:${row.entry.id}`);
    };
    const inputRef = useRef<HTMLInputElement>(null);
    const wasOpen = useRef(open);

    useEffect(() => {
        if (open && !wasOpen.current) inputRef.current?.select();
        wasOpen.current = open;
    }, [open]);
    // back from an editor: focus where the list left off
    useEffect(() => { if (!behind) inputRef.current?.focus(); }, [behind]);

    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    const dir = useContext(DirectoryContext());
    const hit = (...texts: (string | undefined)[]) => {
        const raw = texts.join(" ");
        const haystack = raw.toLowerCase();
        let tokens: string[][] | undefined;
        return words.every((w) => haystack.includes(w) || (w.length >= 3 && (tokens ??= tokenWords(raw)).some((t) => matchesWordStarts(t, w))));
    };
    const visiblePauses = Object.values(pauses).filter((p) => !p.decision && hit(p.stage, p.request.method, p.request.url, entityNames(p.request.url, dir), p.ruleName));
    const visibleRules = rules.filter((r) => hit(r.name, r.tags.join(" "), r.folder, describeFilter(r.filter), entityNames(describeFilter(r.filter), dir), describeAction(r.action)));
    // FOLDERS: a search shows the folders holding what it found, unfolded
    const prefsSnap = useSnapshot(prefs);
    const pathOnly = prefsSnap.hideUrlQuery === true;
    // the details panel: beside the list, or below it in a docked palette (narrow), each its own size
    const stacked = (useSnapshot(docks).sides["api-interceptor"] ?? "center") !== "center";
    const sizeKey = stacked ? "dockedDetailsSize" : "detailsSize";
    const [dragSize, setDragSize] = useState<number | null>(null);
    const detailsSize = dragSize ?? prefsSnap[sizeKey] ?? 0.45;
    const collapsed = new Set(prefsSnap.collapsedFolders ?? []);
    const setCollapsed = (path: string, fold: boolean) => {
        const next = new Set(prefs.collapsedFolders ?? []);
        if (fold) next.add(path); else next.delete(path);
        prefs.collapsedFolders = [...next];
    };
    const folderSet = allFolders(snap);
    const tree = folderTree(visibleRules, words.length ? [...folderSet].filter((p) => visibleRules.some((r) => isWithin(r.folder ?? "", p))) : folderSet);
    const isOpen = (path: string) => words.length > 0 || !collapsed.has(path);
    // top-level hide rules sit folded in one row (see below); in folders they're listed like the rest
    const otherRules = tree.rules.filter((r) => r.action.type !== "hide");
    const hideRules = tree.rules.filter((r) => r.action.type === "hide");
    type TreeRow = { kind: "folder"; node: FolderNode; depth: number } | { kind: "rule"; rule: Rule; depth: number };
    const folderRows = (node: FolderNode, depth: number): TreeRow[] => node.folders.flatMap((f) => [
        { kind: "folder" as const, node: f, depth },
        ...(isOpen(f.path) ? [...folderRows(f, depth + 1), ...f.rules.map((rule) => ({ kind: "rule" as const, rule, depth: depth + 1 }))] : []),
    ]);
    const treeRows = folderRows(tree, 0);
    const [renaming, setRenaming] = useState<string | null>(null);
    // a search lists the hide rules it matches
    const hidesListed = hidesOpen || words.length > 0;
    const hideFilters = rules.filter((r) => r.enabled && r.action.type === "hide").map((r) => r.filter);
    const isHidden = (e: LoggedRequest) => hideFilters.some((f) => matches(f, e.method, e.url, e.body));
    const hiddenCount = hideFilters.length ? log.filter(isHidden).length : 0;
    const frozenSeq = frozenLog?.log.at(-1)?.seq ?? 0;
    const newCount = frozenLog ? liveLog.filter((e) => e.seq > frozenSeq && !isHidden(e)).length : 0;
    // the plugins' hooks: their list is fixed for the page, so they're called in the same order each render
    const pluginShown = new Map(palettePlugins().map((p) => [p.id, p.entries?.useShown?.()]));
    const ownItems = new Map(palettePlugins().map((p) => [p.id, p.useMenuItems?.() ?? []]));
    const switchedOff = useSnapshot(pluginSwitches).off;
    // each plugin for the page: its on/off switch, then (while it's on for this page load) its own switches
    const pluginMenuItems = pagePlugins().flatMap((p, i) => {
        const on = !switchedOff.includes(p.id);
        const pending = on !== ownItems.has(p.id);
        return [
            { icon: "⧉", label: p.name, checked: on, separator: i > 0,
                title: `Switch the ${p.name} plugin ${on ? "off" : "on"}${pending ? " (reload the page to apply the change)" : " (from the next page load)"}`,
                onSelect: () => { pluginSwitches.off = on ? [...switchedOff, p.id] : switchedOff.filter((id) => id !== p.id); } },
            ...(ownItems.get(p.id) ?? []),
        ];
    });
    const summaryOf = (e: LoggedRequest) => entryPlugin(e)?.entries?.summary(e);
    const visibleLog = log.filter((e) => (showHidden || !isHidden(e)) && (!e.source || (pluginShown.get(e.source)?.(e) ?? true))
        && hit(e.method, e.url, entityNames(e.url, dir), String(e.status ?? ""), e.outcome, ...(summaryOf(e)?.search ?? [])));
    // a plugin's entries aren't HTTP requests: HAR can't hold them
    const harLog = visibleLog.filter((e) => !e.source);
    // where each folded group sits (the seq of its newest request when first shown): kept while the palette is open,
    // so repeating requests don't keep reordering the list
    const foldPlaces = useRef(new Map<string, number>());
    if (open && !wasOpen.current) foldPlaces.current.clear();
    const favouriteRules = rules.filter((r) => r.enabled && r.action.type === "favourite");
    const favouritesOf = (e: LoggedRequest) => favouriteRules.filter((r) => matches(r.filter, e.method, e.url, e.body));
    const isFavourite = (e: LoggedRequest) => favouriteRules.some((r) => matches(r.filter, e.method, e.url, e.body));
    // favourites pinned at the top, each part in its usual order
    const foldRules = rules.filter((r) => r.enabled && r.action.type === "fold");
    const allRows = foldRepeats(visibleLog, expanded, foldPlaces.current, foldKeyer(foldRules), prefsSnap.foldSimilarRequests !== false);
    /** The fold rule that folded a group (by its key), named. */
    const foldedBy = (key: string | undefined) => {
        const rule = key ? foldRules.find((r) => r.id === foldRuleId(key)) : undefined;
        return rule && (rule.name || describeFilter(rule.filter));
    };
    const rows = prefsSnap.showFavouritesAtTop !== false && favouriteRules.length ? [...allRows.filter((r) => isFavourite(r.entry)), ...allRows.filter((r) => !isFavourite(r.entry))] : allRows;
    const gaps = requestGaps(rows, log);
    const markers = timelineMarkers(rows, prefsSnap.showPageBreaks === false ? [] : navigations, prefsSnap.showClickBreaks === false ? [] : clicks);
    // hovering an item selects it too (cmdk), so this follows the mouse and the arrow keys
    // a selected request that just got folded into a group: the group's row takes over
    const foldedInto = selected.startsWith("req:") ? rows.find((r) => r.folded?.some((e) => e.id === selected.slice(4))) : undefined;
    useEffect(() => {
        if (foldedInto) setSelected(rowValue(foldedInto));
    }, [foldedInto && rowValue(foldedInto)]); // eslint-disable-line react-hooks/exhaustive-deps
    const selectedRow = foldedInto ?? rows.find((r) => rowValue(r) === selected);
    // a paused request or response: its logged request (or, until the log has it, what the pause holds)
    const selectedPause = selected.startsWith("pause:") ? (pauses[selected.slice(6)] as Pause | undefined) : undefined;
    const pauseEntry = selectedPause && (liveLog.find((e) => e.id === selectedPause.logId) ?? {
        id: selectedPause.id, seq: 0, method: selectedPause.request.method, url: selectedPause.request.url, headers: selectedPause.request.headers,
        body: selectedPause.request.body, startedAt: selectedPause.createdAt, ruleIds: [selectedPause.ruleId],
    });
    const selectedRequest = pauseEntry ?? selectedRow?.entry;
    // PINNED: a clicked request stays in the details panel while the mouse and keys move through the list.
    // Pinned in a folded group, the group's row stands for it (its newest request); filtered out, the log still has it
    const [pinnedId, setPinnedId] = useState<string | null>(null);
    // the pin before a click: a double-click's first click toggled it, the double-click puts it back
    const pinBeforeClick = useRef<string | null>(null);
    const pinnedRow = pinnedId ? rows.find((r) => r.entry.id === pinnedId || r.folded?.some((f) => f.id === pinnedId)) : undefined;
    const pinnedEntry = pinnedRow?.entry ?? (pinnedId ? log.find((e) => e.id === pinnedId) : undefined);
    const pinning = tab === "requests" && !!pinnedEntry;
    const togglePin = (row: Row) => {
        const on = pinnedRow ? rowValue(pinnedRow) === rowValue(row) : pinnedId === row.entry.id;
        setPinnedId(on ? null : row.entry.id);
        setSelected(rowValue(row));
    };
    const detailsRow = pinning ? pinnedRow : selectedRow;
    const listRef = useRef<HTMLDivElement>(null);
    const ruleValues = [...treeRows.map((t) => (t.kind === "folder" ? `folder:${t.node.path}` : `rule:${t.rule.id}`)), ...otherRules.map((r) => `rule:${r.id}`), ...(hideRules.length ? ["hides"] : []), ...(hidesListed ? hideRules.map((r) => `rule:${r.id}`) : [])];
    const pauseValues = visiblePauses.map((p) => `pause:${p.id}`);
    const tabValues = (t: ListTab) => [...pauseValues, ...(t === "rules" ? ruleValues : rows.map(rowValue))];
    useScrollAnchor(listRef, tabValues(tab).join("|") + (tab === "requests" ? `|gaps:${gaps.map((gap) => gap === undefined ? "0" : "1").join("")}|markers:${JSON.stringify(markers)}` : ""), search + tab);

    // each tab keeps its selection while you're on the other
    const lastSelected = useRef<Partial<Record<ListTab, string>>>({});
    const switchTab = (to: ListTab) => {
        if (to === tab) return;
        lastSelected.current[tab] = selected;
        prefs.listTab = to;
        const values = tabValues(to);
        const back = lastSelected.current[to];
        setSelected(back && values.includes(back) ? back : values[0] ?? "");
    };
    const TABS: ListTab[] = ["requests", "rules"];
    const cycleTab = (step: 1 | -1) => switchTab(TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]);

    const rule = (id: string) => store.rules.find((r) => r.id === id);
    const removeRule = (id: string) => {
        const i = store.rules.findIndex((r) => r.id === id);
        if (i >= 0) store.rules.splice(i, 1);
    };
    // the copy goes right below, off (an enabled copy would act twice), and gets selected
    const duplicateRule = (id: string) => {
        const i = store.rules.findIndex((r) => r.id === id);
        if (i < 0) return;
        const copy: Rule = { ...JSON.parse(JSON.stringify(store.rules[i])), id: newId(), name: `${store.rules[i].name || describeFilter(store.rules[i].filter)} (copy)`, enabled: false, hits: 0 };
        store.rules.splice(i + 1, 0, copy);
        setSelected(`rule:${copy.id}`);
    };
    // ☆ on a request: a favourite rule for its method and URL (query ignored); ★: drop the favourite rules it matches
    const toggleFavourite = (e: LoggedRequest) => {
        const stars = favouritesOf(e);
        if (stars.length) {
            for (const star of stars) removeRule(star.id);
            return;
        }
        store.rules.push({ ...fieldsFromDraft({ ...draftFromRequest(e), choice: "favourite" }), id: newId(), hits: 0 });
    };
    const editRule = (id: string) => {
        const r = rule(id);
        if (r) onEditRule(draftFromRule(r));
    };
    // a rule a request's preview links to: in the rules tab, unfiltered, its folders unfolded, scrolled to
    const scrollTo = useRef<string | null>(null);
    const showRule = (id: string) => {
        const r = rule(id);
        if (!r) return;
        switchTab("rules");
        setSearch("");
        for (let f = r.folder ?? ""; f; f = parentFolder(f)) setCollapsed(f, false);
        if (!r.folder && r.action.type === "hide") setHidesOpen(true);
        setSelected(`rule:${id}`);
        scrollTo.current = `rule:${id}`;
    };
    const showRequest = (entry: LoggedRequest) => {
        switchTab("requests");
        setSearch("");
        if (isHidden(entry)) setShowHidden(true);
        const key = foldKeyer(foldRules)(entry);
        setExpanded((prev) => new Set(prev).add(key));
        setSelected(`req:${entry.id}`);
        scrollTo.current = `req:${entry.id}`;
        inputRef.current?.focus();
    };
    useEffect(() => {
        if (!scrollTo.current || selected !== scrollTo.current) return;
        listRef.current?.querySelector(`[data-value="${CSS.escape(scrollTo.current)}"]`)?.scrollIntoView({ block: "center" });
        scrollTo.current = null;
    });

    // hide rules count per page (they only matter to this page's list), others since they were made
    const ruleHits = (r: Rule) => (isListAction(r.action.type) ? hideHits?.[r.id] ?? 0 : r.hits);
    const selectedRule = selected.startsWith("rule:") ? rules.find((r) => `rule:${r.id}` === selected) : undefined;

    // DRAG AND DROP: rules and folders onto a folder (into it), onto a rule (its top half: before it, its
    // bottom half: after it, in its folder), or onto the list's blank space (the end of the top level).
    // Dragging a picked rule (⇧click / ⇧↑↓) takes all the picked ones, in their order.
    type Dragged = { kind: "rule"; ids: string[] } | { kind: "folder"; path: string };
    type DropTarget = { folder: string } | { rule: Rule; after?: boolean };
    const [dragged, setDragged] = useState<Dragged | null>(null);
    const [dropOn, setDropOn] = useState<string | null>(null);
    const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
    const pick = (ids: string[], on?: boolean) => setPicked((prev) => {
        const next = new Set(prev);
        for (const id of ids) if (on ?? !next.has(id)) next.add(id); else next.delete(id);
        return next;
    });
    // ⇧↑↓: cmdk moves the selection; the rule it lands on joins the picked
    const extending = useRef(false);
    useEffect(() => {
        if (extending.current && selected.startsWith("rule:")) pick([selected.slice(5)], true);
        extending.current = false;
    }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
    // closing the palette (a click outside it) unpicks
    useEffect(() => { if (!open) setPicked(new Set()); }, [open]);
    /** the folder `d` would go to dropped on `target` ("" top level); null: it can't go there */
    const dropInto = (d: Dragged, target: DropTarget): string | null => {
        const folder = "folder" in target ? target.folder : target.rule.folder ?? "";
        if (d.kind === "rule") return "rule" in target && d.ids.includes(target.rule.id) ? null : folder;
        if (isWithin(folder, d.path) || parentFolder(d.path) === folder) return null;
        return folder;
    };
    const drop = (d: Dragged, target: DropTarget) => {
        const folder = dropInto(d, target);
        if (folder === null) return;
        if (d.kind === "rule") {
            const before = "rule" in target ? (target.after ? ruleAfter(target.rule, d.ids) : target.rule.id) : undefined;
            for (const id of d.ids) moveRule(store, id, folder, before);
        }
        else if (moveFolderInto(store, d.path, folder)) setSelected(`folder:${joinFolder(folder, folderName(d.path))}`);
        if (folder) setCollapsed(folder, false);
    };
    /** the id of the rule after `r` in its folder, `skip` aside; undefined: `r` is its folder's last */
    const ruleAfter = (r: Rule, skip: string[]) => {
        const i = store.rules.findIndex((x) => x.id === r.id);
        return store.rules.slice(i + 1).find((x) => !skip.includes(x.id) && (x.folder ?? "") === (r.folder ?? ""))?.id;
    };
    const endDrag = () => { setDragged(null); setDropOn(null); };
    const dnd = (self: Dragged, value: string, target: DropTarget) => {
        const at = (e: React.DragEvent): DropTarget => {
            if (!("rule" in target)) return target;
            const box = e.currentTarget.getBoundingClientRect();
            return { rule: target.rule, after: e.clientY > box.top + box.height / 2 };
        };
        return {
            draggable: renaming === null,
            onDragStart: (e: React.DragEvent) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", value);
                setDragged(self.kind === "rule" && picked.has(self.ids[0]) ? { kind: "rule", ids: store.rules.filter((r) => picked.has(r.id)).map((r) => r.id) } : self);
            },
            onDragEnd: endDrag,
            onDragOver: (e: React.DragEvent) => {
                const t = at(e);
                if (!dragged || dropInto(dragged, t) === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const on = "after" in t && t.after ? `${value}|after` : value;
                if (dropOn !== on) setDropOn(on);
            },
            onDragLeave: () => setDropOn((v) => (v === value || v === `${value}|after` ? null : v)),
            onDrop: (e: React.DragEvent) => { e.preventDefault(); if (dragged) drop(dragged, at(e)); endDrag(); },
        };
    };
    const dropClass = (value: string, kind: "into" | "before") =>
        (dropOn === value ? ` aip-drop-${kind}` : kind === "before" && dropOn === `${value}|after` ? " aip-drop-after" : "");
    /** Where a drop on the list's blank space (null: on a row, which handles it) goes, and its `dropOn`. */
    const blankTarget = (e: React.DragEvent): { target: DropTarget; on: string } | null => {
        if ((e.target as HTMLElement).closest("[cmdk-item]")) return null;
        const first = listRef.current?.querySelector<HTMLElement>('[cmdk-item][data-value^="rule:"], [cmdk-item][data-value^="folder:"]');
        const firstRule = first?.dataset.value?.startsWith("rule:") ? rule(first.dataset.value.slice(5)) : undefined;
        if (first && firstRule) {
            const box = first.getBoundingClientRect();
            if (e.clientY < box.top + box.height / 2) return { target: { rule: firstRule }, on: `rule:${firstRule.id}` };
        }
        return { target: { folder: "" }, on: "root" };
    };
    // a step clears a folder's chevron (18px) and then some, so what's in a folder sits right of its toggle;
    // --aip-indent: where a drop line starts (top-level rows leave it unset: full width)
    const indent = (depth: number) => {
        const left = 8 + depth * 32;
        return { paddingLeft: left, "--aip-indent": `${left}px` } as React.CSSProperties;
    };

    const toggleFolderRules = (path: string) => {
        const within = rulesWithin(store.rules, path);
        const on = !within.every((r) => r.enabled);
        for (const r of within) r.enabled = on;
    };
    const startNewFolder = () => {
        const parent = selected.startsWith("folder:") ? selected.slice(7) : selectedRule?.folder ?? "";
        const path = newFolderPath(store, parent);
        addFolder(store, path);
        if (parent) setCollapsed(parent, false);
        prefs.listTab = "rules";
        setSearch("");
        setSelected(`folder:${path}`);
        setRenaming(path);
    };
    const finishRename = (path: string, name: string | null) => {
        setRenaming(null);
        inputRef.current?.focus();
        const clean = name?.trim();
        if (!clean) return;
        const to = joinFolder(parentFolder(path), clean);
        if (to !== path && moveFolder(store, path, to)) {
            setSelected(`folder:${to}`);
            if (collapsed.has(path)) { setCollapsed(path, false); setCollapsed(to, true); }
        }
    };

    const folderItem = ({ node, depth }: { node: FolderNode; depth: number }) => {
        const value = `folder:${node.path}`;
        const within = rulesWithin(rules, node.path);
        const on = within.filter((r) => r.enabled).length;
        const open = isOpen(node.path);
        return (
            <Command.Item key={value} value={value} onSelect={() => toggleFolderRules(node.path)} style={indent(depth)}
                className={`aip-folder${dropClass(value, "into")}`} {...dnd({ kind: "folder", path: node.path }, value, { folder: node.path })}>
                <button className="aip-chevron" {...LIST_BUTTON} aria-expanded={open} title={open ? "Fold (←)" : "Unfold (→)"}
                    onClick={(e) => { e.stopPropagation(); setCollapsed(node.path, open); }}>{open ? "▾" : "▸"}</button>
                <span className={`aip-switch ${within.length && on === within.length ? "on" : on ? "mixed" : ""}`}
                    title={`${on} of ${within.length} rules on · ↵ turns them all ${within.length && on === within.length ? "off" : "on"}`} />
                <span className="aip-main">
                    {renaming === node.path ? (
                        <input className="aip-rename" autoFocus defaultValue={node.name} aria-label="Folder name"
                            onFocus={(e) => e.currentTarget.select()}
                            onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") { e.preventDefault(); finishRename(node.path, e.currentTarget.value); }
                                else if (e.key === "Escape") { e.preventDefault(); finishRename(node.path, null); }
                            }}
                            onBlur={(e) => finishRename(node.path, e.currentTarget.value)} />
                    ) : <span className="aip-title aip-folder-name">📁 {node.name}</span>}
                    <span className="aip-sub">{within.length ? `${within.length} rule${within.length === 1 ? "" : "s"} · ${on} on` : "empty: drag rules here"}</span>
                </span>
                <button className="aip-icon" {...LIST_BUTTON} title="Rename (F2 or ⌘E)" onClick={(e) => { e.stopPropagation(); setRenaming(node.path); }}>✎</button>
                <button className="aip-icon" {...LIST_BUTTON} title="Delete the folder, keeping its rules (⌘⌫)" onClick={(e) => { e.stopPropagation(); deleteFolder(store, node.path); }}>✕</button>
            </Command.Item>
        );
    };

    const ruleItem = (r: Rule, className?: string, depth = 0) => (
        <Command.Item key={r.id} value={`rule:${r.id}`} className={`${className ?? ""}${picked.has(r.id) ? " aip-picked" : ""}${dropClass(`rule:${r.id}`, "before")}`.trim() || undefined} style={depth ? indent(depth) : undefined}
            {...dnd({ kind: "rule", ids: [r.id] }, `rule:${r.id}`, { rule: r })}
            // ⇧click picks (cmdk's click, which turns the rule on/off, doesn't run); a plain click anywhere unpicks (see the root)
            onClickCapture={(e) => {
                if (!e.shiftKey || (e.target as HTMLElement).closest("button")) return;
                e.stopPropagation();
                pick([r.id]);
            }}
            onSelect={() => { const live = rule(r.id); if (live) live.enabled = !live.enabled; }}>
            <span className={`aip-switch ${r.enabled ? "on" : ""}`} title={r.enabled ? "Enabled" : "Disabled"} />
            <span className="aip-main">
                <span className={`aip-title${r.name ? "" : " aip-clip-url"}`} title={pathOnly && !r.name ? describeFilter(r.filter) : undefined}>{r.name || <EnrichedUrl text={describeFilter(r.filter, pathOnly)} />}</span>
                <span className="aip-sub aip-clip-url" title={pathOnly ? describeFilter(r.filter) : undefined}><bdi dir="ltr"><Enriched text={describeFilter(r.filter, pathOnly)} /> → {describeAction(r.action)}</bdi></span>
            </span>
            {r.tags.map((t) => <span key={t} className="aip-badge tag">{t}</span>)}
            {(() => {
                const perPage = isListAction(r.action.type);
                const hits = ruleHits(r);
                return <span className="aip-badge" title={perPage ? "In this tab" : "Since the rule was made"}>{hits} hit{hits === 1 ? "" : "s"}</span>;
            })()}
            <button className="aip-icon" {...LIST_BUTTON} title="Edit (F2 or ⌘E)" onClick={(e) => { e.stopPropagation(); editRule(r.id); }}>✎</button>
            <button className="aip-icon" {...LIST_BUTTON} title="Duplicate (⌘D)" onClick={(e) => { e.stopPropagation(); duplicateRule(r.id); }}>⧉</button>
            <button className="aip-icon" {...LIST_BUTTON} title="Delete (⌘⌫)" onClick={(e) => { e.stopPropagation(); removeRule(r.id); }}>✕</button>
        </Command.Item>
    );

    // what the keys do to the selected item
    const footerHints = () => {
        if (selected.startsWith("pause:")) return ["↵ open"];
        if (selected.startsWith("rule:")) {
            const r = rules.find((x) => `rule:${x.id}` === selected);
            if (picked.size) return [`${picked.size} picked: drag one to move them all`, "⇧click / ⇧↑↓ pick more", "esc unpick"];
            return [`↵ ${r?.enabled ? "disable" : "enable"}`, "F2 / ⌘E edit", "⌘D duplicate", "⌘⌫ delete", "drag to a folder", "⇧click / ⇧↑↓ pick several", ...(r?.action.type === "hide" && hidesOpen ? ["← fold"] : [])];
        }
        if (selected === "hides") return [hidesListed ? "↵ ← fold" : "↵ → list hide rules"];
        if (selected.startsWith("folder:")) {
            const path = selected.slice(7);
            return ["↵ turn all on/off", isOpen(path) ? "← fold" : "→ unfold", "F2 / ⌘E rename", "⌘⌫ delete folder (keeps rules)", "drag to move"];
        }
        if (selectedRow) return ["↵ / double-click new rule from this request", `⌘D ${isFavourite(selectedRow.entry) ? "unfavourite" : "favourite"}`, ...(selectedRow.foldKey ? [selectedRow.folded ? "→ unfold" : "← fold"] : []), pinning ? "esc unpin details" : "click to pin details"];
        return [];
    };

    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState("");
    // the request the details panel shows: pinned, else selected
    const shownRequest = pinning ? pinnedEntry : selectedRequest;
    const shownPlugin = shownRequest && entryPlugin(shownRequest);
    // a pinned request seeds the new rule
    const newRule = () => pinning && pinnedEntry ? onEditRule(draftFromRequest(pinnedEntry)) : onNewRule();
    const exportHar = (entries: readonly LoggedRequest[]) => {
        setExporting(true);
        setExportError("");
        buildHar(entries, transactions)
            .then(({ filename, text }) => download(filename, text, "application/json"))
            .catch((e) => { setExportError(String(e)); tweak.log("[tangiray] HAR export failed", String(e)); })
            .finally(() => setExporting(false));
    };


    const clearRequests = () => {
        page.log.splice(0);
        const last = page.navigations?.at(-1);
        page.navigations?.splice(0, page.navigations.length, ...(last ? [{ url: last.url, afterSeq: page.seq, initial: true }] : []));
        page.clicks?.splice(0);
        foldPlaces.current.clear();
        setPinnedId(null);
        onFreeze(null);
    };

    // cmdk has no PageUp/PageDown: move the selection by a list's height, to the last item that fits
    const pageSelection = (direction: 1 | -1) => {
        const list = listRef.current;
        if (!list) return;
        const items = [...list.querySelectorAll<HTMLElement>("[cmdk-item]:not([aria-disabled='true'])")];
        if (!items.length) return;
        const current = items.findIndex((el) => el.getAttribute("aria-selected") === "true");
        const from = items[current]?.getBoundingClientRect().top ?? list.getBoundingClientRect().top;
        const goal = from + direction * list.clientHeight;
        let target = current < 0 ? 0 : current;
        for (let i = target + direction; i >= 0 && i < items.length; i += direction) {
            const top = items[i].getBoundingClientRect().top;
            if (direction > 0 ? top > goal : top < goal) break;
            target = i;
        }
        // at least one step, so a page key never does nothing short of the end
        if (target === current && items[current + direction]) target = current + direction;
        const el = items[target];
        setSelected(el.dataset.value ?? "");
        el.scrollIntoView({ block: "nearest" });
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        const mod = e.metaKey || e.ctrlKey;
        const ruleId = selected.startsWith("rule:") ? selected.slice(5) : null;
        const folderPath = selected.startsWith("folder:") ? selected.slice(7) : null;
        const request = selectedRequest;
        // ⇧↑↓ on a rule: it's picked, and so is the one cmdk moves to (see `extending`); moving without ⇧ unpicks
        if (e.shiftKey && !mod && !e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp") && ruleId) { pick([ruleId], true); extending.current = true; }
        else if (!e.shiftKey && picked.size && ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(e.key)) setPicked(new Set());
        if (e.key === "Escape" && picked.size) { e.preventDefault(); setPicked(new Set()); }
        else if (e.key === "Escape" && pinning) { e.preventDefault(); setPinnedId(null); }
        else if (e.key === "Escape") { e.preventDefault(); onClose(); }
        // the rules', not the filter box's (e.code: the key, whatever the layout or ⇧)
        else if (mod && !e.altKey && ((e.shiftKey && e.code === "KeyZ") || (!e.shiftKey && e.code === "KeyY"))) { e.preventDefault(); onRedo(); }
        else if (mod && !e.altKey && e.code === "KeyZ") { e.preventDefault(); onUndo(); }
        // like lazygit; the filter rarely needs brackets
        else if ((e.key === "[" || e.key === "]") && !mod && !e.nativeEvent.isComposing) { e.preventDefault(); cycleTab(e.key === "]" ? 1 : -1); }
        else if (e.altKey && !mod && e.code === "KeyP") runShortcut(e, togglePaused);
        else if (e.altKey && !mod && e.code === "KeyN") runShortcut(e, newRule);
        else if ((e.key === "PageDown" || e.key === "PageUp") && !mod) { e.preventDefault(); pageSelection(e.key === "PageDown" ? 1 : -1); }
        else if (e.altKey && !mod && e.code === "KeyK") runShortcut(e, clearRequests);
        else if (e.altKey && !mod && e.code === "KeyF") runShortcut(e, startNewFolder);
        else if (folderPath !== null && ((e.key === "F2" && !mod && !e.altKey && !e.shiftKey) || (mod && !e.altKey && !e.shiftKey && e.code === "KeyE"))) { e.preventDefault(); setRenaming(folderPath); }
        else if (folderPath !== null && mod && e.key === "Backspace") {
            e.preventDefault();
            deleteFolder(store, folderPath);
            if (parentFolder(folderPath)) setSelected(`folder:${parentFolder(folderPath)}`);
        }
        else if (folderPath !== null && e.key === "ArrowRight") { e.preventDefault(); setCollapsed(folderPath, false); }
        else if (folderPath !== null && e.key === "ArrowLeft") {
            e.preventDefault();
            if (isOpen(folderPath) && !words.length) setCollapsed(folderPath, true);
            else if (parentFolder(folderPath)) setSelected(`folder:${parentFolder(folderPath)}`);
        }
        else if (e.key === "F2" && !e.altKey && !mod && !e.shiftKey && ruleId) { e.preventDefault(); editRule(ruleId); }
        else if (mod && !e.altKey && !e.shiftKey && e.code === "KeyE" && ruleId) { e.preventDefault(); editRule(ruleId); }
        else if (mod && e.key === "Backspace" && ruleId) { e.preventDefault(); removeRule(ruleId); }
        else if (mod && !e.altKey && !e.shiftKey && e.code === "KeyD" && ruleId) { e.preventDefault(); duplicateRule(ruleId); }
        else if (mod && !e.altKey && !e.shiftKey && e.code === "KeyD" && request) { e.preventDefault(); toggleFavourite(request); }
        else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && selected === "hides") { e.preventDefault(); setHidesOpen(e.key === "ArrowRight"); }
        else if (e.key === "ArrowLeft" && ruleId && hidesOpen && hideRules.some((r) => r.id === ruleId)) {
            e.preventDefault();
            setHidesOpen(false);
            setSelected("hides");
        }
        else if (e.key === "ArrowLeft" && selectedRule?.folder) { e.preventDefault(); setSelected(`folder:${selectedRule.folder}`); }
        else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && request) {
            if (selectedRow?.foldKey) { e.preventDefault(); toggleFold(selectedRow, e.key === "ArrowRight"); }
        }
    };

    return (
        <Command label="TangiRay" className={`aip-root${behind ? " aip-behind" : ""}${prefsSnap.longUrlEnd === "tail" ? " aip-url-tail" : ""}${pinning ? " aip-pinning" : ""}`} aria-hidden={behind || undefined} loop shouldFilter={false} value={selected} onValueChange={setSelected} onKeyDown={onKeyDown}
            // a click (not a press: pressing a picked rule drags them all) that isn't a ⇧click on a rule unpicks
            onClick={(e) => { if (!e.shiftKey && picked.size) setPicked(new Set()); }}>
            <div className="aip-header">
                <Command.Input ref={inputRef} placeholder={tab === "rules" ? "Filter rules…" : "Filter requests…"} value={search} onValueChange={setSearch} />
                <DockSwitch name="api-interceptor" onClose={onClose} />
            </div>
            <div className="aip-tabs" role="tablist">
                {TABS.map((t) => (
                    <button key={t} role="tab" aria-selected={tab === t} {...LIST_BUTTON} className={`aip-tab ${tab === t ? "on" : ""}`} onClick={() => switchTab(t)}
                        title={`${t === "rules" ? "Rules" : "Requests"} ([ ] to switch)`}>
                        {t === "rules" ? "Rules" : "Requests"} <span className="aip-count">{t === "rules" ? (words.length ? `${visibleRules.length}/${rules.length}` : rules.length) : (words.length ? `${visibleLog.length}/${log.length}` : log.length)}</span>
                    </button>
                ))}
                <span className="aip-tab-hint" aria-hidden><kbd>[</kbd><kbd>]</kbd></span>
                {tab === "requests" && (
                    <span className="aip-head-tools">
                        <button {...LIST_BUTTON} className={`aip-tool ${frozenLog ? "on" : ""}`} onClick={togglePaused}
                            title={frozenLog ? "Updates paused: click to resume (⌥P)" : "Pause updates: keep the list still while you look (⌥P)"}>
                            {frozenLog ? `▶ Resume${newCount ? ` · ${newCount} new` : ""}` : "⏸ Pause"}
                        </button>
                        {(hiddenCount > 0 || showHidden) && (
                            <button {...LIST_BUTTON} className={`aip-tool ${showHidden ? "on" : ""}`} onClick={toggleShowHidden}
                                title={showHidden ? "Showing requests hide rules match: click to hide them" : "Requests hide rules match: click to show them"}>
                                🙈 {hiddenCount} hidden
                            </button>
                        )}
                        <button {...LIST_BUTTON} className="aip-tool" disabled={!liveLog.length && !liveClicks.length && !liveNavigations.some((n) => !n.initial)} title="Clear this tab's request list (⌥K)"
                            onClick={clearRequests}>Clear</button>
                    </span>
                )}
            </div>
            <div className={`aip-body ${stacked ? "stacked" : ""}`} style={{ "--aip-details-size": `${detailsSize * 100}%` } as React.CSSProperties}>
            <Command.List ref={listRef} className={dropOn === "root" ? "aip-drop-end" : undefined}
                // the list's blank space (not a row): above the first row's middle, before it when it's a rule; else the end of the top level
                onDragOver={(e) => {
                    const blank = blankTarget(e);
                    if (!dragged || !blank || dropInto(dragged, blank.target) === null) return;
                    e.preventDefault();
                    if (dropOn !== blank.on) setDropOn(blank.on);
                }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn(null); }}
                onDrop={(e) => {
                    const blank = blankTarget(e);
                    if (!dragged || !blank) return;
                    e.preventDefault();
                    drop(dragged, blank.target);
                    endDrag();
                }}>
                <Command.Empty>{words.length ? "Nothing matches." : tab === "rules" ? "No rules yet: ⌥N, or ↵ on a request, makes one." : "No requests in this tab yet."}</Command.Empty>
                {visiblePauses.length > 0 && (
                    <Command.Group heading="Paused">
                        {visiblePauses.map((p) => (
                            <Command.Item key={p.id} value={`pause:${p.id}`} onSelect={() => onOpenPause(p.id)}>
                                <span className="aip-badge paused">⏸ {p.stage}</span>
                                <span className="aip-method">{p.request.method}</span>
                                <span className="aip-main">
                                    <span className="aip-title aip-clip-url" title={pathOnly ? p.request.url : undefined}><EnrichedUrl text={shortUrl(p.request.url, pathOnly)} /></span>
                                    <span className="aip-sub">{p.ruleName || "unnamed rule"}</span>
                                </span>
                            </Command.Item>
                        ))}
                    </Command.Group>
                )}
                {tab === "rules" && (visibleRules.length > 0 || treeRows.length > 0) && (
                    <Command.Group>
                        {treeRows.map((t) => (t.kind === "folder" ? folderItem(t) : ruleItem(t.rule, undefined, t.depth)))}
                        {otherRules.map((r) => ruleItem(r))}
                        {hideRules.length > 0 && (() => {
                            const all = rules.filter((r) => r.action.type === "hide");
                            const on = all.filter((r) => r.enabled).length;
                            return (
                                <Command.Item key="hides" value="hides" onSelect={() => setHidesOpen(!hidesOpen)} className={hidesListed ? "aip-unfolded" : undefined}>
                                    <span className="aip-hides-icon" title="Hide rules">🙈</span>
                                    <span className="aip-main">
                                        <span className="aip-title">Hiding {on} kind{on === 1 ? "" : "s"} of requests{on < all.length ? ` (${all.length - on} off)` : ""}</span>
                                        <span className="aip-sub">{hiddenCount} hidden in this tab · {hidesListed ? "← to fold" : "→ to list the hide rules"}</span>
                                    </span>
                                    <button className={`aip-fold ${hidesListed ? "open" : ""}`} {...LIST_BUTTON} title={hidesListed ? "← or click to fold" : "→ or click to list"}
                                        onClick={(ev) => { ev.stopPropagation(); setHidesOpen(!hidesOpen); }}>
                                        {hidesListed ? "fold" : `×${hideRules.length}`}
                                    </button>
                                </Command.Item>
                            );
                        })()}
                        {hidesListed && hideRules.map((r) => ruleItem(r, "aip-unfolded"))}
                    </Command.Group>
                )}
                {tab === "requests" && (rows.length > 0 || markers.some((group) => group.length > 0)) && (
                    <Command.Group>
                        {rows.map(({ entry: e, folded, foldKey }, i) => { const fav = favouriteRules.length > 0 && isFavourite(e); const gap = gaps[i]; const summary = summaryOf(e); return (
                            <Fragment key={folded ? foldKey : e.id}>
                            {markers[i].map((marker, j) => marker.kind === "page" ? <div key={j} className="aip-request-gap aip-page-marker" role="separator" title={marker.navigation?.url}>{marker.navigation ? <>Page → <span className="aip-navigation-url aip-clip-url"><EnrichedUrl text={shortUrl(marker.navigation.url, pathOnly) + (pathOnly ? "" : new URL(marker.navigation.url).hash)} /></span>{marker.withinFold && " (within folded requests)"}</> : "Page unknown"}</div> : <div key={j} className="aip-request-gap" role="separator">Click → <span className="aip-navigation-url">{marker.click.label}</span>{marker.withinFold && " (within folded requests)"}</div>)}
                            {gap !== undefined && <div className="aip-request-gap" role="separator">{formatRequestGap(gap)} between requests</div>}
                            <Command.Item value={rowValue(rows[i])} onSelect={() => onEditRule(draftFromRequest(e))}
                                // a click pins the request in the details panel (cmdk's click, a new rule from it, doesn't run); ↵ or a double-click makes the rule
                                onClickCapture={(ev) => {
                                    if (ev.shiftKey || ev.metaKey || ev.ctrlKey || (ev.target as HTMLElement).closest("button")) return;
                                    ev.stopPropagation();
                                    // the second click of a double-click: that's the double-click's
                                    if (ev.detail > 1) return;
                                    pinBeforeClick.current = pinnedId;
                                    togglePin(rows[i]);
                                }}
                                // a double-click doesn't pin: its first click's toggle is undone
                                onDoubleClick={(ev) => {
                                    if (ev.shiftKey || ev.metaKey || ev.ctrlKey || (ev.target as HTMLElement).closest("button")) return;
                                    setPinnedId(pinBeforeClick.current);
                                    onEditRule(draftFromRequest(e));
                                }}
                                className={[showHidden && isHidden(e) ? "aip-hidden" : "", foldKey && !folded ? "aip-unfolded" : "", fav ? "aip-fav" : "", pinning && pinnedRow === rows[i] ? "aip-pinned" : ""].join(" ").trim() || undefined}>
                                <button className={`aip-star ${fav ? "on" : ""}`} {...LIST_BUTTON} aria-pressed={fav}
                                    title={fav ? `Favourite (${favouritesOf(e).map((r) => r.name || describeFilter(r.filter)).join(", ")}): click to remove (⌘D)` : "Favourite: star requests like this and pin them at the top (⌘D)"}
                                    onClick={(ev) => { ev.stopPropagation(); toggleFavourite(e); }}>{fav ? "★" : "☆"}</button>
                                <span className="aip-seq">#{e.seq}</span>
                                <span className="aip-method">{e.method}</span>
                                {summary ? (
                                    <span className="aip-main">
                                        <span className="aip-title">{summary.title}</span>
                                        <span className="aip-sub">{summary.sub}</span>
                                    </span>
                                ) : (
                                    <span className="aip-main">
                                        <span className="aip-title aip-clip-url" title={pathOnly ? e.url : undefined}><EnrichedUrl text={shortUrl(e.url, pathOnly)} /></span>
                                        <span className="aip-sub">{new URL(e.url).host}{e.finalUrl ? ` → ${e.finalUrl}` : ""}{e.outcome ? ` · ${e.outcome}` : ""}</span>
                                    </span>
                                )}
                                {foldKey && (
                                    <button className={`aip-fold ${folded ? "" : "open"}`} {...LIST_BUTTON}
                                        aria-label={folded ? `Unfold ${folded.length} requests` : "Fold requests"}
                                        title={folded ? `${folded.length} ${foldedBy(foldKey) ? `requests folded by "${foldedBy(foldKey)}"` : "identical requests"} (#${folded.map((f) => f.seq).join(", #")}) · → or click to unfold` : "← or click to fold"}
                                        onClick={(ev) => { ev.stopPropagation(); toggleFold(rows[i], !!folded); }}>
                                        {folded ? <><span className="aip-fold-count">×{folded.length}</span><span className="aip-fold-action">unfold</span></> : "fold"}
                                    </button>
                                )}
                                {e.ruleIds.length > 0 && <span className="aip-badge tag" title="Matched rules">⚑ {e.ruleIds.length}</span>}
                                {summary ? <span className={`aip-status ${summary.status.className}`}>{summary.status.text}</span>
                                    : <span className={`aip-status s${Math.floor((e.status ?? 0) / 100)}`}>{e.status ?? "…"}</span>}
                                <span className="aip-time">{e.durationMs !== undefined ? `${e.durationMs}ms` : ""}</span>
                            </Command.Item>
                            </Fragment>
                        ); })}
                        {markers[rows.length].map((marker, i) => marker.kind === "page" ? <div key={i} className="aip-request-gap aip-page-marker" role="separator" title={marker.navigation?.url}>{marker.navigation ? <>Page → <span className="aip-navigation-url aip-clip-url"><EnrichedUrl text={shortUrl(marker.navigation.url, pathOnly) + (pathOnly ? "" : new URL(marker.navigation.url).hash)} /></span></> : "Page unknown"}</div> : <div key={i} className="aip-request-gap" role="separator">Click → <span className="aip-navigation-url">{marker.click.label}</span></div>)}
                    </Command.Group>
                )}
            </Command.List>
            <Splitter stacked={stacked} size={detailsSize} onResize={setDragSize} onDone={(size) => {
                setDragSize(null);
                if (size === undefined) delete prefs[sizeKey]; else prefs[sizeKey] = Math.round(size * 1000) / 1000;
            }} />
            {selectedRule ? <RulePreview rule={selectedRule} log={log} pathOnly={pathOnly} hits={ruleHits(selectedRule)} onShowRequest={showRequest} /> :
            selected.startsWith("folder:") ? <FolderPreview path={selected.slice(7)} rules={rulesWithin(rules, selected.slice(7))} pathOnly={pathOnly} /> :
            shownRequest && shownPlugin?.entries ? <shownPlugin.entries.Details entry={shownRequest} rules={rules} call={(name, ...args) => transactions.call(shownPlugin.id, name, args)}
                pinned={pinning} onUnpin={() => setPinnedId(null)}
                folded={detailsRow?.folded} foldedBy={foldedBy(detailsRow?.foldKey)} onUnfold={() => detailsRow && toggleFold(detailsRow, true)} onShowRule={showRule} /> :
            <RequestDetails entry={shownRequest} paused={pinning ? undefined : selectedPause} rules={rules} transactions={transactions} prefs={prefs}
                pinned={pinning} onUnpin={() => setPinnedId(null)}
                folded={detailsRow?.folded} foldKey={detailsRow?.folded ? detailsRow.foldKey : undefined} foldedBy={foldedBy(detailsRow?.foldKey)} onUnfold={() => detailsRow && toggleFold(detailsRow, true)} onShowRule={showRule} />}
            </div>
            <div className="aip-footer">
                <span>{[...footerHints(), pinning ? "⌥N new rule from pinned" : "⌥N new rule", ...(tab === "rules" ? ["⌥F new folder", "⌘Z / ⇧⌘Z undo / redo"] : []), `⌥P ${frozenLog ? "resume" : "pause"} updates`, ...(tab === "requests" ? ["⌥K clear"] : []), "⌘\\ dock", "esc close"].join(" · ")}</span>
                <span className="aip-footer-actions">
                    <button className="primary" onClick={newRule} title={pinning ? "Make a rule from the pinned request (⌥N)" : "Make a rule from scratch, without a logged request (⌥N)"}>+ New rule</button>
                    <MoreMenu onClose={() => inputRef.current?.focus()} items={[
                        { icon: "⚙", label: "Settings", title: "How the request list looks and what it records", items: [
                        { icon: "☆", label: "Show favourites at the top", checked: prefsSnap.showFavouritesAtTop !== false, title: "Keep favourite requests at the top; turn off to keep them in timeline order", onSelect: () => { prefs.showFavouritesAtTop = prefsSnap.showFavouritesAtTop === false; } },
                        { icon: "⇥", label: "Show the end of long URLs", checked: prefsSnap.longUrlEnd === "tail", title: "Cut long URLs at their start instead of their end, so the end (IDs, query) stays visible", onSelect: () => { prefs.longUrlEnd = prefsSnap.longUrlEnd === "tail" ? "head" : "tail"; } },
                        { icon: "✂", label: "Hide query and hash", checked: pathOnly, title: "Show requests' and pages' URLs as their path only, without ?query and #hash, and rules without their query conditions (hover for the full URL)", onSelect: () => { prefs.hideUrlQuery = !pathOnly; } },
                        { icon: "☷", label: "Page breaks", checked: prefsSnap.showPageBreaks !== false, title: "Show page URL changes in the request timeline", onSelect: () => { prefs.showPageBreaks = prefsSnap.showPageBreaks === false; } },
                        { icon: "☷", label: "Click breaks", checked: prefsSnap.showClickBreaks !== false, title: "Record and show interactive control clicks and labels; input values are not recorded", onSelect: () => { prefs.showClickBreaks = prefsSnap.showClickBreaks === false; } },
                        { icon: "☷", label: "Fold identical requests", checked: prefsSnap.foldSimilarRequests !== false, title: "Automatically fold 3 or more requests with the same method, URL (query included) and body; headers may differ. Fold rules still apply", onSelect: () => {
                            if (prefsSnap.foldSimilarRequests !== false && selectedRow?.folded && selectedRow.foldKey && !foldRuleId(selectedRow.foldKey)) setSelected(`req:${selectedRow.entry.id}`);
                            prefs.foldSimilarRequests = prefsSnap.foldSimilarRequests === false;
                        } },
                        ] },
                        ...(pluginMenuItems.length ? [{ icon: "⧉", label: "Plugins", title: "The site plugins working on this page, and their switches", items: pluginMenuItems }] : []),
                        { separator: true, icon: "⤒", label: "Import rules…", title: "Add rules from an exported JSON file", onSelect: onImport },
                        { icon: "⤓", label: "Export rules…", disabled: !rules.length,
                            title: "Pick rules to download as JSON, to back them up or share them", onSelect: () => onExport(visibleRules.map((r) => r.id)) },
                        { separator: true, icon: "⤓", label: exporting ? "Exporting HAR…" : "Export", failed: !!exportError, title: exportError ? `Export failed: ${exportError}` : "Download requests as HAR", items: [
                            { icon: "⤓", label: exportError ? "Listed requests as HAR: failed, retry" : `Listed requests as HAR (${harLog.length})`, disabled: !harLog.length || exporting, failed: !!exportError,
                                title: exportError ? `Export failed: ${exportError}` : "Download the listed HTTP requests (folded ones included, hidden ones only when shown; not the plugins' entries, e.g. WebSocket messages) as a HAR file", onSelect: () => exportHar(harLog) },
                            { icon: "⤓", label: shownRequest && !shownRequest.source ? `This request as HAR (#${shownRequest.seq} ${shownRequest.method} ${shortUrl(shownRequest.url).split("?")[0]})` : "This request as HAR",
                                disabled: !shownRequest || !!shownRequest.source || exporting,
                                title: !shownRequest ? "Select or pin a request first" : shownRequest.source ? "Not an HTTP request: HAR can't hold it" : "Download the request in the details panel (pinned, else selected) as a HAR file",
                                onSelect: () => shownRequest && exportHar([shownRequest]) },
                        ] },
                    ]} />
                </span>
            </div>
        </Command>
    );
}
