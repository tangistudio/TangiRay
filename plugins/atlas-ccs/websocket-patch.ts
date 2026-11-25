import { tweak } from "tangitweak";
import type { SitePluginApi } from "../../plugin";
import { BODY_CHUNK } from "../../site/journal";
import { newId } from "../../shared/util/id";
import type { CcsSummary } from "./types";
import { ccsFrames, decompress, describeCommand, describeReply, documentText, parseMessage, type WireMessage, WireStream } from "./wire";

// -------------------------------------------------------------------------------------------------
// WEBSOCKET PATCH
// Data Explorer's MongoDB traffic goes through one WebSocket to the Cluster Connection Service
// (`…/ccs/…`, see ./wire.ts). Sockets to it are watched from their creation (the constructor is
// wrapped; a `message` listener and `send` observe, never change, the traffic); while the tab
// records CCS (the plugin is switched on), each command and its reply becomes one log entry of the
// plugin's (method "CCS", `detail`: its CcsSummary), and its command and reply messages are kept in the page's memory (CcsRecords,
// bounded) for the details panel, which decodes them only when shown. Reassembly buffers are
// transient, bounded, dropped on close.
// -------------------------------------------------------------------------------------------------

const isCcsUrl = (url: string) => { try { return /^wss?:$/.test(new URL(url).protocol) && /\/ccs(\/|$)/.test(new URL(url).pathname); } catch { return false; } };
/** requests waiting for a reply, per socket: past this the oldest are forgotten */
const MAX_PENDING = 500;

interface Pending { logId: string; startedAt: number; ccs: CcsSummary; command?: Uint8Array }

/** raw messages kept for the details panel, all together; the oldest exchanges go first */
const RECORDS_BUDGET = 50 * 1024 * 1024;
const MAX_RECORDS = 2000;
type DocKind = "command" | "reply";

/** Each exchange's command and reply messages, by log id: raw until shown, then their text. */
export class CcsRecords {
    private records = new Map<string, Partial<Record<DocKind, Uint8Array | string>>>();
    private size = 0;

    set(logId: string, kind: DocKind, bytes: Uint8Array | undefined) {
        if (!bytes) return;
        const record = this.records.get(logId) ?? {};
        this.records.set(logId, record);
        record[kind] = bytes;
        this.size += bytes.length;
        while (this.records.size > 1 && (this.records.size > MAX_RECORDS || this.size > RECORDS_BUDGET)) {
            const [oldest, r] = this.records.entries().next().value!;
            this.records.delete(oldest);
            for (const v of Object.values(r) as (Uint8Array | string)[]) this.size -= v.length;
        }
    }

    /** Up to BODY_CHUNK characters of a document's Extended JSON from `offset`, and its full length; undefined: not recorded. */
    text(logId: string, kind: DocKind, offset: number): { text: string; size: number } | undefined {
        const record = this.records.get(logId);
        let value = record?.[kind];
        if (!record || value === undefined) return undefined;
        if (typeof value !== "string") {
            const bytes = value;
            try { value = documentText(bytes); } catch (e) { value = `(couldn't decode: ${String(e)})`; }
            this.size += value.length - bytes.length;
            record[kind] = value;
        }
        return { text: value.slice(offset, offset + BODY_CHUNK), size: value.length };
    }
}

/** Logs and pairs one CCS socket's commands and replies. */
class CcsSocket {
    /** by `<direction> <connection>` */
    private streams = new Map<string, WireStream>();
    /** by `<connection> <requestId>` */
    private pending = new Map<string, Pending>();
    /** connections that said hello */
    private handshaken = new Set<string>();

    constructor(private api: SitePluginApi, private source: string, private records: CcsRecords) {}

    frames(direction: "send" | "recv", bytes: Uint8Array) {
        for (const { route, payload } of ccsFrames(bytes)) {
            const send = direction === "send";
            const connection = send ? `${route.sa}:${route.sp}>${route.da}:${route.dp}` : `${route.da}:${route.dp}>${route.sa}:${route.sp}`;
            const server = send ? `${route.da}:${route.dp}` : `${route.sa}:${route.sp}`;
            if (route.v === -1) { this.dropConnection(connection, "connection error"); continue; }
            const key = `${direction} ${connection}`;
            let stream = this.streams.get(key);
            if (!stream) this.streams.set(key, stream = new WireStream());
            for (const message of stream.feed(payload)) {
                // sizes are what went over the wire; the rest reads the decompressed message
                const size = typeof message === "number" ? message : message.length;
                const plain = typeof message === "number" ? undefined : tryDecompress(message);
                const parsed = plain && tryParse(plain.bytes);
                if (send) this.request(connection, server, parsed, size, plain?.bytes, plain?.compressor);
                else this.reply(connection, parsed, size, plain?.bytes, plain?.compressor);
            }
        }
    }

    private request(connection: string, server: string, m: WireMessage | undefined, size: number, bytes: Uint8Array | undefined, compressor?: string) {
        const requestId = m?.requestId ?? (bytes ? new DataView(bytes.buffer, bytes.byteOffset).getInt32(4, true) : undefined);
        const ccs = describeCommand(m, server, size, this.handshaken.has(connection));
        if (compressor) ccs.compressor = compressor;
        if (ccs.background === "handshake") this.handshaken.add(connection);
        this.api.checkNavigation?.();
        const entry = { id: newId(), method: "CCS", url: ccsUrl(ccs), headers: {}, startedAt: Date.now(), ruleIds: [], source: this.source, detail: ccs };
        this.api.emit({ kind: "request", request: entry });
        this.records.set(entry.id, "command", bytes);
        if (m?.moreToCome) { this.api.emit({ kind: "update", id: entry.id, patch: { outcome: "no reply expected" } }); return; }
        if (requestId === undefined) return;
        this.pending.set(`${connection} ${requestId}`, { logId: entry.id, startedAt: entry.startedAt, ccs, command: bytes });
        if (this.pending.size > MAX_PENDING) this.pending.delete(this.pending.keys().next().value!);
    }

    private reply(connection: string, m: WireMessage | undefined, size: number, bytes: Uint8Array | undefined, compressor?: string) {
        const view = bytes && new DataView(bytes.buffer, bytes.byteOffset);
        const responseTo = m?.responseTo ?? view?.getInt32(8, true);
        const key = `${connection} ${responseTo}`;
        const pending = this.pending.get(key);
        if (!pending) return;
        this.pending.delete(key);
        const now = Date.now();
        const ccs: CcsSummary = { ...pending.ccs, ...describeReply(m, size), ...(compressor && { replyCompressor: compressor }) };
        if (pending.ccs.streamed) {
            // a streamed reply has no request of its own: its row runs from the previous reply
            this.api.checkNavigation?.();
            this.api.emit({ kind: "request", request: { id: pending.logId, method: "CCS", url: ccsUrl(ccs), headers: {}, startedAt: pending.startedAt, ruleIds: [], source: this.source, detail: ccs } });
            this.records.set(pending.logId, "command", pending.command);
        }
        this.records.set(pending.logId, "reply", bytes);
        this.api.emit({ kind: "update", id: pending.logId, patch: { detail: ccs, durationMs: now - pending.startedAt } });
        const requestId = m?.requestId ?? view?.getInt32(4, true);
        if (m?.moreToCome && requestId !== undefined) {
            this.pending.set(`${connection} ${requestId}`, { logId: newId(), startedAt: now, ccs: { ...pending.ccs, streamed: true }, command: pending.command });
        }
    }

    private dropConnection(connection: string, outcome: string) {
        for (const direction of ["send", "recv"]) this.streams.delete(`${direction} ${connection}`);
        this.handshaken.delete(connection);
        for (const [key, p] of this.pending) {
            if (!key.startsWith(`${connection} `)) continue;
            this.pending.delete(key);
            if (!p.ccs.streamed) this.api.emit({ kind: "update", id: p.logId, patch: { outcome } });
        }
    }

    close(outcome: string) {
        for (const p of this.pending.values()) if (!p.ccs.streamed) this.api.emit({ kind: "update", id: p.logId, patch: { outcome } });
        this.pending.clear();
        this.streams.clear();
        this.handshaken.clear();
    }
}

function tryDecompress(bytes: Uint8Array): { bytes: Uint8Array; compressor?: string } {
    try { return decompress(bytes); } catch { return { bytes }; }
}

function tryParse(bytes: Uint8Array): WireMessage | undefined {
    try { return parseMessage(bytes); } catch { return undefined; }
}

/** A URL for the exchange, so rules (hide, fold, favourite) and the filter box work on it: `mongodb://<server>/<db>/<collection>?command=<name>`. */
export function ccsUrl(c: Pick<CcsSummary, "server" | "db" | "collection" | "command">) {
    const path = [c.db, c.collection].filter((x) => x !== undefined).map((x) => encodeURIComponent(x!)).join("/");
    return `mongodb://${c.server}/${path}?command=${encodeURIComponent(c.command)}`;
}

function bytesOf(data: unknown): Uint8Array | undefined {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return undefined;
}

/** Watches the page's CCS WebSockets (see above), logging as the plugin `source`; returns the recorded messages. */
export function patchWebSockets(ctx: TangiTweak.SiteCtx, api: SitePluginApi, source: string): CcsRecords {
    const records = ctx.once("api-interceptor-ccs-records", () => new CcsRecords());
    // kept across script saves: the sockets, and the run's function their listeners call
    const sockets = ctx.once("api-interceptor-ccs-sockets", () => new WeakSet<WebSocket>());
    const hooks = ctx.once("api-interceptor-ccs-hooks", () => ({ observe: (_ws: WebSocket, _direction: "send" | "recv", _data: unknown) => {}, close: (_ws: WebSocket) => {} }));
    // open sockets only: each leaves on close
    const trackers = new Map<WebSocket, CcsSocket>();
    let warned = false;

    hooks.observe = (ws, direction, data) => {
        if (!api.isOn()) {
            // switched off: forget everything; switched on again, streams pick up at the next message start
            for (const tracker of trackers.values()) tracker.close("recording stopped");
            trackers.clear();
            return;
        }
        const bytes = bytesOf(data);
        if (!bytes) {
            if (!warned) tweak.log("[tangiray] a CCS WebSocket message that isn't an ArrayBuffer: not decoded");
            warned = true;
            return;
        }
        let tracker = trackers.get(ws);
        if (!tracker) trackers.set(ws, tracker = new CcsSocket(api, source, records));
        try { tracker.frames(direction, bytes); } catch (e) { tweak.log("[tangiray] couldn't decode a CCS WebSocket message", String(e)); }
    };
    hooks.close = (ws) => { trackers.get(ws)?.close("socket closed"); trackers.delete(ws); };

    ctx.patch(window, "WebSocket", (Native) => new Proxy(Native, {
        construct(target, args, newTarget) {
            const ws: WebSocket = Reflect.construct(target, args, newTarget);
            if (isCcsUrl(ws.url)) {
                sockets.add(ws);
                // added first: sees each message before the page does
                ws.addEventListener("message", (e) => hooks.observe(ws, "recv", e.data));
                ws.addEventListener("close", () => hooks.close(ws));
            }
            return ws;
        },
    }));
    ctx.patch(WebSocket.prototype, "send", (orig) => function (this: WebSocket, data: Parameters<WebSocket["send"]>[0]) {
        if (sockets.has(this) && this.readyState === WebSocket.OPEN) hooks.observe(this, "send", data);
        return orig.call(this, data);
    });
    return records;
}
