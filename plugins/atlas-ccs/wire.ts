import { BSON, EJSON } from "bson";
import { unzlibSync } from "fflate";
import type { CcsSummary } from "./types";

// -------------------------------------------------------------------------------------------------
// CCS WIRE FORMAT
// Data Explorer talks to clusters through one WebSocket (`…/ccs/…`, the Cluster Connection Service).
// Each WebSocket message is `[BSON routing header][sz bytes]`: the header ({v, sz, sa, sp, da, dp,
// er?}) names one logical connection (source address/port → cluster host/port; a reply reverses
// them), the bytes are a piece of that connection's MongoDB wire stream. A wire message can span
// several pieces: reassemble per connection and direction by its length (see WireStream).
// A row needs only the summary (command, namespace, status, counts); whole documents are decoded
// only for the details panel (documentText).
// https://www.mongodb.com/docs/manual/reference/mongodb-wire-protocol/
// -------------------------------------------------------------------------------------------------

export const OP_REPLY = 1;
export const OP_QUERY = 2004;
export const OP_COMPRESSED = 2012;
export const OP_MSG = 2013;
const OP_CODES = [OP_REPLY, OP_QUERY, OP_COMPRESSED, OP_MSG];
/** MongoDB's maxMessageSizeBytes */
export const MAX_MESSAGE = 48_000_000;
/** bigger messages are measured, not read: a batch this big isn't counted */
export const MAX_DECODED = 17 * 1024 * 1024;
const MAX_HEADER = 2048;
const MSG_CHECKSUM = 1;
const MSG_MORE_TO_COME = 2;

// BSON: the official library (pinned). Documents are only walked (onDemand: the element offsets the
// Node driver's lazy documents use), never materialised; the small routing headers are deserialised.

const { onDemand: { parseToElements, ByteUtils, NumberUtils } } = BSON;

export interface Doc { bytes: Uint8Array; at: number; size: number; first?: string; fields: Map<string, { type: number; at: number }> }

/** A document's top-level fields (type and value offset), by name. */
export function readDoc(bytes: Uint8Array, at = 0): Doc {
    const doc: Doc = { bytes, at, size: NumberUtils.getInt32LE(bytes, at), fields: new Map() };
    for (const [type, nameOffset, nameLength, offset] of parseToElements(bytes, at)) {
        const name = ByteUtils.toUTF8(bytes, nameOffset, nameOffset + nameLength, false);
        doc.fields.set(name, { type, at: offset });
        doc.first ??= name;
    }
    return doc;
}

export function str(d: Doc, name: string): string | undefined {
    const f = d.fields.get(name);
    if (f?.type !== 0x02) return undefined;
    return ByteUtils.toUTF8(d.bytes, f.at + 4, f.at + 3 + NumberUtils.getInt32LE(d.bytes, f.at), false);
}

export function num(d: Doc, name: string): number | undefined {
    const f = d.fields.get(name);
    switch (f?.type) {
        case 0x01: return NumberUtils.getFloat64LE(d.bytes, f.at);
        case 0x10: return NumberUtils.getInt32LE(d.bytes, f.at);
        case 0x12: return Number(NumberUtils.getBigInt64LE(d.bytes, f.at));
        case 0x08: return d.bytes[f.at];
        default: return undefined;
    }
}

export function sub(d: Doc, name: string): Doc | undefined {
    const f = d.fields.get(name);
    return f?.type === 0x03 || f?.type === 0x04 ? readDoc(d.bytes, f.at) : undefined;
}

/** An array field's length, counted without reading its elements. */
const count = (d: Doc, name: string) => {
    const f = d.fields.get(name);
    if (f?.type !== 0x04) return undefined;
    let n = 0;
    for (const _ of parseToElements(d.bytes, f.at)) n++;
    return n;
};

// CCS ROUTING HEADERS

export interface Route { v: number; sz: number; sa: string; sp: number; da: string; dp: number }

/** The `[header][payload]` pieces of one WebSocket message. */
export function* ccsFrames(bytes: Uint8Array): Generator<{ route: Route; payload: Uint8Array }> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = 0;
    while (p + 5 <= bytes.length) {
        const size = view.getInt32(p, true);
        if (size < 5 || size > MAX_HEADER || p + size > bytes.length) return;
        const h = BSON.deserialize(bytes.subarray(p, p + size), { promoteLongs: true });
        const route: Route = { v: Number(h.v), sz: Number(h.sz), sa: String(h.sa ?? ""), sp: Number(h.sp), da: String(h.da ?? ""), dp: Number(h.dp) };
        const start = p + size;
        const end = Math.min(bytes.length, start + Math.max(0, route.sz));
        yield { route, payload: bytes.subarray(start, end) };
        p = end;
    }
}

// WIRE MESSAGES

/** OP_COMPRESSED compressor ids */
const COMPRESSORS = ["noop", "snappy", "zlib", "zstd"];

/**
 * An OP_COMPRESSED message as the message it wraps, and its compressor's name. Atlas only turns on
 * zlib (`compressors=zlib`), which is inflated here (noop too); snappy and zstd stay compressed.
 */
export function decompress(bytes: Uint8Array): { bytes: Uint8Array; compressor?: string } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 25 || view.getInt32(12, true) !== OP_COMPRESSED) return { bytes };
    const originalOpCode = view.getInt32(16, true);
    const size = view.getInt32(20, true);
    const id = bytes[24];
    const compressor = COMPRESSORS[id] ?? `compressor ${id}`;
    if ((id !== 0 && id !== 2) || size < 0 || 16 + size > MAX_DECODED) return { bytes, compressor };
    const out = new Uint8Array(16 + size);
    if (id === 0) out.set(bytes.subarray(25, 25 + size), 16);
    else unzlibSync(bytes.subarray(25), { out: out.subarray(16) });
    out.set(bytes.subarray(4, 12), 4);
    const header = new DataView(out.buffer);
    header.setInt32(0, out.length, true);
    header.setInt32(12, originalOpCode, true);
    return { bytes: out, compressor };
}

/**
 * One direction of one logical connection, as its pieces arrive: complete wire messages come out.
 * Starting mid-stream (capture turned on late), pieces are skipped until one starts like a message.
 */
export class WireStream {
    private head: Uint8Array | undefined;
    private size = 0;
    private got = 0;
    private parts: Uint8Array[] | undefined;

    /** The messages `chunk` completes: their bytes, or just their size when too big to read. */
    feed(chunk: Uint8Array): (Uint8Array | number)[] {
        const out: (Uint8Array | number)[] = [];
        let p = 0;
        while (p < chunk.length) {
            if (!this.size) {
                const need = 16 - (this.head?.length ?? 0);
                const piece = chunk.subarray(p, p + need);
                this.head = this.head ? concat([this.head, piece]) : piece.slice();
                p += piece.length;
                if (this.head.length < 16) break;
                const view = new DataView(this.head.buffer, this.head.byteOffset, 16);
                const size = view.getInt32(0, true);
                if (size < 16 || size > MAX_MESSAGE || !OP_CODES.includes(view.getInt32(12, true))) {
                    // not a message start: out of step; wait for a piece that starts one
                    this.head = undefined;
                    break;
                }
                this.size = size;
                this.got = 16;
                this.parts = size <= MAX_DECODED ? [this.head] : undefined;
                this.head = undefined;
            }
            const take = Math.min(this.size - this.got, chunk.length - p);
            this.parts?.push(chunk.slice(p, p + take));
            this.got += take;
            p += take;
            if (this.got === this.size) {
                out.push(this.parts ? concat(this.parts) : this.size);
                this.size = this.got = 0;
                this.parts = undefined;
            }
        }
        return out;
    }
}

function concat(parts: Uint8Array[]) {
    if (parts.length === 1) return parts[0];
    const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let at = 0;
    for (const x of parts) { out.set(x, at); at += x.length; }
    return out;
}

export interface WireMessage {
    size: number;
    requestId: number;
    responseTo: number;
    opCode: number;
    /** OP_MSG: the sender won't wait for a reply (requests), or more replies follow (replies) */
    moreToCome?: boolean;
    /** the command or reply document */
    body?: Doc;
    /** OP_QUERY's namespace's database */
    db?: string;
    /** documents in OP_MSG document sequences (e.g. an insert's) */
    sequenced?: number;
    /** OP_MSG document sequences: their identifier (e.g. "documents") and their documents' offsets */
    sequences?: { id: string; at: number[] }[];
}

/** A wire message's header and, when it can be read, its main document. */
export function parseMessage(bytes: Uint8Array): WireMessage {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const m: WireMessage = { size: view.getInt32(0, true), requestId: view.getInt32(4, true), responseTo: view.getInt32(8, true), opCode: view.getInt32(12, true) };
    if (m.opCode === OP_MSG) {
        const flags = view.getUint32(16, true);
        m.moreToCome = !!(flags & MSG_MORE_TO_COME);
        const end = bytes.length - (flags & MSG_CHECKSUM ? 4 : 0);
        let p = 20;
        while (p < end) {
            const kind = bytes[p++];
            if (kind === 0) {
                m.body = readDoc(bytes, p);
                p += m.body.size;
            } else if (kind === 1) {
                const size = view.getInt32(p, true);
                const idEnd = bytes.indexOf(0, p + 4);
                const sequence = { id: ByteUtils.toUTF8(bytes, p + 4, idEnd, false), at: [] as number[] };
                (m.sequences ??= []).push(sequence);
                let q = idEnd + 1;
                while (q < p + size) { sequence.at.push(q); q += view.getInt32(q, true); m.sequenced = (m.sequenced ?? 0) + 1; }
                p += size;
            } else break;
        }
    } else if (m.opCode === OP_QUERY) {
        const nsEnd = bytes.indexOf(0, 20);
        const ns = ByteUtils.toUTF8(bytes, 20, nsEnd, false);
        m.db = ns.slice(0, ns.indexOf(".") >>> 0);
        const query = readDoc(bytes, nsEnd + 9);
        m.body = query.first === "$query" || query.first === "query" ? sub(query, query.first) ?? query : query;
    } else if (m.opCode === OP_REPLY && bytes.length > 36) {
        m.body = readDoc(bytes, 36);
    }
    return m;
}

// SUMMARIES

const HANDSHAKE = new Set(["hello", "ismaster"]);
const AUTH = new Set(["saslstart", "saslcontinue", "authenticate", "getnonce", "logout"]);
/** commands whose first field's value isn't a collection */
const NO_COLLECTION = new Set(["getmore"]);
/** the statements a write command carries, by command */
const ITEMS: Record<string, string> = { insert: "documents", update: "updates", delete: "deletes" };

/**
 * What a request is, for its log row. `handshaken`: the connection already said hello, so another
 * hello is a heartbeat (monitoring), not a handshake.
 */
export function describeCommand(m: WireMessage | undefined, server: string, size: number, handshaken: boolean): CcsSummary {
    const base: CcsSummary = { command: "(unknown)", server, requestBytes: size };
    if (!m) return { ...base, command: "(too large to read)" };
    if (m.opCode === OP_COMPRESSED) return { ...base, command: "(compressed)", compressed: true };
    const body = m.body;
    if (!body?.first) return base;
    const command = body.first;
    const lower = command.toLowerCase();
    const db = str(body, "$db") ?? m.db;
    const collection = NO_COLLECTION.has(lower) ? str(body, "collection") : str(body, command);
    const itemsField = ITEMS[lower];
    const items = itemsField ? (count(body, itemsField) ?? m.sequenced) : undefined;
    const background = HANDSHAKE.has(lower) ? (handshaken ? "heartbeat" : "handshake") : lower === "ping" ? "heartbeat" : AUTH.has(lower) ? "auth" : undefined;
    return {
        ...base, command,
        ...(db !== undefined && { db }),
        ...(collection !== undefined && { collection }),
        ...(items !== undefined && { items }),
        ...(background && { background }),
    };
}

/** What a reply says, for its request's log row. */
export function describeReply(m: WireMessage | undefined, size: number): Partial<CcsSummary> {
    const reply: Partial<CcsSummary> = { replyBytes: size };
    if (!m) return reply;
    if (m.opCode === OP_COMPRESSED) return { ...reply, compressed: true };
    const body = m.body;
    if (!body) return reply;
    const ok = num(body, "ok");
    if (ok !== undefined) reply.ok = ok === 1;
    if (ok !== undefined && ok !== 1) {
        const code = num(body, "code");
        const codeName = str(body, "codeName");
        if (code !== undefined) reply.code = code;
        if (codeName !== undefined) reply.codeName = codeName;
    }
    const cursor = sub(body, "cursor");
    if (cursor) {
        const first = count(cursor, "firstBatch");
        const next = first === undefined ? count(cursor, "nextBatch") : undefined;
        if (first !== undefined) Object.assign(reply, { batch: first, batchKind: "first" });
        else if (next !== undefined) Object.assign(reply, { batch: next, batchKind: "next" });
    } else {
        const listed = count(body, "values") ?? count(body, "databases");
        if (listed !== undefined) reply.batch = listed;
    }
    const n = num(body, "n");
    const modified = num(body, "nModified");
    const writeErrors = count(body, "writeErrors");
    if (n !== undefined) reply.n = n;
    if (modified !== undefined) reply.modified = modified;
    if (writeErrors) reply.writeErrors = writeErrors;
    return reply;
}

// DOCUMENTS
// The whole command or reply, for the details panel: decoded only when someone looks at it.

const deserialize = (bytes: Uint8Array, at: number) => BSON.deserialize(bytes.subarray(at, at + NumberUtils.getInt32LE(bytes, at)));

/** A wire message's document (with its document sequences as arrays, like the driver builds them) as relaxed Extended JSON. */
export function documentText(bytes: Uint8Array): string {
    const m = parseMessage(bytes);
    if (m.opCode === OP_COMPRESSED) return `(compressed with ${COMPRESSORS[bytes[24]] ?? `compressor ${bytes[24]}`}: only zlib is decoded)`;
    if (!m.body) return "(no document)";
    const doc: Record<string, unknown> = deserialize(m.body.bytes, m.body.at);
    for (const s of m.sequences ?? []) doc[s.id] = s.at.map((at) => deserialize(bytes, at));
    return EJSON.stringify(doc, undefined, 2, { relaxed: true });
}
