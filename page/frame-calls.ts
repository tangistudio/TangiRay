import { tweak } from "tangitweak";
import { subscribe } from "valtio";
import { newId } from "../shared/util/id";
import type { TransactionSummary } from "../site/journal";

// -------------------------------------------------------------------------------------------------
// FRAME CALLS
// A handle call only reaches the caller's own frame, so the palette (top frame) can't read the
// journal an iframe's site patch keeps. Each iframe answers those reads here instead, through a
// page store (shared by all the page's frames): the palette posts a call, the iframe writes back.
// -------------------------------------------------------------------------------------------------

/** What an iframe answers: its site patch's journal reads. */
export interface FrameJournal {
    transaction: (method: string, urls: string[], startedAt: number, logId?: string) => Promise<TransactionSummary | undefined>;
    transactionBody: (id: number, kind: "request" | "response", offset: number) => Promise<string>;
}
type FrameFn = keyof FrameJournal;

interface FrameCall {
    frame: string;
    fn: FrameFn;
    args: unknown[];
    done?: boolean;
    result?: unknown;
    error?: string;
}

/** the store holds at most 1 MB, and JSON escaping can double a body: bodies cross in smaller chunks */
const FRAME_BODY_CHUNK = 150 * 1024;
/** a frame that went away without saying so (removed, navigated) never answers */
const FRAME_CALL_TIMEOUT = 5000;

/** `frames`: the live iframes, by key (the value tells apart their runs); `calls`: the pending calls, by id */
const channel = tweak.pageStore<{ frames: Record<string, string>; calls: Record<string, FrameCall> }>({ frames: {}, calls: {} });

/** `tweak.onPage` body part, in an iframe: answers the palette's reads of this frame's journal, under `frame`. */
export function serveFrameCalls(ctx: TangiTweak.RunCtx, frame: string, journal: FrameJournal) {
    const run = newId();
    channel.frames[frame] = run;
    const handled = new Set<string>();
    const answer = () => {
        for (const [id, call] of Object.entries(channel.calls)) {
            if (call.frame !== frame || call.done || handled.has(id)) continue;
            handled.add(id);
            const fn = journal[call.fn] as (...args: unknown[]) => Promise<unknown>;
            fn(...call.args).then(
                (result) => respond(id, { result: call.fn === "transactionBody" ? (result as string).slice(0, FRAME_BODY_CHUNK) : result }),
                (e) => respond(id, { error: String(e) }),
            );
        }
    };
    const respond = (id: string, outcome: Pick<FrameCall, "result" | "error">) => {
        handled.delete(id);
        const call = channel.calls[id];
        if (call) Object.assign(call, outcome, { done: true });
    };
    // a save's new run registers before the old one ends: only the latest run unregisters
    const unregister = () => { if (channel.frames[frame] === run) delete channel.frames[frame]; };
    answer();
    ctx.signal.addEventListener("abort", subscribe(channel.calls, answer));
    ctx.signal.addEventListener("abort", unregister);
    window.addEventListener("pagehide", unregister, { signal: ctx.signal });
}

/** Calls `fn` on the journal of the iframe `frame`; undefined if that frame is gone. */
export function callFrame<K extends FrameFn>(frame: string, fn: K, ...args: Parameters<FrameJournal[K]>): Promise<Awaited<ReturnType<FrameJournal[K]>> | undefined> {
    if (!channel.frames[frame]) return Promise.resolve(undefined);
    const id = newId();
    channel.calls[id] = { frame, fn, args };
    return new Promise((resolve, reject) => {
        const finish = () => {
            clearTimeout(timer);
            stop();
            delete channel.calls[id];
        };
        const check = () => {
            const call = channel.calls[id];
            if (!call?.done) return;
            finish();
            if (call.error !== undefined) reject(new Error(call.error));
            else resolve(call.result as Awaited<ReturnType<FrameJournal[K]>> | undefined);
        };
        const stop = subscribe(channel, check);
        const timer = setTimeout(() => { finish(); resolve(undefined); }, FRAME_CALL_TIMEOUT);
    });
}
