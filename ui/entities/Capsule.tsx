import { createContext, useContext } from "react";
import { selectionIn } from "../../shared/ui/shadow-root";
import { type Directory, EMPTY_DIRECTORY, type Entity, findEntities } from "../../domain/entities";

// -------------------------------------------------------------------------------------------------
// ENTITY CAPSULES
// Entity ids and names in text, shown as labelled capsules.
// -------------------------------------------------------------------------------------------------

// created on first use: onSite code imports this module too (through the script), and may not call React
let directoryContext: React.Context<Directory> | undefined;

/** The directory capsules look names up in; provide the merged one (the plugins' page state + responses). */
export function DirectoryContext() {
    return (directoryContext ??= createContext<Directory>(EMPTY_DIRECTORY));
}

// kinds the plugins' CSS doesn't color get a color of their own, derived from the name
function kindStyle(kind: string, styled: readonly string[] = []): React.CSSProperties | undefined {
    if (styled.includes(kind)) return undefined;
    const hue = [...kind].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    return {
        background: `color-mix(in srgb, hsl(${hue} 70% var(--wt-cap-bg-l)) 45%, var(--wt-surface))`,
        borderColor: `color-mix(in srgb, hsl(${hue} 55% var(--wt-cap-border-l)) 30%, var(--wt-surface))`,
        color: `color-mix(in srgb, hsl(${hue} 60% var(--wt-cap-text-l)) 40%, var(--wt-text-soft))`,
    };
}

/** `text` with the entities in it as capsules. */
export function Enriched({ text }: { text: string }) {
    const dir = useContext(DirectoryContext());
    return <>{findEntities(text, dir).map((p, i) => (typeof p === "string" ? p : <Capsule key={i} entity={p.entity} known={p.known} raw={p.text} />))}</>;
}

/** A URL as {@link Enriched} text, kept left-to-right so `.aip-clip-url` can clip its start ("Show the end of long URLs"). */
export function EnrichedUrl({ text }: { text: string }) {
    return <bdi dir="ltr"><Enriched text={text} /></bdi>;
}

export function Capsule({ entity, known = true, raw }: { entity: Entity; known?: boolean; raw?: string }) {
    const dir = useContext(DirectoryContext());
    const parent = entity.parent ? dir.ids[entity.parent] : undefined;
    const title = [
        `${entity.kind}${entity.current ? " (current)" : ""}: ${known ? entity.name : "not in this page's data"}`,
        entity.parent ? `in ${parent ? `${parent.kind} ${parent.name}` : entity.parent}` : "",
        raw ?? entity.id,
    ].filter(Boolean).join("\n");
    return (
        <span className={`aip-cap ${known ? entity.kind : "unknown"} ${entity.current ? "current" : ""}`} style={known ? kindStyle(entity.kind, dir.hints?.styledKinds) : undefined} title={title}
            data-raw={raw ?? entity.id}>
            <span className="aip-cap-kind">{entity.kind}</span>{entity.name}
        </span>
    );
}

/**
 * `copy` handler for anything showing capsules: copied text gets each capsule's raw text (the id
 * or name it stands for) instead of its label, so a copied URL is the real URL.
 */
export function copyCapsulesRaw(event: React.ClipboardEvent) {
    if ((event.target as Element)?.matches?.("textarea, input")) return;
    const selection = selectionIn(event.currentTarget);
    if (!selection || selection.isCollapsed) return;
    const copy = document.createElement("div");
    for (let i = 0; i < selection.rangeCount; i++) copy.append(selection.getRangeAt(i).cloneContents());
    const capsules = copy.querySelectorAll<HTMLElement>(".aip-cap");
    if (!capsules.length) return; // the browser's own copy is fine
    // a capsule cut by the selection's edge still stands for its whole raw text
    for (const capsule of capsules) capsule.replaceWith(capsule.dataset.raw ?? capsule.textContent ?? "");
    // innerText keeps line breaks between blocks, but only for rendered elements
    copy.style.cssText = "position:fixed;left:-99999px;top:0;white-space:pre-wrap";
    // in its shadow root, if any: the page behind the palette is inert
    const root = event.currentTarget.getRootNode();
    (root instanceof ShadowRoot ? root : document.body).append(copy);
    const text = copy.innerText;
    copy.remove();
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
}
/** `text` as a capsule when it's an entity (`before` is the word preceding it, e.g. "groups"), else `fallback`. */
export function EntityOr({ text, before = "", fallback = text }: { text: string; before?: string; fallback?: React.ReactNode }) {
    const dir = useContext(DirectoryContext());
    const last = findEntities(`${before}/${text}`, dir).at(-1);
    return <>{last && typeof last !== "string" && last.text === text ? <Capsule entity={last.entity} known={last.known} raw={text} /> : fallback}</>;
}
