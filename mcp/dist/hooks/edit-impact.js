#!/usr/bin/env node
// Copyright 2026 Ix Infrastructure Inc.
// Cursor postToolUse hook (matcher: "Write") — edit impact warning.
//
// After the agent writes a code file, calls ix impact on it and, when the file
// has enough dependents, tells the agent its blast radius so it checks callers
// before moving on.
//
// Was a preToolUse hook returning `permission: "allow"` + `agent_message`.
// Cursor feeds preToolUse's agent_message back only "when the action is
// denied", so on an allowed write the warning never reached the model.
// postToolUse's `additional_context` is "injected into the conversation after
// the tool result". Source: https://cursor.com/docs/hooks (Hook events ->
// preToolUse, postToolUse; matcher values include `Write`). The warning now
// lands right after the write instead of before it; the only pre-write channel
// is a deny, and these warnings are advisory.
//
// Contract:
//   exit 0 + {"additional_context": ...} → warning shown to the agent
//   exit 0 + no stdout                   → nothing to say
//   never blocks: postToolUse has no permission output
import { realpath } from "node:fs/promises";
import { basename, relative } from "node:path";
import { checkHealth, runIx } from "../lib/cli.js";
import { IX_HOOK_VERBOSITY } from "../lib/config.js";
import { parseIxJson } from "../lib/parser.js";
import { ixRoot, readHookInput, writeHookOutput, } from "../shared/hook-io.js";
import { summarizeRisk } from "../shared/summarizers.js";
// ── Skip lists (matches ix-pre-edit.sh) ──────────────────────────────────────
const SKIP_EXTENSIONS = new Set([
    ".md", ".txt", ".lock",
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".bin",
    ".pyc", ".class", ".o",
]);
const SKIP_PATTERNS = [/__pycache__/];
function shouldSkip(filePath) {
    const dot = filePath.lastIndexOf(".");
    if (dot !== -1) {
        const ext = filePath.slice(dot).toLowerCase();
        if (SKIP_EXTENSIONS.has(ext))
            return true;
    }
    return SKIP_PATTERNS.some((re) => re.test(filePath));
}
// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    // tool_input's file path field is not documented for Cursor's Write tool;
    // accept both spellings.
    const input = await readHookInput();
    if (!input)
        process.exit(0);
    const filePath = input.tool_input?.file_path ?? input.tool_input?.path ?? "";
    if (!filePath)
        process.exit(0);
    if (shouldSkip(filePath))
        process.exit(0);
    if (IX_HOOK_VERBOSITY === "silent")
        process.exit(0);
    // Run ix in the repo holding the file; skip files outside every workspace.
    const root = await ixRoot(input, filePath);
    if (!root)
        process.exit(0);
    // Health gate
    const healthy = await checkHealth();
    if (!healthy)
        process.exit(0);
    // root is canonical (git top level); canonicalise the file the same way.
    const rel = relative(root, await realpath(filePath).catch(() => filePath));
    const relPath = rel && !rel.startsWith("..") ? rel : filePath;
    const filename = basename(filePath);
    // Call ix impact (9 s budget; hook timeout is 10 s)
    const result = await runIx(["impact", relPath], { timeout: 9_000, cwd: root });
    // Not `!result.ok`. A non-zero exit is not the same as no answer: `runIx`
    // keeps stdout across a failure, and since ix-infrastructure/Ix#547 a target
    // that is not in the graph exits 1 while still printing its JSON body. Gating
    // on the exit code alone conflated "ix could not run" with "ix ran and had
    // nothing to say", and threw the body away in both cases. Bail only when
    // there is genuinely nothing to read — a missing binary, a timeout, a crash.
    if (!result.stdout.trim())
        process.exit(0);
    let raw;
    try {
        raw = parseIxJson(result.stdout);
    }
    catch {
        process.exit(0);
    }
    const riskLevel = raw.riskLevel ?? "unknown";
    if (riskLevel === "unknown" || riskLevel === "low")
        process.exit(0);
    const directDependents = raw.summary?.directDependents ?? 0;
    const memberCallers = raw.summary?.memberLevelCallers ?? 0;
    const effectiveDependents = Math.max(directDependents, memberCallers);
    // Only warn when there are enough dependents to be meaningful
    if (effectiveDependents < 3)
        process.exit(0);
    const warning = summarizeRisk({
        ...raw,
        target: filename,
        dependents: effectiveDependents,
    });
    if (!warning)
        process.exit(0);
    const context = IX_HOOK_VERBOSITY === "verbose"
        ? `${warning}\n\n${JSON.stringify(raw, null, 2)}`
        : warning;
    const output = { additional_context: context };
    writeHookOutput(output);
    process.exit(0);
}
main().catch(() => {
    process.exit(0);
});
//# sourceMappingURL=edit-impact.js.map