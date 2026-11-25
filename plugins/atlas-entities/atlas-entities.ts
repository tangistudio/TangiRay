import type { InterceptorPlugin } from "../../plugin";
import { ATLAS_ENTITY_CSS, ATLAS_HINTS } from "./hints";
import { atlasEntitiesSite } from "./read-redux";

// -------------------------------------------------------------------------------------------------
// ATLAS ENTITIES PLUGIN
// Org, project and cluster names from Atlas' Redux state (./redux-capture, ./read-redux) and API
// responses (./rules), shown as capsules in place of their ids; unknown ids labelled by the word
// before them (./hints). Also folds away Atlas API headers rarely of interest. Plugged in by the
// entry script (../../index.ts); switched on and off in ⋯ → Plugins.
// -------------------------------------------------------------------------------------------------

/** Atlas' pages: the environments and local MMS. */
const ATLAS_PAGES = ["http://localhost:8080/*", "https://cloud-dev.mongodb.com/*", "https://cloud.mongodb.com/*", "https://cloud-qa.mongodb.com/*"];

export function atlasEntitiesPlugin(): InterceptorPlugin {
    return {
        id: "atlas-entities",
        name: "Atlas: org, project and cluster names",
        pages: ATLAS_PAGES,
        site: atlasEntitiesSite,
        css: ATLAS_ENTITY_CSS,
        entities: {
            hints: ATLAS_HINTS,
            directory: (call) => call("directory"),
        },
        // Atlas API response headers that are rarely of interest
        minorHeaders: ["x-java-version", "x-mongodb-service-version", "x-xgen-up-proto"],
    };
}
