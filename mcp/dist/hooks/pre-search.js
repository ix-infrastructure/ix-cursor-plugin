#!/usr/bin/env node
// Cursor preToolUse hook (matcher: "Grep") — graph-first search interception.
//
// Fires before Cursor's native Grep tool executes. Classifies the search pattern
// as a code symbol or a literal string. For symbol-like queries, runs ix locate
// and ix text in parallel and injects a compact graph-backed summary so the agent
// has structured knowledge before raw text search results arrive.
//
// V1 ships in augment-only mode (IX_BLOCK_ON_HIGH_CONFIDENCE defaults to false).
// Blocking is available but disabled until false-positive rates are measured.
//
// Contract:
//   exit 0 + JSON → inject agent_message, native Grep still runs (augment)
//   exit 0 + no stdout → pass through silently
//   exit 2 → block native Grep (only when IX_BLOCK_ON_HIGH_CONFIDENCE=true)
import { checkHealth, runIxParallel } from "../lib/cli.js";
import { IX_BLOCK_ON_HIGH_CONFIDENCE, IX_HOOK_VERBOSITY } from "../lib/config.js";
import { parseIxJson } from "../lib/parser.js";
import { classifyIntent, looksLikeSecret } from "../shared/intent-classifier.js";
// Regex metacharacter check — patterns with these shouldn't be sent to ix locate
function isRegexPattern(pattern) {
    return /[*+?]|[[\]()]|\\[a-zA-Z]|\{[0-9]/.test(pattern);
}
function confidenceGate(confidence) {
    if (confidence < 0.3)
        return { gate: "drop", warn: "" };
    if (confidence < 0.6)
        return {
            gate: "warn",
            warn: `⚠ Graph confidence low (${confidence.toFixed(2)}) — treat structural data as approximate`,
        };
    return { gate: "ok", warn: "" };
}
// ── Summary builders ──────────────────────────────────────────────────────────
function summarizeLocate(raw) {
    const confidence = raw.confidence ??
        raw.resolvedTarget?.confidence ??
        1.0;
    const target = raw.resolvedTarget;
    if (target?.name) {
        const kind = target.kind ? `, ${target.kind}` : "";
        const file = target.path ? `, ${target.path.split("/").at(-1)}` : "";
        return { part: `symbol: ${target.name}${kind}${file ? `${file}` : ""}`, confidence };
    }
    const candidates = (raw.candidates ?? []).slice(0, 3);
    if (candidates.length > 0) {
        const list = candidates
            .map((c) => `${c.name ?? "?"}${c.kind ? ` (${c.kind})` : ""}`)
            .join(", ");
        return { part: `candidates: ${list}`, confidence };
    }
    return { part: "", confidence };
}
function summarizeText(hits) {
    if (hits.length === 0)
        return "";
    const files = [...new Set(hits.map((h) => h.path?.split("/").at(-1) ?? "").filter(Boolean))];
    const shown = files.slice(0, 4).join(", ");
    const more = files.length > 4 ? ` (+${files.length - 4} more)` : "";
    return `${hits.length} text hits in ${shown}${more}`;
}
// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    let payload = {};
    try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch {
        process.exit(0);
    }
    const pattern = payload.tool_input?.pattern ?? "";
    if (!pattern || pattern.length < 3)
        process.exit(0);
    // Skip secret-like patterns — never log or forward credentials
    if (looksLikeSecret(pattern))
        process.exit(0);
    // Classify intent — pass literals, files, unknowns through to native grep
    const { intent } = classifyIntent(pattern);
    if (intent !== "symbol")
        process.exit(0);
    // Health gate
    const healthy = await checkHealth();
    if (!healthy)
        process.exit(0);
    const pathArg = payload.tool_input?.path;
    const langArg = payload.tool_input?.type;
    // Build parallel calls: ix text (always) + ix locate (only for plain patterns)
    const textArgs = [
        "text",
        pattern,
        "--limit",
        "15",
        ...(pathArg ? ["--path", pathArg] : []),
        ...(langArg ? ["--language", langArg] : []),
    ];
    const calls = [{ args: textArgs, label: "text" }];
    if (!isRegexPattern(pattern)) {
        calls.push({ args: ["locate", pattern], label: "locate" });
    }
    // Run in parallel (9 s budget; hook timeout is 10 s)
    const results = await runIxParallel(calls, { timeout: 9_000 });
    // Parse locate result
    let locatePart = "";
    let locateConfidence = 1.0;
    let locateRaw = null;
    const locateResult = results["locate"];
    if (locateResult?.stdout) {
        try {
            locateRaw = parseIxJson(locateResult.stdout);
            const summary = summarizeLocate(locateRaw);
            locatePart = summary.part;
            locateConfidence = summary.confidence;
        }
        catch {
            // parse failure — ignore locate result
        }
    }
    // Parse text result
    let textPart = "";
    let textRaw = null;
    const textResult = results["text"];
    if (textResult?.stdout) {
        try {
            textRaw = parseIxJson(textResult.stdout);
            const hits = Array.isArray(textRaw) ? textRaw : [];
            textPart = summarizeText(hits);
        }
        catch {
            // parse failure — ignore text result
        }
    }
    if (!locatePart && !textPart)
        process.exit(0);
    // Confidence gate — suppress or warn based on locate confidence
    const { gate, warn } = confidenceGate(locateConfidence);
    if (gate === "drop")
        process.exit(0);
    if (gate === "warn") {
        locatePart = locatePart ? `${warn} | ${locatePart}` : warn;
    }
    // Build context string
    const parts = [`[ix text + ix locate] '${pattern}'`];
    if (locatePart)
        parts.push(locatePart);
    if (textPart)
        parts.push(textPart);
    parts.push("Use ix_explain/ix_trace/ix_impact for deeper analysis, ix_read for source");
    const context = parts.join(" — ");
    // Determine mode. V1 defaults to augment; blocking requires explicit opt-in.
    const fullyResolved = locatePart.startsWith("symbol:") &&
        !!(results["locate"]?.stdout);
    if (IX_BLOCK_ON_HIGH_CONFIDENCE && fullyResolved && gate === "ok") {
        const denyMessage = IX_HOOK_VERBOSITY === "verbose"
            ? `${context}\n\n${JSON.stringify({ locate: locateRaw, text: textRaw }, null, 2)}`
            : context;
        // Block native Grep — Ix has a high-confidence answer
        process.stdout.write(JSON.stringify({
            permission: "deny",
            agent_message: denyMessage,
            user_message: `[ix] Blocked native Grep — graph-backed match found for '${pattern}'.`,
        }));
        process.exit(2); // exit 2 = block in Cursor hook protocol
    }
    if (IX_HOOK_VERBOSITY === "silent") {
        process.exit(0);
    }
    const agentMessage = IX_HOOK_VERBOSITY === "verbose"
        ? `${context}\n\n${JSON.stringify({ locate: locateRaw, text: textRaw }, null, 2)}`
        : context;
    // Augment: inject context and let native Grep also run
    process.stdout.write(JSON.stringify({
        permission: "allow",
        agent_message: agentMessage,
    }));
    process.exit(0);
}
main().catch(() => {
    process.exit(0);
});
//# sourceMappingURL=pre-search.js.map