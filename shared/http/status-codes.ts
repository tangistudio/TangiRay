// -------------------------------------------------------------------------------------------------
// HTTP STATUS CODES
// The common ones, with their reason phrase and what they mean, for pickers and hints.
// -------------------------------------------------------------------------------------------------

export interface StatusCode { code: number; phrase: string; meaning: string }

export const STATUS_CODES: StatusCode[] = [
    { code: 200, phrase: "OK", meaning: "Success, with a body" },
    { code: 201, phrase: "Created", meaning: "A resource was created" },
    { code: 202, phrase: "Accepted", meaning: "Queued, not done yet" },
    { code: 204, phrase: "No Content", meaning: "Success, no body" },
    { code: 206, phrase: "Partial Content", meaning: "A range of the body" },
    { code: 301, phrase: "Moved Permanently", meaning: "Redirect, for good" },
    { code: 302, phrase: "Found", meaning: "Redirect, for now" },
    { code: 304, phrase: "Not Modified", meaning: "The cached copy is still good" },
    { code: 307, phrase: "Temporary Redirect", meaning: "Redirect, same method" },
    { code: 308, phrase: "Permanent Redirect", meaning: "Redirect for good, same method" },
    { code: 400, phrase: "Bad Request", meaning: "Malformed or invalid request" },
    { code: 401, phrase: "Unauthorized", meaning: "Not signed in / no valid credentials" },
    { code: 402, phrase: "Payment Required", meaning: "Billing blocks it" },
    { code: 403, phrase: "Forbidden", meaning: "Signed in, but not allowed" },
    { code: 404, phrase: "Not Found", meaning: "No such resource" },
    { code: 405, phrase: "Method Not Allowed", meaning: "Wrong HTTP method for this URL" },
    { code: 406, phrase: "Not Acceptable", meaning: "Can't answer in an accepted format" },
    { code: 408, phrase: "Request Timeout", meaning: "The server gave up waiting for the request" },
    { code: 409, phrase: "Conflict", meaning: "Clashes with the current state (e.g. already exists)" },
    { code: 410, phrase: "Gone", meaning: "Removed for good" },
    { code: 412, phrase: "Precondition Failed", meaning: "If-Match / If-Unmodified-Since failed" },
    { code: 413, phrase: "Content Too Large", meaning: "Request body too big" },
    { code: 415, phrase: "Unsupported Media Type", meaning: "Body format not accepted" },
    { code: 418, phrase: "I'm a teapot", meaning: "Joke status (RFC 2324)" },
    { code: 422, phrase: "Unprocessable Content", meaning: "Well-formed, but fails validation" },
    { code: 423, phrase: "Locked", meaning: "The resource is locked" },
    { code: 428, phrase: "Precondition Required", meaning: "Needs a conditional request" },
    { code: 429, phrase: "Too Many Requests", meaning: "Rate limited" },
    { code: 451, phrase: "Unavailable For Legal Reasons", meaning: "Blocked for legal reasons" },
    { code: 500, phrase: "Internal Server Error", meaning: "The server failed" },
    { code: 501, phrase: "Not Implemented", meaning: "The server can't do this" },
    { code: 502, phrase: "Bad Gateway", meaning: "An upstream server answered badly" },
    { code: 503, phrase: "Service Unavailable", meaning: "Down or overloaded, try later" },
    { code: 504, phrase: "Gateway Timeout", meaning: "An upstream server didn't answer in time" },
];

const BY_CODE = new Map(STATUS_CODES.map((s) => [s.code, s]));

/** The status's reason phrase, or its class ("Client error") for codes not in the list. */
export function statusPhrase(code: number): string {
    const known = BY_CODE.get(code);
    if (known) return known.phrase;
    return ({ 1: "Informational", 2: "Success", 3: "Redirect", 4: "Client error", 5: "Server error" } as Record<number, string>)[Math.floor(code / 100)] ?? "";
}
