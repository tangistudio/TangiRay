import { useEffect, useLayoutEffect, useRef } from "react";

// -------------------------------------------------------------------------------------------------
// SCROLL ANCHORING
// Requests keep coming, and folding moves rows: keep the rows on screen where they are. At the
// bottom, follow the new requests; at the top, stay there.
// -------------------------------------------------------------------------------------------------

interface ScrollAnchor {
    atTop: boolean;
    atBottom: boolean;
    /** the visible items' values and offsets from the list's top, first first */
    rows: [string, number][];
}

function measureScroll(list: HTMLElement): ScrollAnchor {
    const top = list.getBoundingClientRect().top;
    const rows: [string, number][] = [];
    for (const item of list.querySelectorAll<HTMLElement>("[cmdk-item]")) {
        const box = item.getBoundingClientRect();
        if (box.bottom <= top) continue;
        if (box.top - top >= list.clientHeight) break;
        rows.push([item.dataset.value ?? "", box.top - top]);
    }
    return { atTop: list.scrollTop <= 0, atBottom: list.scrollHeight - list.scrollTop - list.clientHeight < 2, rows };
}

function restoreScroll(list: HTMLElement, anchor: ScrollAnchor) {
    if (anchor.atBottom) { list.scrollTop = list.scrollHeight; return; }
    if (anchor.atTop) { list.scrollTop = 0; return; }
    const top = list.getBoundingClientRect().top;
    // the first row still there (the top one may just have folded away)
    for (const [value, offset] of anchor.rows) {
        const item = list.querySelector(`[cmdk-item][data-value="${CSS.escape(value)}"]`);
        if (item) { list.scrollTop += item.getBoundingClientRect().top - top - offset; return; }
    }
}

/** `items`: the list's item values, changing as rows come, go and move; `search`: a new search starts over. */
export function useScrollAnchor(listRef: React.RefObject<HTMLDivElement | null>, items: string, search: string) {
    const anchor = useRef<ScrollAnchor | undefined>(undefined);
    const settling = useRef(false);
    const lastSearch = useRef(search);

    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const record = () => { if (!settling.current) anchor.current = measureScroll(list); };
        record();
        list.addEventListener("scroll", record, { passive: true });
        return () => list.removeEventListener("scroll", record);
    }, [listRef]);

    useLayoutEffect(() => {
        const list = listRef.current;
        const saved = anchor.current;
        const searched = search !== lastSearch.current;
        lastSearch.current = search;
        if (!list || !saved || searched) return;
        restoreScroll(list, saved);
        // cmdk scrolls its selection into view once its items settle (to the first one, when the selected row folded away): undo that too
        settling.current = true;
        const frame = requestAnimationFrame(() => {
            restoreScroll(list, saved);
            settling.current = false;
            anchor.current = measureScroll(list);
        });
        return () => { cancelAnimationFrame(frame); settling.current = false; };
    }, [items, search]); // eslint-disable-line react-hooks/exhaustive-deps
}
