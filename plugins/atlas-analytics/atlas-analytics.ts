import type { InterceptorPlugin } from "../../plugin";
import { AnalyticsEvents, ANALYTICS_EVENTS_CSS } from "./AnalyticsEvents";

// -------------------------------------------------------------------------------------------------
// ATLAS ANALYTICS PLUGIN
// Atlas' Segment/Heliotrope calls (api.blue.mongodb.com) decoded above their request's body, the
// important parts first (./AnalyticsEvents). Plugged in by the entry script (../../index.ts);
// switched on and off in ⋯ → Plugins.
// -------------------------------------------------------------------------------------------------

/** Atlas' pages: the environments and local MMS. */
const ATLAS_PAGES = ["http://localhost:8080/*", "https://cloud-dev.mongodb.com/*", "https://cloud.mongodb.com/*", "https://cloud-qa.mongodb.com/*"];

export function atlasAnalyticsPlugin(): InterceptorPlugin {
    return {
        id: "atlas-analytics",
        name: "Atlas: analytics Segment events",
        pages: ATLAS_PAGES,
        css: ANALYTICS_EVENTS_CSS,
        RequestSection: AnalyticsEvents,
    };
}
