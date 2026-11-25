import { type Completion, type CompletionContext, type CompletionResult, snippetCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { type Diagnostic, linter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { hoverTooltip } from "@codemirror/view";

// -------------------------------------------------------------------------------------------------
// JSON SCHEMA EDITING
// Completion, hover hints and checks for JSON text described by a (small) JSON schema: property
// names for the object at the cursor (inserted with a value placeholder), enum and example values,
// descriptions on hover, and unknown / mistyped / missing properties underlined. `oneOf` variants
// are told apart by their single-value (enum of one) properties, e.g. `type` and `mode` for rule
// actions: while those don't pick one yet, the variants that still fit are merged.
// -------------------------------------------------------------------------------------------------

type JsonType = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface JsonSchema {
    description?: string;
    type?: JsonType | JsonType[];
    properties?: Record<string, JsonSchema>;
    required?: string[];
    /** schema of properties not in `properties` (false: none allowed, the default for objects with `properties`) */
    additionalProperties?: JsonSchema | boolean;
    items?: JsonSchema;
    enum?: unknown[];
    /** suggested values (any value is allowed) */
    examples?: unknown[];
    default?: unknown;
    /** variants, chosen by the values of their single-value properties (`type`, `mode`…) */
    oneOf?: JsonSchema[];
}

type Step = string | number;

// ---- reading incomplete JSON ---------------------------------------------------------------------

interface Frame { kind: "object" | "array"; start: number; key?: string; afterColon: boolean; index: number }

/** The containers open at `end` (innermost last), and the start of the string `end` is in, if any. */
function scan(text: string, end: number): { frames: Frame[]; stringStart?: number } {
    const frames: Frame[] = [];
    let i = 0;
    while (i < end) {
        const c = text[i];
        const top = frames[frames.length - 1];
        if (c === '"') {
            let j = i + 1;
            while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
            if (j >= end) return { frames, stringStart: i };
            if (top?.kind === "object" && !top.afterColon) {
                try { top.key = JSON.parse(text.slice(i, j + 1)); } catch { top.key = text.slice(i + 1, j); }
            }
            i = j + 1;
            continue;
        }
        if (c === "{" || c === "[") frames.push({ kind: c === "{" ? "object" : "array", start: i, afterColon: false, index: 0 });
        else if (c === "}" || c === "]") frames.pop();
        else if (c === ":" && top) top.afterColon = true;
        else if (c === "," && top) { if (top.kind === "object") { top.afterColon = false; top.key = undefined; } else top.index++; }
        i++;
    }
    return { frames };
}

/** The keys of the object starting at `start` (its `{`), with the values of string/number/literal properties. */
function objectProperties(text: string, start: number): Map<string, unknown> {
    const props = new Map<string, unknown>();
    let depth = 0, key: string | undefined, afterColon = false;
    for (let i = start + 1; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            let j = i + 1;
            while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
            let value: unknown;
            try { value = JSON.parse(text.slice(i, j + 1)); } catch { value = text.slice(i + 1, j); }
            if (depth === 0) {
                if (!afterColon) key = String(value);
                else if (key !== undefined) props.set(key, value);
            }
            i = j;
        } else if (c === "{" || c === "[") { if (depth === 0 && key !== undefined) props.set(key, undefined); depth++; }
        else if (c === "}" || c === "]") { if (depth === 0) break; depth--; }
        else if (depth === 0 && c === ":") afterColon = true;
        else if (depth === 0 && c === ",") { afterColon = false; key = undefined; }
        else if (depth === 0 && afterColon && key !== undefined && /[-\w.]/.test(c)) {
            const literal = /^[-\w.+]+/.exec(text.slice(i))![0];
            try { props.set(key, JSON.parse(literal)); } catch { props.set(key, literal); }
            i += literal.length - 1;
        }
    }
    return props;
}

// ---- schemas -------------------------------------------------------------------------------------

const typesOf = (s: JsonSchema): JsonType[] => (s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type]);

/** A variant's single-value properties: what tells it apart (e.g. `type`, `mode`). */
const discriminators = (v: JsonSchema) => Object.entries(v.properties ?? {}).filter(([, p]) => p.enum?.length === 1);

/**
 * The variant of a `oneOf` schema for an object with these properties: the one whose single-value
 * properties all match those set; while several fit (or none), their properties merged (single
 * values of a property joined as its enum), required what all of them require.
 */
function variant(schema: JsonSchema, props: Map<string, unknown> | undefined): JsonSchema {
    if (!schema.oneOf) return schema;
    // a value no variant has (e.g. half typed) doesn't rule any out
    const known = (key: string) => props?.has(key) && schema.oneOf!.some((v) => discriminators(v).some(([k, p]) => k === key && p.enum![0] === props.get(key)));
    const fits = schema.oneOf.filter((v) => discriminators(v).every(([key, p]) => !known(key) || p.enum![0] === props!.get(key)));
    if (fits.length === 1) return { ...fits[0], description: fits[0].description ?? schema.description };
    const pool = fits.length ? fits : schema.oneOf;
    const properties: Record<string, JsonSchema> = {};
    for (const v of pool) {
        for (const [key, p] of Object.entries(v.properties ?? {})) {
            const seen = properties[key];
            properties[key] = seen?.enum && p.enum ? { ...seen, enum: [...new Set([...seen.enum, ...p.enum])] } : seen ?? p;
        }
    }
    const required = pool.map((v) => v.required ?? []).reduce((a, b) => a.filter((k) => b.includes(k)));
    return { description: schema.description, type: "object", properties, required };
}

function child(schema: JsonSchema | undefined, step: Step): JsonSchema | undefined {
    if (!schema) return undefined;
    if (typeof step === "number") return schema.items;
    return schema.properties?.[step] ?? (typeof schema.additionalProperties === "object" ? schema.additionalProperties : undefined);
}

/** The schema of each open container (innermost last), variants picked from the text. */
function containerSchemas(root: JsonSchema, frames: Frame[], text: string): (JsonSchema | undefined)[] {
    const out: (JsonSchema | undefined)[] = [];
    let s: JsonSchema | undefined = root;
    frames.forEach((f, k) => {
        if (s && f.kind === "object") s = variant(s, objectProperties(text, f.start));
        out.push(s);
        if (k < frames.length - 1) s = child(s, f.kind === "object" ? f.key ?? "" : f.index);
    });
    return out;
}

function describe(name: string | undefined, s: JsonSchema): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-schema-info";
    const head = el.appendChild(document.createElement("div"));
    if (name !== undefined) head.appendChild(document.createElement("b")).textContent = name;
    const types = s.oneOf ? ["object"] : typesOf(s);
    if (types.length) head.appendChild(document.createElement("code")).textContent = ` ${types.join(" | ")}`;
    if (s.description) el.appendChild(document.createElement("div")).textContent = s.description;
    const values = s.enum ?? (s.oneOf ? [...new Set(s.oneOf.flatMap((v) => v.properties?.type?.enum ?? []))] : undefined);
    if (values?.length) el.appendChild(document.createElement("div")).textContent = `${s.enum ? "One of" : "type"}: ${values.map((v) => JSON.stringify(v)).join(", ")}`;
    return el;
}

// ---- completion ----------------------------------------------------------------------------------

// snippets only unescape \{ and \}
const snippetText = (v: string) => v.replace(/[{}]/g, "\\$&");

function valueTemplate(s: JsonSchema | undefined): string {
    if (s?.enum?.length === 1) return snippetText(JSON.stringify(s.enum[0]));
    const type = s?.oneOf ? "object" : s ? typesOf(s)[0] : undefined;
    const fallback = s?.default ?? s?.examples?.[0];
    switch (type) {
        case "object": return "{\n\t#{}\n}";
        case "array": return "[#{}]";
        // #{1:text}: a bare number would be read as a field index
        case "number": return `#{1:${fallback ?? 0}}`;
        case "boolean": return `#{1:${fallback ?? true}}`;
        case "null": return "null";
        default: {
            if (typeof fallback !== "string" || !fallback) return `"#{}"`;
            const inner = JSON.stringify(fallback).slice(1, -1);
            // a snippet field can't hold braces: insert those as plain text
            return /[{}]/.test(inner) ? snippetText(JSON.stringify(fallback)) : `"#{1:${inner}}"`;
        }
    }
}

function completeJson(getSchema: () => JsonSchema | undefined) {
    return (context: CompletionContext): CompletionResult | null => {
        const root = getSchema();
        if (!root) return null;
        const text = context.state.doc.toString();
        const pos = context.pos;
        const at = scan(text, pos);
        let from = pos;
        if (at.stringStart !== undefined) from = at.stringStart;
        else {
            const word = context.matchBefore(/[-\w.]+/);
            if (word) from = word.from;
            else if (!context.explicit && !/[{,:[]\s*$/.test(text.slice(0, pos))) return null;
        }
        const { frames } = at.stringStart !== undefined ? scan(text, from) : at;
        if (!frames.length) return null;
        const top = frames[frames.length - 1];
        const schemas = containerSchemas(root, frames, text);
        const container = schemas[schemas.length - 1];
        // replace the closing quote closeBrackets added, too
        const to = at.stringStart !== undefined && text[pos] === '"' ? pos + 1 : pos;

        if (top.kind === "object" && !top.afterColon) {
            if (!container?.properties) return null;
            const present = objectProperties(text, top.start);
            const typed = at.stringStart !== undefined ? text.slice(at.stringStart + 1, pos) : "";
            // editing an existing key: just the name
            const keyOnly = /^\s*:/.test(text.slice(to));
            const required = new Set(container.required ?? []);
            const options: Completion[] = Object.entries(container.properties)
                .filter(([key]) => !present.has(key) || key === typed)
                .map(([key, s]) => snippetCompletion(keyOnly ? `"${snippetText(key)}"` : `"${snippetText(key)}": ${valueTemplate(s)}`, {
                    label: key, type: "property", detail: (s.oneOf ? ["object"] : typesOf(s)).join(" | ") + (required.has(key) ? " · required" : ""),
                    info: () => describe(key, s), boost: required.has(key) ? 1 : 0,
                }));
            return { from, to, options, validFor: /^"?[-\w.]*"?$/ };
        }

        const target = top.kind === "object" ? child(container, top.key ?? "") : child(container, top.index);
        if (!target) return null;
        const values: unknown[] = [...(target.enum ?? target.oneOf?.flatMap((v) => v.properties?.type?.enum ?? []) ?? []), ...(target.examples ?? [])];
        if (!target.enum && typesOf(target).includes("boolean")) values.push(true, false);
        if (!target.enum && typesOf(target).includes("null")) values.push(null);
        // strings shown without their quotes: matched against the quoted text typed, the list would
        // underline the opening quote, which reads as "_ask"
        const options: Completion[] = [...new Set(values.map((v) => JSON.stringify(v)))].map((json) => ({
            label: json, displayLabel: json.startsWith('"') ? JSON.parse(json) as string : undefined,
            type: target.enum ? "enum" : "constant", detail: target.enum ? undefined : "example",
            info: target.description, apply: json,
        }));
        if (target.oneOf || typesOf(target).includes("object") || typesOf(target).includes("array")) {
            const tpl = valueTemplate(target.oneOf ? { type: "object" } : target);
            options.push(snippetCompletion(tpl, { label: tpl.startsWith("{") ? "{ }" : "[ ]", type: "keyword", info: () => describe(undefined, target) }));
        }
        return options.length ? { from, to, options, validFor: /^"?[^"]*"?$/ } : null;
    };
}

// ---- hover ---------------------------------------------------------------------------------------

function hoverJson(getSchema: () => JsonSchema | undefined) {
    return hoverTooltip((view, pos) => {
        const root = getSchema();
        if (!root) return null;
        const text = view.state.doc.toString();
        const at = scan(text, pos);
        if (at.stringStart === undefined) return null;
        let end = at.stringStart + 1;
        while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
        const before = scan(text, at.stringStart);
        const top = before.frames[before.frames.length - 1];
        if (!top) return null;
        const schemas = containerSchemas(root, before.frames, text);
        const container = schemas[schemas.length - 1];
        let name: string | undefined, s: JsonSchema | undefined;
        if (top.kind === "object" && !top.afterColon) {
            try { name = JSON.parse(text.slice(at.stringStart, end + 1)); } catch { return null; }
            s = child(container, name!);
        } else {
            const owner = top.kind === "object" ? child(container, top.key ?? "") : child(container, top.index);
            let value: unknown;
            try { value = JSON.parse(text.slice(at.stringStart, end + 1)); } catch { return null; }
            // a variant's type (e.g. an action's): what that variant does
            if (top.kind === "object" && top.key === "type" && owner?.enum && container?.description) { name = String(value); s = { description: container.description }; }
            else { name = top.kind === "object" ? top.key : undefined; s = owner; }
        }
        if (!s) return null;
        const info = describe(name, s);
        return { pos: at.stringStart, end: end + 1, above: true, create: () => ({ dom: info }) };
    });
}

// ---- checks --------------------------------------------------------------------------------------

type Node = ReturnType<ReturnType<typeof syntaxTree>["topNode"]["getChildren"]>[number];
const VALUE_NODES = new Set(["Object", "Array", "String", "Number", "True", "False", "Null"]);

function jsonTypeOf(v: unknown): JsonType {
    return v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : (typeof v as JsonType);
}

function checkJson(getSchema: () => JsonSchema | undefined) {
    return linter((view) => {
        const root = getSchema();
        if (!root) return [];
        const text = view.state.doc.toString();
        let value: unknown;
        try { value = JSON.parse(text); } catch { return []; } // syntax errors: the JSON linter's
        const diagnostics: Diagnostic[] = [];
        const top = syntaxTree(view.state).topNode.getChildren("Object").concat(syntaxTree(view.state).topNode.getChildren("Array"))[0];
        if (!top) return [];
        const check = (v: unknown, schema: JsonSchema, node: Node) => {
            const s = jsonTypeOf(v) === "object" ? variant(schema, new Map(Object.entries(v as object))) : schema;
            const types = s.oneOf ? ["object"] : typesOf(s);
            const type = jsonTypeOf(v);
            if (types.length && !types.includes(type)) {
                diagnostics.push({ from: node.from, to: node.to, severity: "error", message: `Expected ${types.join(" or ")}, got ${type}.` });
                return;
            }
            if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) {
                diagnostics.push({ from: node.from, to: node.to, severity: "error", message: `Expected one of ${s.enum.map((e) => JSON.stringify(e)).join(", ")}.` });
                return;
            }
            if (type === "object") {
                const obj = v as Record<string, unknown>;
                for (const key of s.required ?? [])
                    if (!(key in obj)) diagnostics.push({ from: node.from, to: node.from + 1, severity: "error", message: `Missing "${key}".` });
                for (const prop of node.getChildren("Property")) {
                    const nameNode = prop.getChild("PropertyName");
                    const valueNode = [...propChildren(prop)].find((c) => VALUE_NODES.has(c.name));
                    if (!nameNode) continue;
                    let key: string;
                    try { key = JSON.parse(view.state.sliceDoc(nameNode.from, nameNode.to)); } catch { continue; }
                    const sub = child(s, key);
                    if (!sub) {
                        if (s.properties && s.additionalProperties !== true)
                            diagnostics.push({ from: nameNode.from, to: nameNode.to, severity: "warning", message: `Unknown property "${key}"${s.properties ? `: expected ${Object.keys(s.properties).map((k) => `"${k}"`).join(", ")}` : ""}.` });
                        continue;
                    }
                    if (valueNode) check(obj[key], sub, valueNode);
                }
            } else if (type === "array" && s.items) {
                const items = [...propChildren(node)].filter((c) => VALUE_NODES.has(c.name));
                (v as unknown[]).forEach((item, i) => { if (items[i]) check(item, s.items!, items[i]); });
            }
        };
        check(value, root, top);
        return diagnostics;
    }, { delay: 300 });
}

function* propChildren(node: Node) {
    for (let c = node.firstChild; c; c = c.nextSibling) yield c;
}

/** Completion, hover hints and checks for JSON described by `getSchema()` (read each time: it may change). */
export function jsonSchemaSupport(getSchema: () => JsonSchema | undefined): { completion: (context: CompletionContext) => CompletionResult | null; extensions: Extension } {
    return { completion: completeJson(getSchema), extensions: [hoverJson(getSchema), checkJson(getSchema)] };
}
