import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { runIx } from "../lib/cli.js";
import { tryLlm } from "../lib/llm.js";
import { parseIxJson, type ToolResult, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool, type ToolInput } from "./base.js";

const CALLERS_TOOL = "ix_callers";
const IMPORTED_BY_TOOL = "ix_imported_by";

const symbolSchema = {
  symbol: z.string().min(1, "symbol is required"),
};

type SymbolInput = ToolInput<typeof symbolSchema>;

interface RelationResult {
  name?: string;
  kind?: string;
  id?: string;
  path?: string;
}

interface RelationRaw {
  results?: RelationResult[];
  resultSource?: string;
  resolvedTarget?: {
    id?: string;
    kind?: string;
    name?: string;
    path?: string;
    resolutionMode?: string;
  };
  summary?: {
    total?: number;
    resolved?: number;
    unresolved?: number;
  };
  diagnostics?: Array<{ code?: string; message?: string }>;
}

export function register(server: McpServer): void {
  registerIxTool(server, {
    name: CALLERS_TOOL,
    description: "List entities that call a symbol (incoming call edges)",
    schema: symbolSchema,
    handler: (input) => runRelation(CALLERS_TOOL, ["callers", input.symbol], input),
  });

  registerIxTool(server, {
    name: IMPORTED_BY_TOOL,
    description: "List files or symbols that import a given symbol (incoming import edges)",
    schema: symbolSchema,
    handler: (input) => runRelation(IMPORTED_BY_TOOL, ["imported-by", input.symbol], input),
  });
}

async function runRelation(
  toolName: string,
  args: string[],
  input: SymbolInput,
): Promise<ToolResult> {
  const fast = await tryLlm(toolName, args, input);
  if (fast) return fast;

  const result = await runIx(args);
  if (!result.ok) {
    return wrapErr(toolName, input, {
      code: `${toolName.toUpperCase()}_FAILED`,
      message: formatCommandFailure(result.stderr, `ix ${args[0]}`),
    });
  }

  const raw = parseIxJson(result.stdout) as RelationRaw;
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

  return wrapOk(
    toolName,
    input,
    {
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
    },
    summarizeRelation(toolName, input.symbol, total),
    undefined,
    result.durationMs,
  );
}

function summarizeRelation(toolName: string, symbol: string, total: number): string {
  const verb = toolName === IMPORTED_BY_TOOL ? "importers" : "callers";
  if (total === 0) {
    return `No ${verb} found for ${symbol}`;
  }
  return `Found ${total} ${verb} for ${symbol}`;
}

function formatCommandFailure(stderr: string, command: string): string {
  const detail = stderr.trim();
  if (detail.length === 0) {
    return `${command} failed without returning usable output.`;
  }
  return `${command} failed: ${detail}`;
}
