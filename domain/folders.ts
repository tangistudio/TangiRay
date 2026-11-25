import type { Rule, RuleStore } from "./types";

// -------------------------------------------------------------------------------------------------
// FOLDERS
// Rules sit in nested folders, named by path: the folders' names joined with FOLDER_SEP. A folder exists
// while a rule is in it (or under it) or it's listed in RuleStore.folders (made empty, or emptied).
// Moving and renaming rewrite the paths of everything under the folder.
// -------------------------------------------------------------------------------------------------

/** Joins the names in a path: a control character, so a name can hold anything typed ("/" too). */
export const FOLDER_SEP = "\u001F";

/** Trims the names, drops empty ones; "" when nothing's left. */
export const normalizeFolder = (path: string) => folderNames(path).map((s) => s.trim()).filter(Boolean).join(FOLDER_SEP);

/** The names in a path, outermost first ([] for the top level). */
export const folderNames = (path: string) => (path ? path.split(FOLDER_SEP) : []);
export const folderName = (path: string) => path.slice(path.lastIndexOf(FOLDER_SEP) + 1);
export const parentFolder = (path: string) => (path.includes(FOLDER_SEP) ? path.slice(0, path.lastIndexOf(FOLDER_SEP)) : "");
export const joinFolder = (parent: string, name: string) => (parent ? `${parent}${FOLDER_SEP}${name}` : name);
/** Whether `path` is `folder` or inside it ("" holds everything). */
export const isWithin = (path: string, folder: string) => !folder || path === folder || path.startsWith(`${folder}${FOLDER_SEP}`);

/** Every folder, with the folders above each. */
export function allFolders(store: Readonly<RuleStore>): Set<string> {
    const paths = new Set<string>();
    for (const path of [...(store.folders ?? []), ...store.rules.map((r) => r.folder ?? "")])
        for (let p = path; p; p = parentFolder(p)) paths.add(p);
    return paths;
}

/** The rules in the folder or under it. */
export const rulesWithin = (rules: readonly Rule[], folder: string) => rules.filter((r) => isWithin(r.folder ?? "", folder));

export interface FolderNode {
    path: string;
    name: string;
    folders: FolderNode[];
    rules: Rule[];
}

/** `rules` (in their order) under their folders; folders sorted by name. `folders`: the ones to show. */
export function folderTree(rules: readonly Rule[], folders: Iterable<string>): FolderNode {
    const root: FolderNode = { path: "", name: "", folders: [], rules: [] };
    const nodes = new Map<string, FolderNode>([["", root]]);
    const node = (path: string): FolderNode => {
        let n = nodes.get(path);
        if (!n) {
            n = { path, name: folderName(path), folders: [], rules: [] };
            nodes.set(path, n);
            node(parentFolder(path)).folders.push(n);
        }
        return n;
    };
    for (const path of folders) node(path);
    for (const r of rules) node(r.folder ?? "").rules.push(r);
    const sort = (n: FolderNode) => { n.folders.sort((a, b) => a.name.localeCompare(b.name)); n.folders.forEach(sort); };
    sort(root);
    return root;
}

/** A new folder's path under `parent`, "New folder", "New folder 2"… whichever is free. */
export function newFolderPath(store: Readonly<RuleStore>, parent: string): string {
    const taken = allFolders(store);
    for (let i = 1; ; i++) {
        const path = joinFolder(parent, i === 1 ? "New folder" : `New folder ${i}`);
        if (!taken.has(path)) return path;
    }
}

export function addFolder(store: RuleStore, path: string) {
    (store.folders ??= []).push(path);
}

/** Renames/moves the folder at `from` (and all under it) to `to`; false when `to` is inside `from`. Merges into an existing folder. */
export function moveFolder(store: RuleStore, from: string, to: string): boolean {
    to = normalizeFolder(to);
    if (!to || to === from) return to === from;
    if (isWithin(to, from)) return false;
    const rename = (p: string) => (isWithin(p, from) ? to + p.slice(from.length) : p);
    for (const r of store.rules) if (r.folder && isWithin(r.folder, from)) r.folder = rename(r.folder);
    store.folders = [...new Set((store.folders ?? []).map(rename))];
    return true;
}

/** Moves the folder into `parent` ("" = top level), keeping its name. */
export const moveFolderInto = (store: RuleStore, from: string, parent: string) => moveFolder(store, from, joinFolder(parent, folderName(from)));

/** Removes the folder; what was in it moves up to its parent. */
export function deleteFolder(store: RuleStore, path: string) {
    const parent = parentFolder(path);
    const lift = (p: string) => (isWithin(p, path) ? normalizeFolder(parent + p.slice(path.length)) : p);
    for (const r of store.rules) if (r.folder && isWithin(r.folder, path)) r.folder = lift(r.folder) || undefined;
    store.folders = [...new Set((store.folders ?? []).filter((p) => p !== path).map(lift).filter(Boolean))];
}

/** Moves the rule into `folder` ("" = top level), before rule `beforeId` when given (rule order is the order they apply in). */
export function moveRule(store: RuleStore, id: string, folder: string, beforeId?: string) {
    const from = store.rules.findIndex((r) => r.id === id);
    if (from < 0 || id === beforeId) return;
    const [rule] = store.rules.splice(from, 1);
    if (folder) rule.folder = folder; else delete rule.folder;
    const at = beforeId ? store.rules.findIndex((r) => r.id === beforeId) : -1;
    if (at >= 0) store.rules.splice(at, 0, rule); else store.rules.push(rule);
}
