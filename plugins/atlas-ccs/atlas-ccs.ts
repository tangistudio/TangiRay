import { useSnapshot } from "valtio";
import type { InterceptorPlugin, PluginMenuItem } from "../../plugin";
import { CcsDetails } from "./CcsDetails";
import { ccsOf, ccsResult, ccsStatus, ccsTitle } from "./format";
import { ccsPrefs } from "./state";
import { patchWebSockets } from "./websocket-patch";

// -------------------------------------------------------------------------------------------------
// ATLAS DATA EXPLORER COMMANDS (CCS) PLUGIN
// Data Explorer's MongoDB commands, sent as wire-protocol messages through its WebSocket to the
// Cluster Connection Service, listed as `CCS` rows (./websocket-patch, ./wire), with the command and
// reply documents in their details (./CcsDetails). Plugged in by the entry script (../../index.ts);
// switched on and off in ⋯ → Plugins (from the next message), where its own switch is too.
// -------------------------------------------------------------------------------------------------

/** Atlas' pages: the environments and local MMS. */
const ATLAS_PAGES = ["http://localhost:8080/*", "https://cloud-dev.mongodb.com/*", "https://cloud.mongodb.com/*", "https://cloud-qa.mongodb.com/*"];

const ID = "atlas-ccs";

export function atlasCcsPlugin(): InterceptorPlugin {
    return {
        id: ID,
        name: "Atlas: Data Explorer commands (CCS)",
        pages: ATLAS_PAGES,
        site: (ctx, api) => {
            const ccs = patchWebSockets(ctx, api, ID);
            return {
                rpc: {
                    document: (logId: string, kind: "command" | "reply", offset: number) => ccs.text(logId, kind, offset),
                },
            };
        },
        entries: {
            summary: (e) => {
                const c = ccsOf(e);
                return {
                    title: ccsTitle(c),
                    sub: [c.background, c.server, ccsResult(c), e.outcome].filter(Boolean).join(" · "),
                    status: ccsStatus(e),
                    search: [ccsTitle(c), ccsResult(c), c.background ?? ""],
                };
            },
            useShown: () => {
                const showBackground = useSnapshot(ccsPrefs).showBackground === true;
                return (e) => showBackground || !ccsOf(e).background;
            },
            Details: CcsDetails,
        },
        useMenuItems: (): PluginMenuItem[] => {
            const showBackground = useSnapshot(ccsPrefs).showBackground === true;
            return [
                { icon: "◈", label: "CCS handshakes, auth and heartbeats", checked: showBackground, title: "Also list the driver's own CCS traffic: connection handshakes, authentication and monitoring",
                    onSelect: () => { ccsPrefs.showBackground = !showBackground; } },
            ];
        },
    };
}
