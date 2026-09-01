#!/usr/bin/env node
// Cursor beforeSubmitPrompt hook — injects Ix session briefing once per 10 minutes.
//
// Reads JSON from stdin (prompt payload). Calls ix briefing via the CLI adapter,
// caches the result for BRIEFING_TTL_MS, and injects a compact context block.
//
// Contract:
//   exit 0 + JSON stdout → Cursor uses the output
//   exit 0 + no stdout  → Cursor proceeds silently
//   never exit non-zero → never block the user prompt
import { checkHealth, runIx } from "../lib/cli.js";
import { IX_HOOK_VERBOSITY } from "../lib/config.js";
import { parseIxJson } from "../lib/parser.js";
import { withCache } from "../shared/cache.js";
const BRIEFING_TTL_MS = 600_000; // 10 minutes, matches Claude plugin
// ── Formatting ────────────────────────────────────────────────────────────────
function formatBriefing(cache) {
    const lines = ["[ix] Session briefing:"];
    if (cache.goals.length > 0) {
        const names = cache.goals
            .slice(0, 5)
            .map((g) => g.name ?? g.id ?? "?")
            .join(", ");
        lines.push(`Goals: ${names}`);
    }
    if (cache.plans.length > 0) {
        for (const plan of cache.plans.slice(0, 3)) {
            const label = plan.name ?? plan.id ?? "?";
            const next = plan.nextTask ? ` → next: ${plan.nextTask}` : "";
            lines.push(`Plan: ${label}${next}`);
        }
    }
    if (cache.decisions.length > 0) {
        const recent = cache.decisions
            .slice(0, 3)
            .map((d) => d.name ?? d.id ?? "?")
            .join("; ");
        lines.push(`Recent decisions: ${recent}`);
    }
    const ro = cache.repo_orientation;
    if (typeof ro["revision"] === "number") {
        lines.push(`Graph revision: ${ro["revision"]}`);
    }
    return lines.join("\n");
}
function formatVerboseBriefing(cache) {
    return `${formatBriefing(cache)}\n\n${JSON.stringify(cache, null, 2)}`;
}
// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    // Consume stdin (required; we don't use the payload for this hook)
    for await (const _chunk of process.stdin) {
        // drain
    }
    if (IX_HOOK_VERBOSITY === "silent") {
        process.exit(0);
    }
    // Health gate — exit silently if ix is not available
    const healthy = await checkHealth();
    if (!healthy) {
        process.exit(0);
    }
    const cache = await withCache("briefing", BRIEFING_TTL_MS, async () => {
        const result = await runIx(["briefing"], { timeout: 9_000 });
        // Left gating on the exit code, unlike the other hooks: `briefing` is a Pro
        // command, so on an OSS install the failure IS the answer and there is no
        // body worth reading. Throwing here is what keeps the briefing out of the
        // cache and the hook silent.
        if (!result.ok) {
            throw new Error(result.stderr || "ix briefing failed");
        }
        const raw = parseIxJson(result.stdout);
        const goals = Array.isArray(raw.activeGoals) ? raw.activeGoals : [];
        const plans = Array.isArray(raw.activePlans) ? raw.activePlans : [];
        const decisions = Array.isArray(raw.recentDecisions) ? raw.recentDecisions : [];
        return {
            generated_at: new Date().toISOString(),
            ttl_seconds: BRIEFING_TTL_MS / 1000,
            goals,
            plans,
            decisions,
            repo_orientation: {
                revision: typeof raw.revision === "number" ? raw.revision : null,
                last_ingest_at: raw.lastIngestAt ?? raw.freshness?.lastIngestAt ?? null,
            },
        };
    }).catch(() => null);
    if (cache === null) {
        process.exit(0);
    }
    // Only inject if there is meaningful Pro content
    const hasContent = cache.goals.length > 0 || cache.plans.length > 0 || cache.decisions.length > 0;
    if (!hasContent) {
        process.exit(0);
    }
    const context = IX_HOOK_VERBOSITY === "verbose"
        ? formatVerboseBriefing(cache)
        : formatBriefing(cache);
    // Cursor beforeSubmitPrompt response.
    // `additional_context` is the field used by sessionStart and postToolUse for
    // context injection; we include it here as the closest equivalent to Claude
    // Code's `additionalContext`. `continue: true` ensures we never block the prompt.
    // Note: exact field support in beforeSubmitPrompt needs local verification.
    process.stdout.write(JSON.stringify({
        continue: true,
        additional_context: context,
    }));
    process.exit(0);
}
main().catch(() => {
    // Any uncaught failure — exit silently, never block the prompt
    process.exit(0);
});
//# sourceMappingURL=prompt-briefing.js.map