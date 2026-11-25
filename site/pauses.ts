import { subscribe } from "valtio";
import type { Pause } from "../domain/types";

// -------------------------------------------------------------------------------------------------
// PAUSES
// A paused request or response waits in the site store until the overlay decides on it.
// -------------------------------------------------------------------------------------------------

export const MAX_PAUSED_BODY = 256 * 1024;
export const PAUSE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Waits until the overlay decides on `pauses[id]` (or it's removed, or it times out → undefined),
 * then removes the pause. `pauses` must be the nested store object, kept from the handler's
 * synchronous part.
 */
export function waitForDecision<D>(pauses: Record<string, Pause>, id: string): Promise<D | undefined> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (decision: D | undefined) => {
            if (settled) return;
            settled = true;
            unsubscribe();
            clearTimeout(timer);
            delete pauses[id];
            resolve(decision);
        };
        const check = () => {
            const pause = pauses[id];
            if (!pause) finish(undefined);
            else if (pause.decision) finish(pause.decision as D);
        };
        const unsubscribe = subscribe(pauses, check);
        const timer = setTimeout(() => finish(undefined), PAUSE_TIMEOUT_MS);
        check();
    });
}
