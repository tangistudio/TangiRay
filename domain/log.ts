import { matches } from "./filter";
import type { LoggedRequest, Rule } from "./types";

// -------------------------------------------------------------------------------------------------
// REQUEST LOG
// Limits and trimming of a page's logged requests.
// -------------------------------------------------------------------------------------------------

/** Requests kept per page, counting a folded group as one and hidden requests not at all. */
export const MAX_LOG = 200;
/** Kept besides: the newest requests of each folded group, and the newest hidden ones. */
export const MAX_FOLDED_KEPT = 20;
export const MAX_HIDDEN_KEPT = 200;

/** Requests this alike show as one row; headers don't count: tracing headers (sentry-trace, baggage…) differ on every request. */
export const FOLD_MIN = 3;
export const foldKeyOf = (e: Pick<LoggedRequest, "method" | "url" | "body">) => `${e.method} ${e.url}\n${e.body ?? ""}`;

/** The group a request folds into: the rule's, or the alike requests' (see foldKeyOf). */
export type FoldKeyOf = (e: LoggedRequest) => string;
// alike requests' keys start with the method: never this
const RULE_FOLD = "rule:";

/** Fold rules (enabled ones) fold every request they match into one group each, alike or not; the first one matching wins. */
export const foldKeyer = (foldRules: readonly Pick<Rule, "id" | "filter">[]): FoldKeyOf => (e) => {
    const rule = foldRules.find((r) => matches(r.filter, e.method, e.url, e.body));
    return rule ? RULE_FOLD + rule.id : foldKeyOf(e);
};

/** The fold rule of a group's key, if a rule folded it. */
export const foldRuleId = (key: string) => (key.startsWith(RULE_FOLD) ? key.slice(RULE_FOLD.length) : undefined);

/** How many requests a group needs to show as one row: a fold rule's folds from 2. */
export const foldMin = (key: string) => (foldRuleId(key) !== undefined ? 2 : FOLD_MIN);

/** Drops the oldest requests past MAX_LOG (see there), in place: the kept entries stay the same objects. */
export function trimLog(log: LoggedRequest[], isHidden: (e: LoggedRequest) => boolean, keyOf: FoldKeyOf = foldKeyOf, foldSimilar = true) {
    const sizes = new Map<string, number>();
    for (const e of log) { const key = keyOf(e); sizes.set(key, (sizes.get(key) ?? 0) + 1); }
    const seen = new Map<string, number>();
    const keptGroups = new Set<string>();
    let rows = 0;
    let hidden = 0;
    for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i];
        let keep: boolean;
        if (isHidden(e)) keep = ++hidden <= MAX_HIDDEN_KEPT;
        else {
            const key = keyOf(e);
            const n = (seen.get(key) ?? 0) + 1;
            seen.set(key, n);
            if ((!foldSimilar && foldRuleId(key) === undefined) || sizes.get(key)! < foldMin(key)) keep = ++rows <= MAX_LOG;
            // a folded group's newest request is its row; older ones go with it
            else if (n === 1) { keep = ++rows <= MAX_LOG; if (keep) keptGroups.add(key); }
            else keep = keptGroups.has(key) && n <= MAX_FOLDED_KEPT;
        }
        if (!keep) log.splice(i, 1);
    }
}
export const MAX_LOGGED_BODY = 1000;
