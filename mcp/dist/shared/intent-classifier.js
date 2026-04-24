// Intent classifier — formalizes ix_query_intent() from ix-lib.sh.
//
// Classifies a search pattern as symbol, literal, file, or unknown, and
// attaches a confidence score. Used by pre-search and pre-bash hooks.
//
// Confidence ranges:
//   0.9  PascalCase / well-formed file path → very likely correct intent
//   0.8  camelCase / dotted qualified name
//   0.75 short snake_case
//   0.5  ambiguous (short, plain, could be anything)
//   0.3  command-like string → probably not a code search
import { containsSecret } from "./secrets.js";
// ── Literal indicators ────────────────────────────────────────────────────────
function isLiteral(p) {
    // Regex metacharacters
    if (/[*+?]|[[\]()]|\\[a-zA-Z]|\{[0-9]/.test(p))
        return true;
    // Common log/doc search phrases
    if (/^(TODO|FIXME|HACK|NOTE|XXX|DEPRECATED|error:|warn:|info:|debug:|fatal:)/i.test(p))
        return true;
    // Multi-word → prose or log fragment
    if (/\s/.test(p))
        return true;
    // Too long → likely a log line
    if (p.length > 60)
        return true;
    // Quoted string literal
    if (/^['"].*['"]$/.test(p))
        return true;
    return false;
}
// ── File path indicators ──────────────────────────────────────────────────────
function asFile(p) {
    // Absolute or relative path-like: starts with / or ./ or contains /
    if (/^(\/|\.\/|\.\.\/)/.test(p))
        return { intent: "file", confidence: 0.95 };
    // Path with extension and separator
    if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./:-]+\.[a-zA-Z]{1,6}$/.test(p))
        return { intent: "file", confidence: 0.9 };
    return null;
}
// ── Command-like indicators ───────────────────────────────────────────────────
function asUnknown(p) {
    // Starts with a shell command word
    if (/^(grep|rg|find|ls|cat|git|npm|yarn|cd|echo|curl|wget)\s/.test(p))
        return { intent: "unknown", confidence: 0.3 };
    // Starts with a flag
    if (/^-/.test(p))
        return { intent: "unknown", confidence: 0.3 };
    return null;
}
// ── Symbol heuristics ─────────────────────────────────────────────────────────
function asSymbol(p) {
    // PascalCase (UpperCamelCase)
    if (/^[A-Z][a-zA-Z0-9]*$/.test(p) && p.length >= 3)
        return { intent: "symbol", confidence: 0.9 };
    // camelCase (starts lowercase, has uppercase inside)
    if (/^[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*$/.test(p))
        return { intent: "symbol", confidence: 0.8 };
    // Dotted qualified name: module.method or module.Class.method
    if (/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/.test(p))
        return { intent: "symbol", confidence: 0.8 };
    // snake_case (underscores, no spaces, reasonable length)
    if (/^[a-z_][a-z0-9_]+$/.test(p) && p.includes("_") && p.length >= 4)
        return { intent: "symbol", confidence: 0.75 };
    // SCREAMING_SNAKE (constants)
    if (/^[A-Z_][A-Z0-9_]+$/.test(p) && p.includes("_"))
        return { intent: "symbol", confidence: 0.75 };
    // Short plain word — ambiguous but worth trying
    return { intent: "symbol", confidence: 0.5 };
}
// ── Public API ────────────────────────────────────────────────────────────────
export function classifyIntent(pattern) {
    const p = pattern.trim();
    if (!p)
        return { intent: "unknown", confidence: 0 };
    if (isLiteral(p))
        return { intent: "literal", confidence: 0.9 };
    const fileResult = asFile(p);
    if (fileResult)
        return fileResult;
    const unknownResult = asUnknown(p);
    if (unknownResult)
        return unknownResult;
    return asSymbol(p);
}
// ── Re-export secret detector (used alongside intent) ─────────────────────────
// Mirrors ix_looks_like_secret from ix-lib.sh.
export function looksLikeSecret(pattern) {
    return containsSecret(pattern);
}
//# sourceMappingURL=intent-classifier.js.map