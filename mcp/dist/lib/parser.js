import { stripHeader } from "./cli.js";
import { containsSecret, redactSecrets } from "../shared/secrets.js";
export class ParseError extends Error {
    constructor(message) {
        super(message);
        this.name = "ParseError";
    }
}
// ── Envelope builders ─────────────────────────────────────────────────────────
export function wrapOk(tool, input, data, summary, evidence, durationMs) {
    const result = { ok: true, tool, input, summary, data };
    if (evidence !== undefined)
        result.evidence = evidence;
    if (durationMs !== undefined)
        result.timing_ms = durationMs;
    return result;
}
export function wrapErr(tool, input, err) {
    return { ok: false, tool, input, error: { code: err.code, message: err.message } };
}
// ── JSON parser ───────────────────────────────────────────────────────────────
// Strips ix header noise, then parses JSON. Throws ParseError on failure.
function sanitizeParsedValue(value) {
    if (typeof value === "string") {
        return containsSecret(value) ? redactSecrets(value) : value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeParsedValue(entry));
    }
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value).map(([key, entry]) => [key, sanitizeParsedValue(entry)]);
        return Object.fromEntries(entries);
    }
    return value;
}
export function parseIxJson(raw) {
    const cleaned = stripHeader(raw).trim();
    if (!cleaned) {
        throw new ParseError("ix produced no JSON output");
    }
    try {
        const parsed = JSON.parse(cleaned);
        return sanitizeParsedValue(parsed);
    }
    catch (cause) {
        throw new ParseError(`ix output is not valid JSON: ${cleaned.slice(0, 120)}`);
    }
}
//# sourceMappingURL=parser.js.map