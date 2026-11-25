import { useEffect, useId, useMemo, useRef, useState } from "react";

// -------------------------------------------------------------------------------------------------
// COMBOBOX
// A text field with suggestions: focusing (unless `openOnFocus` is off) or clicking shows them all, typing filters them (by value or by the
// words in their label/hint); ↑/↓ move, ↵ or a click picks, Esc closes. Any text can be typed.
// Keys it uses while the list is open are prevented, so forms around it leave them alone.
// -------------------------------------------------------------------------------------------------

export interface ComboOption { value: string; label?: string; hint?: string }

export interface ComboboxProps {
    value: string;
    onChange: (value: string) => void;
    options: ComboOption[];
    /** shown beside the field: e.g. what the current value means */
    note?: string;
    inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
    placeholder?: string;
    "aria-label"?: string;
    /** show the suggestions as soon as the field is focused (default); otherwise on a click, ↓ or typing */
    openOnFocus?: boolean;
}

export function Combobox({ value, onChange, options, note, inputMode, placeholder, openOnFocus = true, ...aria }: ComboboxProps) {
    const [open, setOpen] = useState(false);
    // null: browsing (all options); a string: what's typed, filtering them
    const [query, setQuery] = useState<string | null>(null);
    const [active, setActive] = useState(0);
    const listRef = useRef<HTMLUListElement>(null);
    const id = useId();

    const shown = useMemo(() => {
        const q = query?.trim().toLowerCase();
        if (!q) return options;
        return options.filter((o) => o.value.toLowerCase().startsWith(q) || `${o.label ?? ""} ${o.hint ?? ""}`.toLowerCase().includes(q));
    }, [options, query]);

    // open on the current value, when it's listed
    useEffect(() => {
        if (open && query === null) setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (query !== null) setActive(0); }, [query]);
    useEffect(() => {
        if (open) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
    }, [open, active]);

    const close = () => { setOpen(false); setQuery(null); };
    const pick = (o: ComboOption) => { onChange(o.value); close(); };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.altKey || e.metaKey || e.ctrlKey) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (!open && e.key === "ArrowUp") return;
            e.preventDefault();
            if (!open) { setOpen(true); return; }
            if (shown.length) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length);
        } else if (e.key === "Enter" && open && shown[active]) {
            e.preventDefault();
            pick(shown[active]);
        } else if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            close();
        }
    };

    return (
        <span className="wt-combo">
            <input value={value} role="combobox" aria-expanded={open} aria-controls={id} aria-autocomplete="list"
                aria-activedescendant={open && shown[active] ? `${id}-${active}` : undefined}
                inputMode={inputMode} placeholder={placeholder} {...aria}
                onFocus={() => { if (openOnFocus) setOpen(true); }} onBlur={close} onClick={() => setOpen(true)} onKeyDown={onKeyDown}
                onChange={(e) => { onChange(e.target.value); setQuery(e.target.value); setOpen(true); }} />
            {note && <span className="wt-combo-note">{note}</span>}
            {open && shown.length > 0 && (
                <ul className="wt-combo-list" id={id} role="listbox" ref={listRef}>
                    {shown.map((o, i) => (
                        <li key={o.value} id={`${id}-${i}`} role="option" aria-selected={i === active} className={i === active ? "active" : ""}
                            // keep focus in the field
                            onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseMove={() => setActive(i)}>
                            <b>{o.value}</b>
                            {o.label && <span>{o.label}</span>}
                            {o.hint && <small>{o.hint}</small>}
                        </li>
                    ))}
                </ul>
            )}
        </span>
    );
}

/** Styles for {@link Combobox} (theme variables from ./theme.ts). */
export const COMBOBOX_CSS = `
.wt-combo { position: relative; display: flex; align-items: center; gap: 8px; }
.wt-combo > input { width: 90px; flex: none; }
.wt-combo-note { color: var(--wt-text-muted); font: 12px system-ui, -apple-system, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wt-combo-list { position: absolute; top: calc(100% + 2px); left: 0; z-index: 10; min-width: 360px; max-height: 240px; overflow: auto; margin: 0; padding: 4px; list-style: none;
  background: var(--wt-surface); color: var(--wt-text); border: 1px solid var(--wt-border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.25); font: 12px system-ui, -apple-system, sans-serif; }
.wt-combo-list li { display: flex; align-items: baseline; gap: 8px; padding: 4px 8px; border-radius: 6px; cursor: pointer; }
.wt-combo-list li.active { background: var(--wt-green-bg); }
.wt-combo-list li b { font: 600 12px ui-monospace, Menlo, monospace; min-width: 32px; }
.wt-combo-list li small { margin-left: auto; color: var(--wt-text-muted); padding-left: 12px; }
`;
