import { z } from "zod";
import { runIx } from "../lib/cli.js";
import { tryLlm } from "../lib/llm.js";
import { parseIxJson, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool } from "./base.js";
const TOOL_NAME = "ix_inventory";
const inputSchema = {
    kind: z.string().min(1).default("file"),
    path: z.string().min(1, "path is required"),
};
export function register(server) {
    registerIxTool(server, {
        name: TOOL_NAME,
        description: "List files or symbols within a repository path scope",
        schema: inputSchema,
        handler: runInventory,
    });
}
async function runInventory(input) {
    const args = ["inventory", "--kind", input.kind, "--path", input.path];
    const fast = await tryLlm(TOOL_NAME, args, input);
    if (fast)
        return fast;
    const result = await runIx(args);
    if (!result.ok) {
        return wrapErr(TOOL_NAME, input, {
            code: "IX_INVENTORY_FAILED",
            message: formatCommandFailure(result.stderr, "ix inventory"),
        });
    }
    const raw = parseIxJson(result.stdout);
    const entries = Array.isArray(raw.byFile) ? raw.byFile : [];
    return wrapOk(TOOL_NAME, input, {
        kind: raw.kind ?? input.kind,
        scope: raw.scope ?? input.path,
        total: raw.total ?? entries.length,
        items: entries.map((entry) => ({
            path: entry.path ?? null,
            items: Array.isArray(entry.items) ? entry.items : [],
        })),
    }, summarizeInventory(raw.kind ?? input.kind, raw.total ?? entries.length, input.path), undefined, result.durationMs);
}
function summarizeInventory(kind, total, path) {
    return `Found ${total} ${kind} entries in ${path}`;
}
function formatCommandFailure(stderr, command) {
    const detail = stderr.trim();
    if (detail.length === 0) {
        return `${command} failed without returning usable output.`;
    }
    return `${command} failed: ${detail}`;
}
//# sourceMappingURL=inventory.js.map