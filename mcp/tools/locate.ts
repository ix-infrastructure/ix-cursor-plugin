import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { runIx } from "../lib/cli.js";
import { parseIxJson, type ToolResult, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool, type ToolInput } from "./base.js";

const TOOL_NAME = "ix_locate";
const inputSchema = {
  symbol: z.string().min(1, "symbol is required"),
};

type LocateInput = ToolInput<typeof inputSchema>;

interface LocateRaw {
  resolvedTarget?: {
    id?: string;
    kind?: string;
    name?: string;
    path?: string;
  };
  resolutionMode?: string;
  lineRange?: {
    start?: number;
    end?: number;
  };
  systemPath?: Array<{
    name?: string;
    kind?: string;
  }>;
  hasMapData?: boolean;
  diagnostics?: string[];
}

export function register(server: McpServer): void {
  registerIxTool(server, {
    name: TOOL_NAME,
    description: "Resolve a symbol to its canonical graph-backed target",
    schema: inputSchema,
    handler: runLocate,
  });
}

async function runLocate(input: LocateInput): Promise<ToolResult> {
  const result = await runIx(["locate", input.symbol]);
  if (!result.ok) {
    return wrapErr(TOOL_NAME, input, {
      code: "IX_LOCATE_FAILED",
      message: formatCommandFailure(result.stderr, "ix locate"),
    });
  }

  const raw = parseIxJson(result.stdout) as LocateRaw;
  const target = raw.resolvedTarget;
  const lineRange = raw.lineRange ?? {};
  const diagnostics = Array.isArray(raw.diagnostics) ? raw.diagnostics : [];

  if (!target) {
    return wrapOk(
      TOOL_NAME,
      input,
      {
        match: null,
        resolution_mode: raw.resolutionMode ?? null,
        system_path: Array.isArray(raw.systemPath) ? raw.systemPath : [],
        has_map_data: raw.hasMapData ?? false,
        diagnostics,
      },
      `No graph-backed match found for ${input.symbol}`,
      undefined,
      result.durationMs,
    );
  }

  return wrapOk(
    TOOL_NAME,
    input,
    {
      match: {
        id: target.id ?? null,
        kind: target.kind ?? null,
        name: target.name ?? null,
        path: target.path ?? null,
        line_start: lineRange.start ?? null,
        line_end: lineRange.end ?? null,
      },
      resolution_mode: raw.resolutionMode ?? null,
      system_path: Array.isArray(raw.systemPath) ? raw.systemPath : [],
      has_map_data: raw.hasMapData ?? false,
      diagnostics,
    },
    summarizeLocate(target),
    undefined,
    result.durationMs,
  );
}

function summarizeLocate(target: NonNullable<LocateRaw["resolvedTarget"]>): string {
  const name = target.name ?? "symbol";
  const path = target.path ?? "unknown path";
  return `Resolved ${name} to ${path}`;
}

function formatCommandFailure(stderr: string, command: string): string {
  const detail = stderr.trim();
  if (detail.length === 0) {
    return `${command} failed without returning usable output.`;
  }

  return `${command} failed: ${detail}`;
}
