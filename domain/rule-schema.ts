import type { JsonSchema } from "../shared/ui/code-editor/json-schema";

// -------------------------------------------------------------------------------------------------
// RULE SCHEMA
// The code view's rule JSON (see ruleToJson / parseRuleJson in ./rules-io.ts), for completion, hover
// hints and checks. Examples come from what the page has requested.
// -------------------------------------------------------------------------------------------------

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "TRACE"];
const str = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: "string", description, ...extra });
const stringMap = (description: string): JsonSchema => ({ type: "object", description, additionalProperties: { type: "string" } });
const actionType = (type: string): JsonSchema => ({ type: "string", enum: [type], description: "What the rule acts on: the request, the response, or only the palette's list." });
const mode = (m: string, description: string): JsonSchema => ({ type: "string", enum: [m], description });
const delay: JsonSchema = { type: "number", description: "Milliseconds to wait first (delays of all matching rules add up).", default: 0, examples: [0, 1000, 3000, 10000] };

export function ruleSchema({ origins, urls }: { origins: string[]; urls: string[] }): JsonSchema {
    return {
        type: "object",
        description: "An interception rule: requests matching `filter` get `action`.",
        required: ["filter", "action"],
        properties: {
            name: str("Shown in the rule list; empty shows the filter instead.", { default: "" }),
            tags: { type: "array", items: { type: "string" }, description: "Labels to find the rule by in the palette's search." },
            enabled: { type: "boolean", description: "Whether the rule runs.", default: true },
            filter: {
                type: "object",
                description: "Which requests the rule applies to: every field set must match; leave a field out to match anything there.",
                properties: {
                    method: str("The HTTP method, uppercase.", { examples: HTTP_METHODS }),
                    url: str("A URL pattern (as URLPattern takes) for the URL without its query: :name matches one path segment, * any text (/ included), (a|b) a regular expression; start with / to match a path on any origin.",
                        { examples: [...origins.map((o) => `${o}/api/*`), "/api/:team/items/*", "https://*.example.com/*"] }),
                    query: stringMap("Query parameters that must have exactly these values, in any order (others may be present)."),
                    bodyContains: str("Text the request body must contain."),
                },
            },
            action: {
                description: "What the rule does, as the GUI's actions: Pause (request/ask, response/ask; automatic once remembered: request/send with `edit` or `response`, response/replace), Mock (request/respond), Delay (request/send with no `edit`), Hide, Favourite, Fold. Every matching rule's delay counts; the first matching rule that changes something decides.",
                oneOf: [
                    {
                        description: "Pause · at request · each time: each matching request waits in the palette to be sent (edited or not), answered, or blocked (5 min max).", type: "object", required: ["type", "mode"],
                        properties: { type: actionType("request"), mode: mode("ask", "Pause it in the palette each time.") },
                    },
                    {
                        description: "Delay, with no `edit` or `response`: hold each matching request for `delayMs`, then send it as is. With them, Pause · at request · automatic (what Remember in the palette saves): send it with `edit`'s fields replacing its own, then replace its response with `response`, if set.", type: "object", required: ["type", "mode"],
                        properties: {
                            type: actionType("request"), mode: mode("send", "Send it without pausing: as is (Delay), or as remembered (Pause, automatic)."),
                            delayMs: { ...delay, description: "Milliseconds to hold it first (delays of all matching rules add up).", default: 3000 },
                            edit: {
                                type: "object", description: "What to send instead: each field set replaces the request's.",
                                properties: {
                                    method: str("The method to send.", { examples: HTTP_METHODS }),
                                    url: str("The URL to send every matching request to."),
                                    headers: stringMap("The headers to send (all of them)."),
                                    body: str("The request body to send."),
                                },
                            },
                            response: {
                                type: "object", required: ["status", "body"], description: "Also replace its response with this status and body (its headers stay): remembered from a response paused with \"Pause its response too\".",
                                properties: { status: { type: "number", description: "The response's HTTP status." }, body: str("The response body.") },
                            },
                        },
                    },
                    {
                        description: "Mock: answer each matching request with `response`, after `delayMs`; the request is never sent. (Also what Remember saves for a request answered from the palette.)", type: "object", required: ["type", "mode", "response"],
                        properties: {
                            type: actionType("request"), mode: mode("respond", "Answer it with `response` instead of sending it."), delayMs: delay,
                            response: {
                                type: "object", required: ["status", "mime", "body"], description: "The response the page gets.",
                                properties: {
                                    status: { type: "number", description: "The response's HTTP status.", default: 500, examples: [200, 400, 401, 403, 404, 409, 429, 500, 502, 503, 504] },
                                    mime: str("The response's Content-Type.", { default: "application/json", examples: ["application/json", "text/plain", "text/html"] }),
                                    body: str("The response body (a JSON body as a string).", { default: '{"error":"Injected failure"}' }),
                                },
                            },
                        },
                    },
                    {
                        description: "Pause · at response · each time: each matching response waits in the palette to be edited and released (5 min max).", type: "object", required: ["type", "mode"],
                        properties: { type: actionType("response"), mode: mode("ask", "Pause it in the palette each time.") },
                    },
                    {
                        description: "Pause · at response · automatic (what Remember in the palette saves): send the request, then replace its response with `response`, after `delayMs`.", type: "object", required: ["type", "mode", "response"],
                        properties: {
                            type: actionType("response"), mode: mode("replace", "Replace it with `response` without pausing."), delayMs: delay,
                            response: {
                                type: "object", required: ["status", "body"], description: "The response the page gets instead (its headers stay).",
                                properties: { status: { type: "number", description: "The response's HTTP status." }, body: str("The response body.") },
                            },
                        },
                    },
                    { description: "Hide (list only): leave matching requests alone, just don't list them in the palette.", type: "object", required: ["type"], properties: { type: actionType("hide") } },
                    { description: "Favourite (list only): leave matching requests alone, just star them and pin them at the top of the palette's list.", type: "object", required: ["type"], properties: { type: actionType("favourite") } },
                    { description: "Fold (list only): leave matching requests alone, just fold them into one row of the palette's list (even when their URLs or bodies differ).", type: "object", required: ["type"], properties: { type: actionType("fold") } },
                ],
            },
            sample: {
                type: "object",
                description: "The request the rule was made from, which the GUI shows to build the filter from.",
                required: ["method", "url"],
                properties: {
                    method: str("The sample request's method.", { examples: HTTP_METHODS }),
                    url: str("The sample request's full URL: the GUI shows it part by part, to build the URL pattern from.", { examples: urls }),
                    body: str("The sample request's body."),
                },
            },
        },
    };
}
