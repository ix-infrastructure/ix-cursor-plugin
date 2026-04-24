import { z } from "zod";
import { runIx } from "../lib/cli.js";
import { parseIxJson, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool } from "./base.js";
const MAP_TOOL = "ix_map";
const OVERVIEW_TOOL = "ix_overview";
const READ_TOOL = "ix_read";
const DIFF_TOOL = "ix_diff";
const mapSchema = {
    file: z.string().min(1).optional(),
};
const overviewSchema = {
    target: z.string().min(1, "target is required"),
};
const readSchema = {
    symbol: z.string().min(1, "symbol is required"),
};
const diffSchema = {
    from_rev: z.number().int().positive("from_rev must be a positive integer"),
    to_rev: z.number().int().positive("to_rev must be a positive integer"),
    target: z.string().min(1).optional(),
    summary: z.boolean().optional(),
};
export function register(server) {
    registerIxTool(server, {
        name: MAP_TOOL,
        description: "Ingest a file into the graph (ix map <file>) or run a full architecture map (ix map). Used by the post-edit hook.",
        schema: mapSchema,
        handler: runMap,
    });
    registerIxTool(server, {
        name: OVERVIEW_TOOL,
        description: "Return a structural overview of a symbol or file — children, key items, and hierarchy position",
        schema: overviewSchema,
        handler: runOverview,
    });
    registerIxTool(server, {
        name: READ_TOOL,
        description: "Read the source content of a symbol via the graph (bounds raw file reads to graph-known symbols)",
        schema: readSchema,
        handler: runRead,
    });
    registerIxTool(server, {
        name: DIFF_TOOL,
        description: "Show the structural diff between two graph revisions, optionally scoped to a file or symbol",
        schema: diffSchema,
        handler: runDiff,
    });
}
async function runMap(input) {
    const args = input.file ? ["map", input.file] : ["map"];
    const result = await runIx(args);
    if (!result.ok) {
        return wrapErr(MAP_TOOL, input, {
            code: "IX_MAP_FAILED",
            message: formatCommandFailure(result.stderr, "ix map"),
        });
    }
    // ix map output varies (text-heavy); wrap raw stdout as summary
    let data;
    try {
        data = parseIxJson(result.stdout);
    }
    catch {
        data = { raw: result.stdout.trim() };
    }
    const summary = input.file
        ? `Ingested ${input.file} into graph`
        : "Full graph map completed";
    return wrapOk(MAP_TOOL, input, data, summary, undefined, result.durationMs);
}
async function runOverview(input) {
    const result = await runIx(["overview", input.target]);
    if (!result.ok) {
        return wrapErr(OVERVIEW_TOOL, input, {
            code: "IX_OVERVIEW_FAILED",
            message: formatCommandFailure(result.stderr, "ix overview"),
        });
    }
    const raw = parseIxJson(result.stdout);
    return wrapOk(OVERVIEW_TOOL, input, {
        resolved_target: raw.resolvedTarget
            ? {
                id: raw.resolvedTarget.id ?? null,
                kind: raw.resolvedTarget.kind ?? null,
                name: raw.resolvedTarget.name ?? null,
            }
            : null,
        path: raw.path ?? null,
        resolution_mode: raw.resolutionMode ?? null,
        system_path: Array.isArray(raw.systemPath) ? raw.systemPath : [],
        has_map_data: raw.hasMapData ?? false,
        children_by_kind: raw.childrenByKind ?? {},
        key_items: Array.isArray(raw.keyItems) ? raw.keyItems : [],
        contained_in: raw.containedIn ?? null,
        diagnostics: Array.isArray(raw.diagnostics) ? raw.diagnostics : [],
    }, summarizeOverview(raw), undefined, result.durationMs);
}
async function runRead(input) {
    const result = await runIx(["read", input.symbol]);
    if (!result.ok) {
        return wrapErr(READ_TOOL, input, {
            code: "IX_READ_FAILED",
            message: formatCommandFailure(result.stderr, "ix read"),
        });
    }
    const raw = parseIxJson(result.stdout);
    return wrapOk(READ_TOOL, input, {
        target_type: raw.targetType ?? null,
        path: raw.path ?? null,
        line_start: raw.lineStart ?? null,
        line_end: raw.lineEnd ?? null,
        content: raw.content ?? null,
        symbol: raw.symbol ?? null,
        kind: raw.kind ?? null,
    }, raw.path
        ? `Read ${raw.symbol ?? input.symbol} from ${raw.path} (lines ${raw.lineStart}–${raw.lineEnd})`
        : `Read ${input.symbol}`, undefined, result.durationMs);
}
async function runDiff(input) {
    const args = ["diff", String(input.from_rev), String(input.to_rev)];
    if (input.target) {
        args.push(input.target);
    }
    if (input.summary) {
        args.push("--summary");
    }
    const result = await runIx(args);
    if (!result.ok) {
        return wrapErr(DIFF_TOOL, input, {
            code: "IX_DIFF_FAILED",
            message: formatCommandFailure(result.stderr, "ix diff"),
        });
    }
    const raw = parseIxJson(result.stdout);
    const summary = raw.summary ?? {};
    return wrapOk(DIFF_TOOL, input, {
        from_rev: raw.fromRev ?? input.from_rev,
        to_rev: raw.toRev ?? input.to_rev,
        total: raw.total ?? 0,
        summary: {
            added: summary.added ?? 0,
            modified: summary.modified ?? 0,
            removed: summary.removed ?? 0,
        },
        changes: raw.changes ?? [],
    }, summarizeDiff(raw), undefined, result.durationMs);
}
function summarizeOverview(raw) {
    const name = raw.resolvedTarget?.name ?? "symbol";
    const kind = raw.resolvedTarget?.kind ?? "entity";
    const childCount = Object.values(raw.childrenByKind ?? {}).reduce((a, b) => a + b, 0);
    return childCount > 0
        ? `Overview of ${kind} ${name} (${childCount} children)`
        : `Overview of ${kind} ${name}`;
}
function summarizeDiff(raw) {
    const s = raw.summary;
    if (!s) {
        return `Diff rev ${raw.fromRev} → ${raw.toRev}: ${raw.total ?? 0} changes`;
    }
    return `Diff rev ${raw.fromRev} → ${raw.toRev}: +${s.added ?? 0} ~${s.modified ?? 0} -${s.removed ?? 0}`;
}
function formatCommandFailure(stderr, command) {
    const detail = stderr.trim();
    if (detail.length === 0) {
        return `${command} failed without returning usable output.`;
    }
    return `${command} failed: ${detail}`;
}
//# sourceMappingURL=map.js.map