import { tweak } from "tangitweak";
import { useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { MOD } from "./keys";
import { PALETTE_ATTR, trapTab } from "./modal-focus";

// -------------------------------------------------------------------------------------------------
// DOCK
// A palette opens in the middle of the page, modal, or docked to its left or right edge: then it's a
// side panel and the page stays usable, pushed aside (see ./top-layer.ts). Each palette remembers
// its side and width, everywhere.
// -------------------------------------------------------------------------------------------------

export type DockSide = "center" | "left" | "right";

export const docks = tweak.globalStore("palette-docks", {
    sides: {} as Record<string, DockSide>,
    widths: {} as Record<string, number>,
});

const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 480;

export const dockSide = (name: string): DockSide => docks.sides[name] ?? "center";
const clampWidth = (width: number) => Math.round(Math.max(MIN_WIDTH, Math.min(width, window.innerWidth * 0.8)));
export const dockWidth = (name: string) => clampWidth(docks.widths[name] ?? DEFAULT_WIDTH);

/**
 * A palette's outermost element: a backdrop around it when centered (modal: Tab stays in it, a
 * click on the backdrop calls `onDismiss`), or a side panel that leaves the page usable.
 */
export function PaletteFrame({ name, label, className, open, onDismiss, children, ...rest }: {
    /** The palette's name, as given to `mountOnTop`. */
    name: string;
    label: string;
    className: string;
    open: boolean;
    onDismiss: () => void;
    children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
    const { sides, widths } = useSnapshot(docks);
    const side = sides[name] ?? "center";
    const docked = side !== "center";
    const [dragWidth, setDragWidth] = useState<number | null>(null);
    const width = dragWidth ?? clampWidth(widths[name] ?? DEFAULT_WIDTH);
    return (
        <div {...rest} className={className} style={{ ...(open ? undefined : { display: "none" }), ...(docked && { "--wt-dock-width": `${width}px` }) } as React.CSSProperties}
            {...{ [PALETTE_ATTR]: "" }} data-wt-dock={docked ? side : undefined}
            role="dialog" aria-modal={!docked} aria-label={label}
            onKeyDown={(e) => {
                if (isCycleKey(e)) { e.preventDefault(); cycleDock(name); return; }
                if (!docked) trapTab(e);
            }}
            onMouseDown={(e) => { if (!docked && e.target === e.currentTarget) onDismiss(); }}>
            {children}
            {docked && <ResizeEdge side={side} width={width} onDrag={setDragWidth}
                onDone={(w) => { setDragWidth(null); docks.widths[name] = w; }} />}
        </div>
    );
}

/** The docked panel's inner edge: drag to resize. */
function ResizeEdge({ side, width, onDrag, onDone }: { side: DockSide; width: number; onDrag: (w: number) => void; onDone: (w: number) => void }) {
    const start = useRef<{ x: number; width: number } | null>(null);
    const widthAt = (x: number) => clampWidth(start.current!.width + (side === "left" ? x - start.current!.x : start.current!.x - x));
    return (
        <div className="wt-dock-edge" title="Drag to resize"
            onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); start.current = { x: e.clientX, width }; }}
            onPointerMove={(e) => { if (start.current) onDrag(widthAt(e.clientX)); }}
            onPointerUp={(e) => { if (start.current) onDone(widthAt(e.clientX)); start.current = null; }}
            onPointerCancel={() => { start.current = null; onDrag(width); }} />
    );
}

const SIDES: { side: DockSide; icon: string; title: string }[] = [
    { side: "left", icon: "◧", title: "Dock to the left: keep the page usable" },
    { side: "center", icon: "▣", title: "Center, over the page" },
    { side: "right", icon: "◨", title: "Dock to the right: keep the page usable" },
];

/** Mod+\ (⌘\ on Apple platforms, Ctrl+\ elsewhere): cycles the palette left → center → right. */
const isCycleKey = (e: React.KeyboardEvent) =>
    e.code === "Backslash" && (MOD === "⌘" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey;

function cycleDock(name: string) {
    const order = SIDES.map((s) => s.side);
    const next = order[(order.indexOf(dockSide(name)) + 1) % order.length];
    if (next === "center") delete docks.sides[name]; else docks.sides[name] = next;
}

/** Buttons that dock the palette `name` left, center or right; docked, `onClose` adds a × (no backdrop to click away). */
export function DockSwitch({ name, onClose }: { name: string; onClose?: () => void }) {
    const { sides } = useSnapshot(docks);
    const current = sides[name] ?? "center";
    return (
        <>
        <span className="wt-dock-switch" role="group" aria-label="Position" title={`${MOD}\\ cycles left, center, right`}>
            {SIDES.map(({ side, icon, title }) => (
                <button key={side} type="button" tabIndex={-1} title={`${title} (${MOD}\\ cycles)`} aria-pressed={current === side} className={`wt-dock-button ${current === side ? "on" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { if (side === "center") delete docks.sides[name]; else docks.sides[name] = side; }}>{icon}</button>
            ))}
        </span>
        {onClose && current !== "center" && (
            <button type="button" className="wt-dock-close" title="Close (esc)" aria-label="Close"
                onMouseDown={(e) => e.preventDefault()} onClick={onClose}>×</button>
        )}
        </>
    );
}

/**
 * Styles for a docked {@link PaletteFrame} and {@link DockSwitch}, after the palette's own: the
 * backdrop lets the page through, its panel (the frame's first child) fills the edge.
 */
export const DOCK_CSS = `
[data-wt-dock] { background: transparent !important; padding: 0 !important; align-items: stretch !important; pointer-events: none; }
[data-wt-dock="left"] { justify-content: flex-start !important; }
[data-wt-dock="right"] { justify-content: flex-end !important; }
[data-wt-dock] > :first-child { pointer-events: auto; box-sizing: border-box; width: var(--wt-dock-width) !important; height: 100vh !important; max-height: none !important; border-radius: 0 !important; }
[data-wt-dock="left"] > :first-child { box-shadow: 4px 0 24px rgba(0,0,0,.2) !important; border-right: 1px solid var(--wt-border-soft); }
[data-wt-dock="right"] > :first-child { box-shadow: -4px 0 24px rgba(0,0,0,.2) !important; border-left: 1px solid var(--wt-border-soft); }
.wt-dock-edge { pointer-events: auto; position: fixed; top: 0; bottom: 0; width: 6px; cursor: ew-resize; z-index: 1; }
[data-wt-dock="left"] > .wt-dock-edge { left: calc(var(--wt-dock-width) - 3px); }
[data-wt-dock="right"] > .wt-dock-edge { right: calc(var(--wt-dock-width) - 3px); }
.wt-dock-edge:hover, .wt-dock-edge:active { background: color-mix(in srgb, var(--wt-accent) 35%, transparent); }
.wt-dock-switch { flex: none; display: inline-flex; border: 1px solid var(--wt-border); border-radius: 6px; overflow: hidden; }
.wt-dock-switch button { margin: 0; padding: 1px 6px; border: 0; background: transparent; color: var(--wt-text-muted); font: 14px/18px system-ui, -apple-system, sans-serif; cursor: pointer; }
.wt-dock-switch button + button { border-left: 1px solid var(--wt-border); }
.wt-dock-switch button:hover { color: var(--wt-text); }
.wt-dock-switch button.on { background: var(--wt-green-bg); color: var(--wt-green); }
.wt-dock-close { flex: none; margin: 0 0 0 8px; padding: 1px 6px; border: 1px solid var(--wt-border); border-radius: 6px; background: transparent; color: var(--wt-text-muted); font: 14px/18px system-ui, -apple-system, sans-serif; cursor: pointer; }
.wt-dock-close:hover { color: var(--wt-text); background: var(--wt-fill-soft); }
.wt-dock-close:focus-visible { outline: 2px solid var(--wt-accent); outline-offset: 1px; }
`;
