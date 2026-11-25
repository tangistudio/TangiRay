import { tweak } from "tangitweak";
import { installApiInterceptor } from "./api-interceptor";
import type { SiteState } from "./domain/types";
import { atlasAnalyticsPlugin } from "./plugins/atlas-analytics/atlas-analytics";
import { atlasCcsPlugin } from "./plugins/atlas-ccs/atlas-ccs";
import { atlasEntitiesPlugin } from "./plugins/atlas-entities/atlas-entities";

// -------------------------------------------------------------------------------------------------
// TANGIRAY
// Tracks the tab's fetch/XHR calls, and runs rules that pause, edit, mock, delay, hide, favourite
// or fold them. Plugins (./plugin.ts) add site-specific knowledge: to unplug one, remove its line
// in `plugins` (and its folder in ./plugins, if you like); to switch one off, use ⋯ → Plugins.
// Opens with its own shortcut.
// -------------------------------------------------------------------------------------------------

const cfg = tweak.params({
    shortcut: {
        description: "Keyboard shortcut that opens the TangiRay palette.",
        type: "shortcut",
        default: "Mod+'",
    },
    pages: {
        description: "URL patterns (URLPattern syntax) of the pages where the interceptor works.",
        type: "stringList",
        default: ["https://*/*", "http://*/*"],
    },
});

const interceptorSite = tweak.siteStore<SiteState>({ rules: [], pauses: {} });
installApiInterceptor({
    pages: cfg.pages,
    shortcut: cfg.shortcut,
    plugins: [
        atlasEntitiesPlugin(),
        atlasCcsPlugin(),
        atlasAnalyticsPlugin(),
    ],
}, interceptorSite);
