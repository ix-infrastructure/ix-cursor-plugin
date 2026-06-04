import { z } from "zod";
import { runIx } from "../lib/cli.js";
import { tryLlm } from "../lib/llm.js";
import { parseIxJson, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool } from "./base.js";
const TOOL_NAME = "ix_rank";
// ix rank requires --by and --kind; expose both with sensible defaults
const inputSchema = {
    by: z
        .enum(["dependents", "callers", "importers", "members"])
        .optional(),
    kind: z
        .enum(["class", "function", "file", "interface", "module"])
        .optional(),
    top: z.number().int().positive().max(50).optional(),
    path: z.string().min(1).optional(),
};
const DEFAULT_BY = "dependents";
const DEFAULT_KIND = "class";
const DEFAULT_TOP = 10;
export function register(server) {
    registerIxTool(server, {
        name: TOOL_NAME,
        description: "Rank symbols by a quality metric (dependents, callers, importers, members) to surface hotspots",
        schema: inputSchema,
        handler: runRank,
    });
}
async function runRank(input) {
    const by = input.by ?? DEFAULT_BY;
    const kind = input.kind ?? DEFAULT_KIND;
    const top = input.top ?? DEFAULT_TOP;
    const args = ["rank", "--by", by, "--kind", kind, "--top", String(top)];
    if (input.path) {
        args.push("--path", input.path);
    }
    const fast = await tryLlm(TOOL_NAME, args, { by, kind, top, path: input.path });
    if (fast)
        return fast;
    const result = await runIx(args);
    if (!result.ok) {
        return wrapErr(TOOL_NAME, input, {
            code: "IX_RANK_FAILED",
            message: formatCommandFailure(result.stderr, "ix rank"),
        });
    }
    const raw = parseIxJson(result.stdout);
    const results = Array.isArray(raw.results) ? raw.results : [];
    const normalized = results.map((r) => ({
        name: r.name ?? null,
        kind: r.kind ?? null,
        score: r.score ?? null,
        path: r.path ?? null,
    }));
    const summary = raw.summary ?? {};
    return wrapOk(TOOL_NAME, { by, kind, top, path: input.path }, {
        metric: raw.metric ?? by,
        kind: raw.kind ?? kind,
        results: normalized,
        summary: {
            evaluated: summary.evaluated ?? 0,
            returned: summary.returned ?? normalized.length,
        },
    }, summarizeRank(by, kind, normalized.length), undefined, result.durationMs);
}
function summarizeRank(by, kind, count) {
    if (count === 0) {
        return `No ${kind} entities ranked by ${by}`;
    }
    return `Top ${count} ${kind} entities ranked by ${by}`;
}
function formatCommandFailure(stderr, command) {
    const detail = stderr.trim();
    if (detail.length === 0) {
        return `${command} failed without returning usable output.`;
    }
    return `${command} failed: ${detail}`;
}
//# sourceMappingURL=rank.js.map