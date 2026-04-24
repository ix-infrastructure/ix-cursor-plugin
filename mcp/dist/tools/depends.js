import { z } from "zod";
import { runIx } from "../lib/cli.js";
import { parseIxJson, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool } from "./base.js";
const TOOL_NAME = "ix_depends";
const DEFAULT_DEPTH = 2;
const inputSchema = {
    symbol: z.string().min(1, "symbol is required"),
    depth: z.number().int().min(1).max(10).optional(),
};
export function register(server) {
    registerIxTool(server, {
        name: TOOL_NAME,
        description: "Show the downstream dependency graph for a symbol up to a given depth (default 2)",
        schema: inputSchema,
        handler: runDepends,
    });
}
async function runDepends(input) {
    const depth = input.depth ?? DEFAULT_DEPTH;
    const args = ["depends", input.symbol, "--depth", String(depth)];
    const result = await runIx(args);
    if (!result.ok) {
        return wrapErr(TOOL_NAME, input, {
            code: "IX_DEPENDS_FAILED",
            message: formatCommandFailure(result.stderr, "ix depends"),
        });
    }
    const raw = parseIxJson(result.stdout);
    const traversal = raw.traversal ?? {};
    return wrapOk(TOOL_NAME, { ...input, depth }, {
        resolved_target: raw.resolvedTarget
            ? {
                name: raw.resolvedTarget.name ?? null,
                kind: raw.resolvedTarget.kind ?? null,
                path: raw.resolvedTarget.path ?? null,
            }
            : null,
        semantics: raw.semantics ?? null,
        tree: raw.tree ?? [],
        traversal: {
            nodes_visited: traversal.nodesVisited ?? 0,
            max_depth_reached: traversal.maxDepthReached ?? 0,
            truncated: traversal.truncated ?? false,
            depth_limit: traversal.depthLimit ?? depth,
        },
        diagnostics: Array.isArray(raw.diagnostics)
            ? raw.diagnostics.map((d) => ({ code: d.code ?? null, message: d.message ?? null }))
            : [],
    }, summarizeDepends(raw, depth), undefined, result.durationMs);
}
function summarizeDepends(raw, depth) {
    const name = raw.resolvedTarget?.name ?? "symbol";
    const nodes = raw.traversal?.nodesVisited ?? 0;
    const truncated = raw.traversal?.truncated ? " (truncated)" : "";
    if (nodes === 0) {
        return `No dependents found for ${name}`;
    }
    return `${name} has ${nodes} dependents at depth ${depth}${truncated}`;
}
function formatCommandFailure(stderr, command) {
    const detail = stderr.trim();
    if (detail.length === 0) {
        return `${command} failed without returning usable output.`;
    }
    return `${command} failed: ${detail}`;
}
//# sourceMappingURL=depends.js.map