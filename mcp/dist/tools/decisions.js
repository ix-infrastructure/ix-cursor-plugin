import { z } from "zod";
import { runIx } from "../lib/cli.js";
import { tryLlm } from "../lib/llm.js";
import { parseIxJson, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool } from "./base.js";
const DECISIONS_TOOL = "ix_decisions";
const HISTORY_TOOL = "ix_history";
const decisionsSchema = {
    path: z.string().min(1).optional(),
};
const historySchema = {
    target: z.string().min(1, "target is required"),
};
export function register(server) {
    registerIxTool(server, {
        name: DECISIONS_TOOL,
        description: "List architecture decisions recorded in the graph, optionally scoped to a path",
        schema: decisionsSchema,
        handler: runDecisions,
    });
    registerIxTool(server, {
        name: HISTORY_TOOL,
        description: "Show the provenance/patch history for a file or symbol",
        schema: historySchema,
        handler: runHistory,
    });
}
async function runDecisions(input) {
    const args = ["decisions"];
    if (input.path) {
        args.push("--path", input.path);
    }
    const result = await runIx(args);
    if (!result.ok) {
        return wrapErr(DECISIONS_TOOL, input, {
            code: "IX_DECISIONS_FAILED",
            message: formatCommandFailure(result.stderr, "ix decisions"),
        });
    }
    const raw = parseIxJson(result.stdout);
    const items = Array.isArray(raw) ? raw : [];
    const normalized = items.map((d) => ({
        id: d.id ?? null,
        name: d.name ?? null,
        rationale: d.attrs?.rationale ?? null,
        created_at: d.attrs?.created_at ?? d.createdAt ?? null,
        created_rev: d.createdRev ?? null,
    }));
    return wrapOk(DECISIONS_TOOL, input, { decisions: normalized, total: normalized.length }, normalized.length === 0
        ? "No architecture decisions found"
        : `Found ${normalized.length} architecture decision${normalized.length === 1 ? "" : "s"}`, undefined, result.durationMs);
}
async function runHistory(input) {
    const args = ["history", input.target];
    const fast = await tryLlm(HISTORY_TOOL, args, input);
    if (fast)
        return fast;
    const result = await runIx(args);
    if (!result.ok) {
        return wrapErr(HISTORY_TOOL, input, {
            code: "IX_HISTORY_FAILED",
            message: formatCommandFailure(result.stderr, "ix history"),
        });
    }
    const raw = parseIxJson(result.stdout);
    const patches = Array.isArray(raw.patches) ? raw.patches : [];
    const normalized = patches.map((p) => ({
        id: p.id ?? null,
        rev: p.rev ?? null,
        summary: p.summary ?? null,
        created_at: p.created_at ?? null,
    }));
    return wrapOk(HISTORY_TOOL, input, {
        resolved_target: raw.resolvedTarget
            ? {
                kind: raw.resolvedTarget.kind ?? null,
                name: raw.resolvedTarget.name ?? null,
                path: raw.resolvedTarget.path ?? null,
            }
            : null,
        patches: normalized,
        total: normalized.length,
    }, normalized.length === 0
        ? `No history found for ${input.target}`
        : `${normalized.length} patch${normalized.length === 1 ? "" : "es"} in history for ${input.target}`, undefined, result.durationMs);
}
function formatCommandFailure(stderr, command) {
    const detail = stderr.trim();
    if (detail.length === 0) {
        return `${command} failed without returning usable output.`;
    }
    return `${command} failed: ${detail}`;
}
//# sourceMappingURL=decisions.js.map