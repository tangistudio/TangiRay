import { type FoldKeyOf, foldKeyOf, foldMin, foldRuleId } from "../../domain/log";
import type { LoggedRequest, PageClick, PageNavigation } from "../../domain/types";

// -------------------------------------------------------------------------------------------------
// FOLDING
// More than 2 requests with the same method, URL (with query) and body show as one row, and 2 or
// more a fold rule matches (see foldKeyer, foldMin in ../../domain/log.ts), at the newest one's place when first shown; while the palette
// stays open it stays there (see foldPlaces).
// -------------------------------------------------------------------------------------------------

export interface Row {
    entry: LoggedRequest;
    /** a folded group: all its requests, oldest first (this row shows the newest) */
    folded?: LoggedRequest[];
    /** set when the request is in a group big enough to fold, folded or not */
    foldKey?: string;
}

// a folded row keeps its value while new repeats join it (and it shows the newest), so it stays selected
// (encoded: cmdk trims values, and a fold key without a body ends in a newline)
export const rowValue = (r: Row) => (r.folded ? `fold:${encodeURIComponent(r.foldKey!)}` : `req:${r.entry.id}`);

/** Gaps between neighboring rows only when their requests are consecutive in the full log. */
export function requestGaps(rows: readonly Row[], log: readonly LoggedRequest[]): (number | undefined)[] {
    const positions = new Map(log.map((entry, i) => [entry.id, i]));
    return rows.map((row, i) => {
        if (!i) return undefined;
        const previous = positions.get(rows[i - 1].entry.id);
        const current = positions.get((row.folded?.[0] ?? row.entry).id);
        if (previous === undefined || current === undefined || current !== previous + 1) return undefined;
        const gap = log[current].startedAt - log[previous].startedAt;
        return gap >= 5_000 ? gap : undefined;
    });
}

function markerTarget(rows: readonly Row[], afterSeq: number) {
    let target = rows.length;
    let seq = Infinity;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].entry.seq > afterSeq && rows[i].entry.seq < seq) {
            target = i;
            seq = rows[i].entry.seq;
        }
    }
    return target;
}

export function clickMarkers(rows: readonly Row[], clicks: readonly PageClick[]) {
    const markers: { click: PageClick; withinFold: boolean }[][] = Array.from({ length: rows.length + 1 }, () => []);
    for (const click of clicks) {
        const target = markerTarget(rows, click.afterSeq);
        const first = rows[target]?.folded?.[0].seq;
        markers[target].push({ click, withinFold: first !== undefined && first <= click.afterSeq });
    }
    return markers;
}

/** Place navigation before its next visible request, even if favourites have been pinned. */
export function navigationMarkers(rows: readonly Row[], navigations: readonly PageNavigation[]) {
    const markers: { navigation: PageNavigation | undefined; withinFold: boolean; context?: boolean }[][] = Array.from({ length: rows.length + 1 }, () => []);
    for (const navigation of navigations) {
        if (navigation.initial) {
            const next = navigations.find((n) => !n.initial && n.afterSeq >= navigation.afterSeq);
            if (!next || !rows.some((row) => (row.folded ?? [row.entry]).some((e) => e.seq > navigation.afterSeq && e.seq <= next.afterSeq))) continue;
        }
        const target = markerTarget(rows, navigation.afterSeq);
        const first = rows[target]?.folded?.[0].seq;
        markers[target].push({ navigation, withinFold: first !== undefined && first <= navigation.afterSeq });
    }
    let active: PageNavigation | undefined;
    for (let i = 0; i < rows.length; i++) {
        for (const marker of markers[i]) active = marker.navigation;
        const expected = navigations.findLast((n) => n.afterSeq < rows[i].entry.seq);
        if (!expected && active) {
            markers[i].push({ navigation: undefined, withinFold: false, context: true });
            active = undefined;
        } else if (expected && active?.url !== expected.url && (!expected.initial || navigations.some((n) => !n.initial))) {
            markers[i].push({ navigation: expected, withinFold: false, context: true });
            active = expected;
        }
    }
    return markers;
}

export function timelineMarkers(rows: readonly Row[], navigations: readonly PageNavigation[], clicks: readonly PageClick[]) {
    const pages = navigationMarkers(rows, navigations);
    const clickBreaks = clickMarkers(rows, clicks);
    return pages.map((group, i) => [
        ...group.map((marker) => ({ kind: "page" as const, ...marker })),
        ...clickBreaks[i].map((marker) => ({ kind: "click" as const, ...marker })),
    ].sort((a, b) => {
        const order = (marker: typeof a) => marker.kind === "click" ? marker.click.order : marker.context ? Infinity : marker.navigation?.order ?? 0;
        return order(a) - order(b);
    }));
}

/** `places`: where folded groups sit, by fold key (a seq); a group not in it is placed at its newest request, and added. */
export function foldRepeats(entries: readonly LoggedRequest[], expanded: ReadonlySet<string>, places: Map<string, number>, keyOf: FoldKeyOf = foldKeyOf, foldSimilar = true): Row[] {
    const groups = new Map<string, LoggedRequest[]>();
    for (const e of entries) {
        const key = keyOf(e);
        const group = groups.get(key);
        if (group) group.push(e); else groups.set(key, [e]);
    }
    const rows: (Row & { place: number })[] = [];
    for (const e of entries) {
        const key = keyOf(e);
        const group = groups.get(key)!;
        if ((!foldSimilar && foldRuleId(key) === undefined) || group.length < foldMin(key)) rows.push({ entry: e, place: e.seq });
        else if (expanded.has(key)) rows.push({ entry: e, foldKey: key, place: e.seq });
        else if (e === group[group.length - 1]) {
            if (!places.has(key)) places.set(key, e.seq);
            rows.push({ entry: e, folded: group, foldKey: key, place: places.get(key)! });
        }
    }
    return rows.sort((a, b) => a.place - b.place);
}
