import type { LoggedRequest } from "../../domain/types";
import type { CcsSummary } from "./types";

// How CCS exchanges (MongoDB commands through Data Explorer's WebSocket, see ./websocket-patch.ts) read in the palette.

export const ccsOf = (e: Pick<LoggedRequest, "detail">) => e.detail as CcsSummary;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The command and its namespace, e.g. "find demo.orders". */
export function ccsTitle(c: CcsSummary) {
    const ns = c.db === undefined ? "" : c.collection === undefined ? c.db : `${c.db}.${c.collection}`;
    return ns ? `${c.command} ${ns}` : c.command;
}

/** What the reply said, e.g. "20 documents in first batch". */
export function ccsResult(c: CcsSummary) {
    const parts: string[] = [];
    if (c.ok === false) parts.push(["error", c.code, c.codeName].filter((x) => x !== undefined).join(" "));
    if (c.batch !== undefined) parts.push(c.batchKind ? `${plural(c.batch, "document")} in ${c.batchKind} batch` : `${c.batch} listed`);
    const command = c.command.toLowerCase();
    if (c.modified !== undefined) parts.push(`${c.n ?? 0} matched, ${c.modified} modified`);
    else if (c.n !== undefined) parts.push(command === "insert" ? `${c.n} inserted` : command === "delete" ? `${c.n} deleted` : `n ${c.n}`);
    if (c.writeErrors) parts.push(plural(c.writeErrors, "write error"));
    if (c.compressed) parts.push(`${c.replyCompressor ?? c.compressor ?? "compressed"}: not decoded`);
    if (c.streamed) parts.push("streamed");
    return parts.join(" · ");
}

/** The status column: OK, the error code, … while waiting. */
export function ccsStatus(e: Pick<LoggedRequest, "detail" | "outcome">): { text: string; className: string } {
    const c = ccsOf(e);
    if (c.ok === true) return { text: "OK", className: "s2" };
    if (c.ok === false) return { text: c.code !== undefined ? String(c.code) : "ERR", className: "s5" };
    if (c.replyBytes !== undefined) return { text: "—", className: "" };
    return { text: e.outcome ? "—" : "…", className: e.outcome && e.outcome !== "no reply expected" ? "s5" : "" };
}
