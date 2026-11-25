import type { LoggedRequest, TransactionSource } from "../domain/types";
import type { TransactionSummary } from "../site/journal";

// -------------------------------------------------------------------------------------------------
// HAR EXPORT
// Logged requests as a HAR 1.2 file, with headers and bodies from the page's record (../site/journal.ts)
// when it has them, else what the network log has.
// -------------------------------------------------------------------------------------------------

type NameValue = { name: string; value: string };

const pairs = (o: Record<string, string> | undefined): NameValue[] => Object.entries(o ?? {}).map(([name, value]) => ({ name, value }));
const header = (o: Record<string, string> | undefined, name: string) =>
    Object.entries(o ?? {}).find(([k]) => k.toLowerCase() === name)?.[1];

async function fullBody(transactions: TransactionSource, txn: TransactionSummary, kind: "request" | "response", size: number | undefined) {
    let text = "";
    while (size && text.length < size) {
        const chunk = await transactions.body(txn, kind, text.length);
        if (!chunk) break;
        text += chunk;
    }
    return text;
}

async function harEntry(e: LoggedRequest, transactions: TransactionSource) {
    const txn = await transactions.find(e).catch(() => undefined);
    const [requestBody, responseBody] = txn
        ? await Promise.all([fullBody(transactions, txn, "request", txn.requestBodySize), fullBody(transactions, txn, "response", txn.responseBodySize)])
        : [e.body ?? "", ""];
    const url = txn?.url ?? e.finalUrl ?? e.url;
    const requestHeaders = txn?.requestHeaders ?? e.headers;
    const time = txn?.endedAt ? txn.endedAt - txn.startedAt : e.durationMs ?? 0;
    const comment = [e.outcome, e.finalUrl && `rewritten from ${e.url}`, txn?.error].filter(Boolean).join(" · ");
    return {
        startedDateTime: new Date(txn?.startedAt ?? e.startedAt).toISOString(),
        time,
        request: {
            method: e.method,
            url,
            httpVersion: "HTTP/1.1",
            cookies: [],
            headers: pairs(requestHeaders),
            queryString: [...new URL(url).searchParams].map(([name, value]) => ({ name, value })),
            ...(requestBody ? { postData: { mimeType: header(requestHeaders, "content-type") ?? "", text: requestBody } } : {}),
            headersSize: -1,
            bodySize: requestBody.length,
        },
        response: {
            status: txn?.status ?? e.status ?? 0,
            statusText: txn?.statusText ?? "",
            httpVersion: "HTTP/1.1",
            cookies: [],
            headers: pairs(txn?.responseHeaders),
            content: { size: responseBody.length, mimeType: e.mime ?? header(txn?.responseHeaders, "content-type") ?? "", text: responseBody },
            redirectURL: "",
            headersSize: -1,
            bodySize: -1,
        },
        cache: {},
        timings: { send: 0, wait: time, receive: 0 },
        ...(comment ? { comment } : {}),
    };
}

/** Builds a HAR of `entries` (oldest first): its file name and JSON. */
export async function buildHar(entries: readonly LoggedRequest[], transactions: TransactionSource) {
    const harEntries = [];
    // one at a time: each reads its bodies from the page in chunks
    for (const e of entries) harEntries.push(await harEntry(e, transactions));
    const har = { log: { version: "1.2", creator: { name: "TangiRay", version: "1.0" }, pages: [], entries: harEntries } };
    const host = entries[0] ? new URL(entries[0].url).host : "requests";
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    return { filename: `${host}-${stamp}.har`, text: JSON.stringify(har, null, 2) };
}
