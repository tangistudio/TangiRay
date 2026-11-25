import { subscribe } from "valtio";
import type { Rule, RuleStore } from "./types";

// -------------------------------------------------------------------------------------------------
// UNDO / REDO of the rules and folders: a snapshot before each change. Hit counts aren't part of it
// (requests bump them: not a change to undo) and stay as they are through an undo. valtio sends a
// burst of changes (a multi-rule drag) as one notification: one step.
// -------------------------------------------------------------------------------------------------

const MAX_STEPS = 100;

const snapshot = (s: RuleStore) => JSON.stringify({ rules: s.rules.map(({ hits: _, ...r }) => r), folders: s.folders ?? [] });

export function trackHistory(store: RuleStore) {
    const undos: string[] = [];
    const redos: string[] = [];
    let current = snapshot(store);
    const dispose = subscribe(store, () => {
        const next = snapshot(store);
        if (next === current) return;
        undos.push(current);
        if (undos.length > MAX_STEPS) undos.shift();
        redos.length = 0;
        current = next;
    });
    const restore = (to: string) => {
        const { rules, folders } = JSON.parse(to) as { rules: Omit<Rule, "hits">[]; folders: string[] };
        const hits = new Map(store.rules.map((r) => [r.id, r.hits]));
        // set first: the notification this sends then matches it, and isn't a new step
        current = to;
        store.rules = rules.map((r) => ({ ...r, hits: hits.get(r.id) ?? 0 }));
        store.folders = folders;
    };
    const step = (from: string[], to: string[]) => {
        const target = from.pop();
        if (target === undefined) return false;
        to.push(current);
        restore(target);
        return true;
    };
    return { undo: () => step(undos, redos), redo: () => step(redos, undos), dispose };
}
