import { Fragment, useRef } from "react";
import { UNSAFE_PortalProvider } from "react-aria/PortalProvider";
import { Button } from "react-aria-components/Button";
import { Menu, MenuItem as AriaMenuItem, MenuTrigger, SubmenuTrigger } from "react-aria-components/Menu";
import { Popover } from "react-aria-components/Popover";
import { Separator } from "react-aria-components/Separator";
import { enableShadowDOM } from "react-stately/private/flags/flags";

// -------------------------------------------------------------------------------------------------
// MORE MENU
// The list's "⋯" menu, on React Aria's menu: submenus open beside their item on hover (or ←/→),
// ↑/↓ move, typing jumps to an item, ↵ picks, Esc closes. The palette lives in a closed shadow
// root: React Aria's shadow DOM support follows focus inside it, and its popovers render into the
// palette (UNSAFE_PortalProvider), not into the page's body under the palette's top layer.
// Imported by component: the packages' index is over TangiTweak's 1000-module download limit.
// -------------------------------------------------------------------------------------------------

enableShadowDOM();

/** `items`: a submenu beside this item; `checked`: a checkbox, which ticks without closing the menu. */
export type MenuItem = { label: string; icon?: string; title?: string; disabled?: boolean; failed?: boolean; separator?: boolean; checked?: boolean }
    & ({ onSelect: () => void; items?: undefined } | { items: MenuItem[]; onSelect?: undefined });

export function MoreMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
    const layer = useRef<HTMLDivElement>(null);
    return (
        <UNSAFE_PortalProvider getContainer={() => layer.current}>
            <MenuTrigger onOpenChange={(open) => { if (!open) requestAnimationFrame(onClose); }}>
                <Button aria-label="More actions">⋯</Button>
                <Popover className="aip-menu-popover" placement="top end" offset={6}>
                    <MenuList items={items} />
                </Popover>
            </MenuTrigger>
            {/* fixed over the viewport: the popovers are placed in it */}
            <div className="aip-menu-layer" ref={layer} />
        </UNSAFE_PortalProvider>
    );
}

/** One menu's items: actions and submenus, or (any `checked` in it) checkboxes. */
function MenuList({ items }: { items: MenuItem[] }) {
    const checkboxes = items.some((item) => item.checked !== undefined);
    const selected = new Set(items.flatMap((item, i) => (item.checked ? [String(i)] : [])));
    const disabled = items.flatMap((item, i) => (item.disabled ? [String(i)] : []));
    const onSelectionChange = (keys: "all" | Iterable<React.Key>) => {
        const now = keys === "all" ? new Set(items.map((_, i) => String(i))) : new Set([...keys].map(String));
        items.forEach((item, i) => { if (now.has(String(i)) !== selected.has(String(i))) item.onSelect?.(); });
    };
    return (
        // the list's own keys (↵ acts on the selected row) aren't for the menu
        <div onKeyDown={(e) => e.stopPropagation()}>
            <Menu className="aip-menu" disabledKeys={disabled}
                {...(checkboxes
                    ? { selectionMode: "multiple" as const, selectedKeys: selected, onSelectionChange }
                    : { onAction: (key: React.Key) => items[Number(key)].onSelect?.() })}>
                {items.map((item, i) => (
                    <Fragment key={i}>
                        {item.separator && <Separator className="aip-menu-sep" />}
                        {item.items ? (
                            <SubmenuTrigger>
                                <Entry id={String(i)} item={item} />
                                <Popover className="aip-menu-popover" offset={-2}>
                                    <MenuList items={item.items} />
                                </Popover>
                            </SubmenuTrigger>
                        ) : <Entry id={String(i)} item={item} />}
                    </Fragment>
                ))}
            </Menu>
        </div>
    );
}

function Entry({ id, item }: { id: string; item: MenuItem }) {
    return (
        <AriaMenuItem id={id} textValue={item.label} className={`aip-menu-item${item.failed ? " aip-failed" : ""}`}>
            {({ isSelected, hasSubmenu }) => (
                <span className="aip-menu-content" title={item.title}>
                    <span className="aip-menu-icon" aria-hidden>{item.checked === undefined ? item.icon : isSelected ? "✓" : ""}</span>
                    {item.label}
                    {hasSubmenu && <span className="aip-menu-chevron" aria-hidden>▸</span>}
                </span>
            )}
        </AriaMenuItem>
    );
}
