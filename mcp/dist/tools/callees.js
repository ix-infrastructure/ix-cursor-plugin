import { z } from "zod";
import { runIx } from "../lib/cli.js";
import { parseIxJson, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool } from "./base.js";
const CALLEES_TOOL = "ix_callees";
const IMPORTS_TOOL = "ix_imports";
const symbolSchema = {
    symbol: z.string().min(1, "symbol is required"),
};
export function register(server) {
    registerIxTool(server, {
        name: CALLEES_TOOL,
        description: "List entities called by a symbol (outgoing call edges)",
        schema: symbolSchema,
        handler: (input) => runRelation(CALLEES_TOOL, ["callees", input.symbol], input),
    });
    registerIxTool(server, {
        name: IMPORTS_TOOL,
        description: "List symbols or files imported by a given symbol (outgoing import edges)",
        schema: symbolSchema,
        handler: (input) => runRelation(IMPORTS_TOOL, ["imports", input.symbol], input),
    });
}
async function runRelation(toolName, args, input) {
    const result = await runIx(args);
    if (!result.ok) {
        return wrapErr(toolName, input, {
            code: `${toolName.toUpperCase()}_FAILED`,
            message: formatCommandFailure(result.stderr, `ix ${args[0]}`),
        });
    }
    const raw = parseIxJson(result.stdout);
    const results = Array.isArray(raw.results) ? raw.results : [];
    const normalizedResults = results.map((r) => ({
        name: r.name ?? null,
        kind: r.kind ?? null,
        id: r.id ?? null,
        path: r.path ?? null,
    }));
    const resolvedTarget = raw.resolvedTarget;
    const summaryData = raw.summary ?? {};
    const total = summaryData.total ?? normalizedResults.length;
    return wrapOk(toolName, input, {
        results: normalizedResults,
        total,
        resolved_target: resolvedTarget
            ? {
                id: resolvedTarget.id ?? null,
                kind: resolvedTarget.kind ?? null,
                name: resolvedTarget.name ?? null,
                path: resolvedTarget.path ?? null,
                resolution_mode: resolvedTarget.resolutionMode ?? null,
            }
            : null,
        result_source: raw.resultSource ?? null,
        diagnostics: Array.isArray(raw.diagnostics)
            ? raw.diagnostics.map((d) => ({ code: d.code ?? null, message: d.message ?? null }))
            : [],
    }, summarizeRelation(toolName, input.symbol, total), undefined, result.durationMs);
}
function summarizeRelation(toolName, symbol, total) {
    const verb = toolName === IMPORTS_TOOL ? "imports" : "callees";
    if (total === 0) {
        return `No ${verb} found for ${symbol}`;
    }
    return `Found ${total} ${verb} for ${symbol}`;
}
function formatCommandFailure(stderr, command) {
    const detail = stderr.trim();
    if (detail.length === 0) {
        return `${command} failed without returning usable output.`;
    }
    return `${command} failed: ${detail}`;
}
//# sourceMappingURL=callees.js.map