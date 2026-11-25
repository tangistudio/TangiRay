import { tweak } from "tangitweak";
import { MAX_RESPONSE_ENTITIES, readDirectory } from "../../domain/entities";
import type { SitePart, SitePluginApi } from "../../plugin";
import { retry } from "../../shared/util/retry";
import { ReduxCapture } from "./redux-capture";
import { ENTITY_RULES, RESPONSE_ENTITY_RULES, responseRulePatterns } from "./rules";

// -------------------------------------------------------------------------------------------------
// ATLAS ENTITIES (site part)
// Names of the orgs, projects and clusters in Atlas' Redux state, read on demand (the palette's
// `directory` call), and the entities in the JSON responses RESPONSE_ENTITY_RULES name.
// -------------------------------------------------------------------------------------------------

export function atlasEntitiesSite(ctx: TangiTweak.SiteCtx, api: SitePluginApi): SitePart {
    ctx.once("redux-store-capture", ReduxCapture.installHook);
    const reduxStore = retry(() => {
        const s = ReduxCapture.find();
        if (!s) throw new Error("Redux store is not captured yet.");
        return s;
    });
    reduxStore.catch(() => {}); // reported when the palette asks
    return {
        readsJson: (url) => responseRulePatterns.some((p) => p.test(url)),
        json: (url, value) => {
            const rules = RESPONSE_ENTITY_RULES.filter((_, i) => responseRulePatterns[i].test(url));
            const { ids, counts } = readDirectory(value, rules);
            const keys = Object.keys(ids).slice(0, MAX_RESPONSE_ENTITIES);
            if (keys.length) api.emit({ kind: "entities", entities: Object.fromEntries(keys.map((k) => [k, ids[k]])) });
            tweak.log(`[tangiray] entities from ${url}:\n${rules.map((r, i) => `${counts[i]}\t${r.source}`).join("\n")}`);
        },
        rpc: {
            directory: async () => ({ ids: readDirectory((await reduxStore).getState(), ENTITY_RULES).ids }),
        },
    };
}
