#!/usr/bin/env node
// Copyright 2026 Ix Infrastructure Inc.
// Cursor Grep hook — graph-first search context. Registered twice (matcher
// "Grep"), and branches on the payload's hook_event_name:
//
//   postToolUse (default, augment): classifies the search pattern; for
//     symbol-like queries runs ix locate + ix text and returns a compact
//     graph-backed summary as `additional_context`, which Cursor injects
//     "into the conversation after the tool result".
//   preToolUse (opt-in, IX_BLOCK_ON_HIGH_CONFIDENCE=true): on a high-confidence
//     symbol match, denies the native Grep with the summary as `agent_message`,
//     which Cursor feeds back to the agent "when the action is denied".
//     Otherwise it exits without output and the Grep runs.
//
// The augment path used to answer preToolUse with `permission: "allow"` +
// `agent_message`; Cursor delivers agent_message only on deny, so it never
// reached the model. The deny path used to exit 2; the docs define exit 0 as
// "use the JSON output" and exit 2 only as "block the action", so it now exits
// 0 to be sure the agent_message is read.
// Source: https://cursor.com/docs/hooks (Command-Based Hooks -> exit codes;
// Hook events -> preToolUse, postToolUse).
import { isAbsolute, relative } from "node:path";
import { checkHealth, runIxParallel } from "../lib/cli.js";
import { IX_BLOCK_ON_HIGH_CONFIDENCE, IX_HOOK_VERBOSITY } from "../lib/config.js";
import { parseIxJson } from "../lib/parser.js";
import { ixRoot, readHookInput, writeHookOutput, } from "../shared/hook-io.js";
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
    const input = await readHookInput();
    if (!input)
        process.exit(0);
    // preToolUse only matters when blocking is enabled; otherwise let Grep run
    // untouched and add context afterwards, from postToolUse.
    const isPreToolUse = input.hook_event_name === "preToolUse";
    if (isPreToolUse && !IX_BLOCK_ON_HIGH_CONFIDENCE)
        process.exit(0);
    if (!isPreToolUse && IX_HOOK_VERBOSITY === "silent")
        process.exit(0);
    const pattern = input.tool_input?.pattern ?? "";
    if (!pattern || pattern.length < 3)
        process.exit(0);
    // Skip secret-like patterns — never log or forward credentials
    if (looksLikeSecret(pattern))
        process.exit(0);
    // Classify intent — pass literals, files, unknowns through to native grep
    const { intent } = classifyIntent(pattern);
    if (intent !== "symbol")
        process.exit(0);
    const root = await ixRoot(input);
    if (!root)
        process.exit(0);
    // Health gate
    const healthy = await checkHealth();
    if (!healthy)
        process.exit(0);
    // `ix text --path` is workspace-relative; Cursor may pass an absolute path.
    const rawPath = input.tool_input?.path;
    const relPath = rawPath && isAbsolute(rawPath) ? relative(root, rawPath) : rawPath;
    const pathArg = relPath && !relPath.startsWith("..") ? relPath : undefined;
    const langArg = input.tool_input?.type;
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
    const results = await runIxParallel(calls, { timeout: 9_000, cwd: root });
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
    const fullyResolved = locatePart.startsWith("symbol:") &&
        !!(results["locate"]?.stdout);
    if (isPreToolUse) {
        if (!(fullyResolved && gate === "ok"))
            process.exit(0);
        const denyMessage = IX_HOOK_VERBOSITY === "verbose"
            ? `${context}\n\n${JSON.stringify({ locate: locateRaw, text: textRaw }, null, 2)}`
            : context;
        // Block native Grep — Ix has a high-confidence answer. Exit 0: that is the
        // exit code for which Cursor documents reading the JSON.
        const output = {
            permission: "deny",
            agent_message: denyMessage,
            user_message: `[ix] Blocked native Grep — graph-backed match found for '${pattern}'.`,
        };
        writeHookOutput(output);
        process.exit(0);
    }
    const additionalContext = IX_HOOK_VERBOSITY === "verbose"
        ? `${context}\n\n${JSON.stringify({ locate: locateRaw, text: textRaw }, null, 2)}`
        : context;
    // Augment: the Grep already ran; add the graph view after its result.
    const output = { additional_context: additionalContext };
    writeHookOutput(output);
    process.exit(0);
}
main().catch(() => {
    process.exit(0);
});
//# sourceMappingURL=pre-search.js.map