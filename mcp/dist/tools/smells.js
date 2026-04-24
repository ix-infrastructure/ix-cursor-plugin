import { z } from "zod";
import { runIx } from "../lib/cli.js";
import { parseIxJson, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool } from "./base.js";
const TOOL_NAME = "ix_smells";
const inputSchema = {
    path: z.string().min(1).optional(),
    limit: z.number().int().positive().max(200).optional(),
};
const DEFAULT_LIMIT = 50;
export function register(server) {
    registerIxTool(server, {
        name: TOOL_NAME,
        description: "Detect code quality smells across the graph — orphan files, high coupling, etc.",
        schema: inputSchema,
        handler: runSmells,
    });
}
async function runSmells(input) {
    const args = ["smells"];
    if (input.path) {
        args.push("--path", input.path);
    }
    const result = await runIx(args);
    if (!result.ok) {
        return wrapErr(TOOL_NAME, input, {
            code: "IX_SMELLS_FAILED",
            message: formatCommandFailure(result.stderr, "ix smells"),
        });
    }
    const raw = parseIxJson(result.stdout);
    const limit = input.limit ?? DEFAULT_LIMIT;
    const allCandidates = Array.isArray(raw.candidates) ? raw.candidates : [];
    const candidates = allCandidates.slice(0, limit).map((c) => ({
        file: c.file ?? null,
        smell: c.smell ?? null,
        confidence: c.confidence ?? null,
        signals: c.signals ?? {},
    }));
    return wrapOk(TOOL_NAME, { ...input, limit }, {
        candidates,
        total: raw.count ?? allCandidates.length,
        returned: candidates.length,
        rev: raw.rev ?? null,
        run_at: raw.run_at ?? null,
        inference_version: raw.inference_version ?? null,
    }, summarizeSmells(candidates.length, raw.count ?? allCandidates.length), undefined, result.durationMs);
}
function summarizeSmells(returned, total) {
    if (total === 0) {
        return "No code smells detected";
    }
    return returned < total
        ? `Found ${total} code smells (showing ${returned})`
        : `Found ${total} code smells`;
}
function formatCommandFailure(stderr, command) {
    const detail = stderr.trim();
    if (detail.length === 0) {
        return `${command} failed without returning usable output.`;
    }
    return `${command} failed: ${detail}`;
}
//# sourceMappingURL=smells.js.map