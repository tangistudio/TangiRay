
// -------------------------------------------------------------------------------------------------
// ENTITIES
// Named things (e.g. orgs, projects, clusters: whatever the plugins' rules pick up) read from the
// page's state and from API responses, to show names in place of the ids found in API URLs.
// -------------------------------------------------------------------------------------------------

/** any kind a rule names, e.g. "project" or "search-index" */
export type EntityKind = string;

export interface Entity {
    kind: EntityKind;
    id: string;
    name: string;
    /** the active org/project, or the signed-in user */
    current?: boolean;
    /** the id of its parent, e.g. a cluster's project */
    parent?: string;
}

export interface Directory {
    /** by every key an extraction rule indexes it under: ids, and e.g. cluster names */
    ids: Record<string, Entity>;
    /** URL path shapes learned from requests, for entities the ids don't know (see learnPathTemplates) */
    pathTemplates?: PathTemplates;
    /** how to recognise unknown entities, from the plugins */
    hints?: EntityHints;
}

/** How to recognise entities the directory doesn't know, by the word before them (lowercase keys). */
export interface EntityHints {
    /** the shape of an opaque id (e.g. a 24-hex ObjectId), shortened when shown */
    opaqueId?: RegExp;
    /** an opaque id after this word is of this kind ("groups/<id>" → project) */
    kindBefore?: Record<string, EntityKind>;
    /** any value after this word is the name of one of this kind ("clusterName=<name>" → cluster) */
    nameAfter?: Record<string, EntityKind>;
    /** kinds the plugins' CSS colors (`.aip-cap.<kind>`); others get a color derived from their name */
    styledKinds?: EntityKind[];
}

export const EMPTY_DIRECTORY: Directory = { ids: {} };

/** The plugins' hints, together (later ones win on the same word). */
export function mergeHints(all: (EntityHints | undefined)[]): EntityHints {
    const hints = all.filter((h): h is EntityHints => !!h);
    const ids = hints.map((h) => h.opaqueId).filter((r): r is RegExp => !!r);
    return {
        opaqueId: ids.length > 1 ? new RegExp(ids.map((r) => `(?:${r.source})`).join("|")) : ids[0],
        kindBefore: Object.assign({}, ...hints.map((h) => h.kindBefore)),
        nameAfter: Object.assign({}, ...hints.map((h) => h.nameAfter)),
        styledKinds: hints.flatMap((h) => h.styledKinds ?? []),
    };
}

// -------------------------------------------------------------------------------------------------
// EXTRACTION RULES
// One per line: `<kind> <path> [id=…] [name=…] [parent=…] [when=…]`, from API responses
// `<URLPattern> <kind> <path> …`
// - kind: any word (a plugin's CSS may color its kinds, see EntityHints), or `current` (path
//   points at ids to mark as current)
// - path: dot-separated keys from the state/response root (`$` = the root itself); `*` = every
//   child, `**` = any depth (8 max)
// - id: fields to index the entity by, comma-separated (default `id`); `$key` = the key `*` matched
// - name: `a+b` joins fields with a space, `a|b` takes the first non-empty (default `name`)
// - parent: field holding the id of the entity's parent, shown with it (e.g. a cluster's project)
// - when: fields that must be present, comma-separated (to pick objects out of a `**` walk)
// Fields are dot-separated paths from the matched object. Later rules add to earlier ones.
// -------------------------------------------------------------------------------------------------

export interface ExtractRule {
    source: string;
    /** response rules: the API URLs whose JSON responses it reads */
    url?: string;
    kind: EntityKind;
    path: string[];
    id: string[];
    name: string[][];
    parent?: string;
    when: string[];
}

/** Parses extraction rule lines (blank and `#` lines skipped; `withUrl`: each starts with a URLPattern); throws on a malformed one. */
export function parseExtractRules(lines: string[], { withUrl = false } = {}): ExtractRule[] {
    return lines.map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((line) => {
        const tokens = line.split(/\s+/);
        const url = withUrl ? tokens.shift() : undefined;
        if (url !== undefined) {
            try { new URLPattern(url); } catch (e) { throw new Error(`"${line}": invalid URL pattern "${url}": ${(e as Error).message}`); }
        }
        const [kind, path, ...options] = tokens;
        if (!kind || !/^[a-z][\w-]*$/i.test(kind)) throw new Error(`"${line}": the kind must be a word, like org, project, cluster, user, search-index, or current`);
        if (!path) throw new Error(`"${line}": missing the path`);
        const rule: ExtractRule = { source: line, url, kind, path: path.split(".").filter((seg, i) => !(i === 0 && seg === "$")), id: ["id"], name: [["name"]], when: [] };
        for (const option of options) {
            const at = option.indexOf("=");
            const [key, value] = at < 0 ? [option, ""] : [option.slice(0, at), option.slice(at + 1)];
            if (!value) throw new Error(`"${line}": "${option}" should be key=value`);
            if (key === "id") rule.id = value.split(",");
            else if (key === "name") rule.name = value.split("|").map((alt) => alt.split("+"));
            else if (key === "parent") rule.parent = value;
            else if (key === "when") rule.when = value.split(",");
            else throw new Error(`"${line}": unknown option "${key}" (id, name, parent, when)`);
        }
        return rule;
    });
}

/** Builds the directory from page state (or a response) with `rules`; runs in the site's world. `counts[i]` = entities rule i found. */
export function readDirectory(state: unknown, rules: ExtractRule[]): Directory & { counts: number[] } {
    const dir: Directory = { ids: {} };
    const counts = rules.map((rule) => {
        let count = 0;
        for (const { value, key } of select(state, rule.path, "", 8)) {
            if (rule.kind === "current") {
                for (const id of Array.isArray(value) ? value : [value])
                    if (typeof id === "string" && dir.ids[id]) { dir.ids[id].current = true; count++; }
                continue;
            }
            if (!value || typeof value !== "object" || rule.when.some((f) => field(value, f, key) == null)) continue;
            const keys = rule.id.map((f) => field(value, f, key)).filter((k): k is string => typeof k === "string" && k !== "");
            const name = rule.name.map((alt) => alt.map((f) => field(value, f, key)).filter((v) => v != null && v !== "").join(" ")).find(Boolean);
            if (!keys.length || !name) continue;
            const entity: Entity = Object.assign(dir.ids[keys[0]] ?? {}, { kind: rule.kind, id: keys[0], name });
            for (const k of keys) dir.ids[k] = entity;
            const parent = rule.parent && field(value, rule.parent, key);
            if (typeof parent === "string") entity.parent = parent;
            count++;
        }
        return count;
    });
    return { ...dir, counts };
}

function select(value: unknown, path: string[], key: string, depth: number): { value: any; key: string }[] {
    if (!path.length) return [{ value, key }];
    if (!value || typeof value !== "object") return [];
    const [segment, ...rest] = path;
    if (segment === "*")
        return Object.entries(value).flatMap(([k, v]) => select(v, rest, k, depth));
    if (segment === "**") {
        const here = select(value, rest, key, depth);
        return depth <= 0 ? here : [...here, ...Object.entries(value).flatMap(([k, v]) => select(v, path, k, depth - 1))];
    }
    return select((value as any)[segment], rest, key, depth);
}

function field(value: any, path: string, key: string): unknown {
    if (path === "$key") return key;
    return path.split(".").reduce((v, k) => (v == null ? v : v[k]), value);
}

// -------------------------------------------------------------------------------------------------
// FINDING ENTITIES IN TEXT
// Known ids and names anywhere; unknown ones by the word before them (see EntityHints), shown by kind.
// -------------------------------------------------------------------------------------------------

export type Part = string | { text: string; entity: Entity; known: boolean };

export function findEntities(text: string, dir: Directory): Part[] {
    const parts: Part[] = [];
    const inPath = pathKinds(text, dir.pathTemplates, dir.ids);
    let last = 0;
    let previous = "";
    for (const m of text.matchAll(/[A-Za-z0-9._%-]+/g)) {
        const token = m[0];
        const entity = lookup(token, previous, dir, inPath);
        if (entity) {
            if (m.index! > last) parts.push(text.slice(last, m.index));
            parts.push({ text: token, ...entity });
            last = m.index! + token.length;
        }
        previous = token;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
}

function lookup(token: string, previous: string, dir: Directory, inPath: Map<string, EntityKind>): { entity: Entity; known: boolean } | undefined {
    const known = dir.ids[token];
    if (known) return { entity: known, known: true };
    const { opaqueId, kindBefore, nameAfter } = dir.hints ?? {};
    const opaque = !!opaqueId?.test(token);
    const before = previous.toLowerCase();
    const kind = inPath.get(token) ?? (opaque ? kindBefore?.[before] : undefined);
    if (kind) return { entity: { kind, id: token, name: opaque ? `${token.slice(0, 4)}…${token.slice(-4)}` : safeDecode(token) }, known: false };
    const named = nameAfter?.[before];
    if (named) return { entity: { kind: named, id: token, name: token }, known: false };
    return undefined;
}

// -------------------------------------------------------------------------------------------------
// PATH TEMPLATES
// Learned from the URLs the page requested: a path holding known entities gives its shape, and
// other paths of that shape hold entities of the same kinds at those segments
// ("/nds/clusters/<project>/Cluster0/metrics" makes Foo in "/nds/clusters/<other>/Foo/metrics" a
// cluster). Unknown opaque ids (EntityHints.opaqueId) match any opaque id; a slot learned only
// from opaque ids takes only opaque ids (or a filter's `*`); a word that is a literal segment of some template ("provider")
// is a route, never an entity.
// -------------------------------------------------------------------------------------------------

/** an entity's segment; kind null: an unknown opaque id */
type Slot = { kind: EntityKind | null; opaque: boolean };

export interface PathTemplates {
    templates: (string | Slot)[][];
    /** the literal segments of every template */
    routeWords: Set<string>;
    opaqueId?: RegExp;
}

export function learnPathTemplates(texts: Iterable<string>, ids: Record<string, Entity>, opaqueId?: RegExp): PathTemplates {
    const templates = new Map<string, (string | Slot)[]>();
    for (const text of texts) {
        const pathname = pathOf(text);
        if (!pathname) continue;
        let entities = 0;
        const template = pathname.split("/").filter(Boolean).map((raw): string | Slot => {
            const segment = safeDecode(raw);
            const opaque = !!opaqueId?.test(segment);
            const kind = ids[segment]?.kind;
            if (kind) { entities++; return { kind, opaque }; }
            return opaque ? { kind: null, opaque } : segment;
        });
        // an all-slot template would match every path of its length
        if (entities && template.some((s) => typeof s === "string"))
            templates.set(template.map((s) => (typeof s === "string" ? s : `\0${s.kind}\0${s.opaque}`)).join("/"), template);
    }
    const all = [...templates.values()];
    return { templates: all, routeWords: new Set(all.flat().filter((s): s is string => typeof s === "string")), opaqueId };
}

function pathKinds(text: string, learned: PathTemplates | undefined, ids: Record<string, Entity>): Map<string, EntityKind> {
    const kinds = new Map<string, EntityKind>();
    const pathname = learned?.templates.length ? pathOf(text) : undefined;
    if (!pathname) return kinds;
    const raws = pathname.split("/").filter(Boolean);
    const segments = raws.map(safeDecode);
    for (const template of learned!.templates) {
        if (template.length !== segments.length) continue;
        const fits = template.every((t, i) => typeof t === "string"
            ? t === segments[i]
            : segments[i] === "*" || !t.opaque || !!learned!.opaqueId?.test(segments[i]));
        if (!fits) continue;
        template.forEach((t, i) => {
            const segment = segments[i];
            if (typeof t !== "string" && t.kind && segment !== "*" && !ids[segment] && !learned!.routeWords.has(segment))
                kinds.set(raws[i], t.kind);
        });
    }
    return kinds;
}

function safeDecode(text: string) {
    try { return decodeURIComponent(text); } catch { return text; }
}

// the path in a URL, "/path?query", or "GET host/path?query" (a filter's description)
function pathOf(text: string): string | undefined {
    if (/^https?:\/\//.test(text)) {
        try { return new URL(text).pathname; } catch { return undefined; }
    }
    return text.match(/\/[^?#\s]*/)?.[0];
}

/** The entity names in `text`, for search. */
export function entityNames(text: string, dir: Directory): string {
    return findEntities(text, dir).flatMap((p) => (typeof p === "string" ? [] : [p.entity.name, p.entity.kind])).join(" ");
}

/** Entities kept per page from API responses. */
export const MAX_RESPONSE_ENTITIES = 3000;
