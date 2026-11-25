import { useRef } from "react";

// -------------------------------------------------------------------------------------------------
// SPLITTER
// The bar between the request list and the details panel: drag it to share the room between them
// (side by side, or stacked when the palette is docked). Double-click puts it back in the middle.
// -------------------------------------------------------------------------------------------------

const MIN = 0.15;
const MAX = 0.85;

/**
 * `size`: the share of its parent the panel after the bar takes (0–1). `onResize` follows the drag;
 * `onDone` gets the size it ended at (`undefined`: back to the default).
 */
export function Splitter({ stacked, size, onResize, onDone }: {
    stacked: boolean;
    size: number;
    onResize: (size: number) => void;
    onDone: (size: number | undefined) => void;
}) {
    const dragging = useRef(false);
    const sizeAt = (e: React.PointerEvent<HTMLElement>) => {
        const box = e.currentTarget.parentElement!.getBoundingClientRect();
        const share = stacked ? (box.bottom - e.clientY) / box.height : (box.right - e.clientX) / box.width;
        return Math.min(MAX, Math.max(MIN, share));
    };
    return (
        <div className={`aip-splitter ${stacked ? "stacked" : ""}`} role="separator" aria-orientation={stacked ? "horizontal" : "vertical"}
            aria-valuenow={Math.round(size * 100)} title="Drag to resize · double-click to reset"
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; }}
            onPointerMove={(e) => { if (dragging.current) onResize(sizeAt(e)); }}
            onPointerUp={(e) => { if (dragging.current) onDone(sizeAt(e)); dragging.current = false; }}
            onPointerCancel={() => { if (dragging.current) onDone(size); dragging.current = false; }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={() => onDone(undefined)} />
    );
}
