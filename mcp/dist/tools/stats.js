import { runIx } from "../lib/cli.js";
import { tryLlm } from "../lib/llm.js";
import { parseIxJson, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool } from "./base.js";
const TOOL_NAME = "ix_stats";
const inputSchema = {};
export function register(server) {
    registerIxTool(server, {
        name: TOOL_NAME,
        description: "Return graph-wide ix statistics for files, symbols, and graph health",
        schema: inputSchema,
        handler: runStats,
    });
}
async function runStats(input) {
    const args = ["stats"];
    const fast = await tryLlm(TOOL_NAME, args, input);
    if (fast)
        return fast;
    const result = await runIx(args);
    if (!result.ok) {
        return wrapErr(TOOL_NAME, input, {
            code: "IX_STATS_FAILED",
            message: formatCommandFailure(result.stderr, "ix stats"),
        });
    }
    const raw = parseIxJson(result.stdout);
    const nodeCounts = toCountMap(raw.nodes?.byKind);
    const edgeCounts = toCountMap(raw.edges?.byPredicate);
    const fileCount = nodeCounts["file"] ?? 0;
    return wrapOk(TOOL_NAME, input, {
        symbol_counts: {
            functions: nodeCounts["function"] ?? 0,
            classes: nodeCounts["class"] ?? 0,
            interfaces: nodeCounts["interface"] ?? 0,
            methods: nodeCounts["method"] ?? 0,
            modules: nodeCounts["module"] ?? 0,
            headings: nodeCounts["heading"] ?? 0,
            sections: nodeCounts["section"] ?? 0,
        },
        file_count: fileCount,
        graph_health: {
            total_nodes: raw.nodes?.total ?? 0,
            total_edges: raw.edges?.total ?? 0,
            region_count: nodeCounts["region"] ?? 0,
            indexed: (raw.nodes?.total ?? 0) > 0 && fileCount > 0,
        },
        raw_counts: {
            nodes_by_kind: nodeCounts,
            edges_by_predicate: edgeCounts,
        },
    }, `Graph stats loaded for ${fileCount} files and ${raw.nodes?.total ?? 0} nodes`, undefined, result.durationMs);
}
function toCountMap(entries) {
    const result = {};
    for (const entry of entries ?? []) {
        if (!entry.kind) {
            continue;
        }
        result[entry.kind] = entry.count ?? 0;
    }
    return result;
}
function formatCommandFailure(stderr, command) {
    const detail = stderr.trim();
    if (detail.length === 0) {
        return `${command} failed without returning usable output.`;
    }
    return `${command} failed: ${detail}`;
}
//# sourceMappingURL=stats.js.map