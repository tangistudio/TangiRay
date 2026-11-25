
// -------------------------------------------------------------------------------------------------
// TRANSACTION JOURNAL
// Every fetch/XHR of the page with its full request and response (headers and bodies), kept in the
// page's own memory by the site patch: Wiretrick's stores hold at most 1 MB, too little for bodies.
// The overlay reads a transaction through the `tweak.onSite` handle when it's shown, bodies in chunks
// (a handle call carries at most 1 MB).
// -------------------------------------------------------------------------------------------------

export const MAX_JOURNAL_BODY = 10 * 1024 * 1024;
/** bodies of all transactions together; the oldest go first */
export const JOURNAL_BUDGET = 50 * 1024 * 1024;
export const MAX_TRANSACTIONS = 2000;
/** body characters per handle call (JSON escaping can double them, the call limit is 1 MB) */
export const BODY_CHUNK = 400 * 1024;

export interface Transaction {
    id: number;
    logId?: string;
    method: string;
    url: string;
    startedAt: number;
    endedAt?: number;
    requestHeaders: Record<string, string>;
    requestBody?: string;
    status?: number;
    statusText?: string;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
    error?: string;
}

/** A transaction without its bodies, plus their full sizes: what the overlay gets first. */
export type TransactionSummary = Omit<Transaction, "requestBody" | "responseBody"> & {
    requestBodySize?: number;
    responseBodySize?: number;
    /** the iframe whose journal has it (set by the palette's reader, not the journal) */
    frame?: string;
};

export class Journal {
    private transactions: Transaction[] = [];
    private seq = 0;
    private bodyChars = 0;

    begin(method: string, url: string, requestHeaders: Record<string, string>): Transaction {
        const t: Transaction = { id: ++this.seq, method: method.toUpperCase(), url, startedAt: Date.now(), requestHeaders };
        this.transactions.push(t);
        this.evict();
        return t;
    }

    /** Sets a body (cut at {@link MAX_JOURNAL_BODY}), keeping the total within the budget. */
    setBody(t: Transaction, kind: "requestBody" | "responseBody", text: string | undefined) {
        if (text === undefined) return;
        this.bodyChars -= t[kind]?.length ?? 0;
        t[kind] = text.length > MAX_JOURNAL_BODY ? text.slice(0, MAX_JOURNAL_BODY) + `\n… cut at ${MAX_JOURNAL_BODY / 1024 / 1024} MB of ${text.length} characters` : text;
        this.bodyChars += t[kind]!.length;
        this.evict();
    }

    finish(t: Transaction, response: { status: number; statusText: string; headers: Record<string, string> } | { error: string }) {
        t.endedAt = Date.now();
        if ("error" in response) t.error = response.error;
        else Object.assign(t, { status: response.status, statusText: response.statusText, responseHeaders: response.headers });
    }

    /** The transaction for a logged request: by `logId` when known, else same method and URL started closest to `startedAt`. */
    find(method: string, urls: string[], startedAt: number, logId?: string): TransactionSummary | undefined {
        let best: Transaction | undefined;
        if (logId) best = this.transactions.find((t) => t.logId === logId);
        else for (const t of this.transactions)
            if (!t.logId && t.method === method.toUpperCase() && urls.includes(t.url)
                && (!best || Math.abs(t.startedAt - startedAt) < Math.abs(best.startedAt - startedAt))) best = t;
        if (!best) return undefined;
        const { requestBody, responseBody, ...summary } = best;
        return { ...summary, requestBodySize: requestBody?.length, responseBodySize: responseBody?.length };
    }

    /** Up to {@link BODY_CHUNK} characters of a body from `offset`. */
    body(id: number, kind: "request" | "response", offset: number): string {
        const t = this.transactions.find((x) => x.id === id);
        return (kind === "request" ? t?.requestBody : t?.responseBody)?.slice(offset, offset + BODY_CHUNK) ?? "";
    }

    private evict() {
        while (this.transactions.length > 1 && (this.transactions.length > MAX_TRANSACTIONS || this.bodyChars > JOURNAL_BUDGET)) {
            const oldest = this.transactions.shift()!;
            this.bodyChars -= (oldest.requestBody?.length ?? 0) + (oldest.responseBody?.length ?? 0);
        }
    }
}

/** Response headers as XHR's getAllResponseHeaders() gives them, as an object. */
export function parseHeaderLines(lines: string): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const line of lines.trim().split(/\r?\n/)) {
        const at = line.indexOf(":");
        if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
    }
    return headers;
}
