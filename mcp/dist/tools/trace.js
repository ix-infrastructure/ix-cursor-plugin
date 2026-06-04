import { z } from "zod";
import { runIx } from "../lib/cli.js";
import { tryLlm } from "../lib/llm.js";
import { parseIxJson, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool } from "./base.js";
const TOOL_NAME = "ix_trace";
const inputSchema = {
    symbol: z.string().min(1, "symbol is required"),
    to: z.string().min(1).optional(),
};
export function register(server) {
    registerIxTool(server, {
        name: TOOL_NAME,
        description: "Trace execution paths through a symbol — upstream callers and downstream callees",
        schema: inputSchema,
        handler: runTrace,
    });
}
async function runTrace(input) {
    const args = ["trace", input.symbol];
    if (input.to) {
        args.push("--to", input.to);
    }
    const fast = await tryLlm(TOOL_NAME, args, input);
    if (fast)
        return fast;
    const result = await runIx(args);
    if (!result.ok) {
        return wrapErr(TOOL_NAME, input, {
            code: "IX_TRACE_FAILED",
            message: formatCommandFailure(result.stderr, "ix trace"),
        });
    }
    const raw = parseIxJson(result.stdout);
    const upstream = raw.upstream ?? {};
    const downstream = raw.downstream ?? {};
    return wrapOk(TOOL_NAME, input, {
        mode: raw.mode ?? null,
        target: raw.target
            ? {
                name: raw.target.name ?? null,
                kind: raw.target.kind ?? null,
                path: raw.target.path ?? null,
            }
            : null,
        direction: raw.direction ?? null,
        upstream: {
            tree: upstream.tree ?? [],
            summary: {
                nodes_visited: upstream.summary?.nodes_visited ?? 0,
                max_depth: upstream.summary?.max_depth ?? 0,
            },
        },
        downstream: {
            tree: downstream.tree ?? [],
            summary: {
                nodes_visited: downstream.summary?.nodes_visited ?? 0,
                max_depth: downstream.summary?.max_depth ?? 0,
            },
        },
    }, summarizeTrace(raw), undefined, result.durationMs);
}
function summarizeTrace(raw) {
    const name = raw.target?.name ?? "symbol";
    const upNodes = raw.upstream?.summary?.nodes_visited ?? 0;
    const downNodes = raw.downstream?.summary?.nodes_visited ?? 0;
    if (upNodes === 0 && downNodes === 0) {
        return `No trace paths found for ${name}`;
    }
    return `Traced ${name}: ${upNodes} upstream nodes, ${downNodes} downstream nodes`;
}
function formatCommandFailure(stderr, command) {
    const detail = stderr.trim();
    if (detail.length === 0) {
        return `${command} failed without returning usable output.`;
    }
    return `${command} failed: ${detail}`;
}
//# sourceMappingURL=trace.js.map