import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { runIx } from "../lib/cli.js";
import { parseIxJson, type ToolResult, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool, type ToolInput } from "./base.js";

const DECISIONS_TOOL = "ix_decisions";
const HISTORY_TOOL = "ix_history";

const decisionsSchema = {
  path: z.string().min(1).optional(),
};

const historySchema = {
  target: z.string().min(1, "target is required"),
};

type DecisionsInput = ToolInput<typeof decisionsSchema>;
type HistoryInput = ToolInput<typeof historySchema>;

interface DecisionItem {
  id?: string;
  kind?: string;
  name?: string;
  attrs?: {
    rationale?: string;
    created_at?: string;
  };
  createdRev?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface HistoryRaw {
  resolvedTarget?: {
    kind?: string;
    name?: string;
    path?: string;
  };
  patches?: Array<{
    id?: string;
    rev?: number;
    summary?: string;
    created_at?: string;
  }>;
}

export function register(server: McpServer): void {
  registerIxTool(server, {
    name: DECISIONS_TOOL,
    description: "List architecture decisions recorded in the graph, optionally scoped to a path",
    schema: decisionsSchema,
    handler: runDecisions,
  });

  registerIxTool(server, {
    name: HISTORY_TOOL,
    description: "Show the provenance/patch history for a file or symbol",
    schema: historySchema,
    handler: runHistory,
  });
}

async function runDecisions(input: DecisionsInput): Promise<ToolResult> {
  const args = ["decisions"];
  if (input.path) {
    args.push("--path", input.path);
  }

  const result = await runIx(args);
  if (!result.ok) {
    return wrapErr(DECISIONS_TOOL, input, {
      code: "IX_DECISIONS_FAILED",
      message: formatCommandFailure(result.stderr, "ix decisions"),
    });
  }

  const raw = parseIxJson(result.stdout);
  const items = Array.isArray(raw) ? (raw as DecisionItem[]) : [];
  const normalized = items.map((d) => ({
    id: d.id ?? null,
    name: d.name ?? null,
    rationale: d.attrs?.rationale ?? null,
    created_at: d.attrs?.created_at ?? d.createdAt ?? null,
    created_rev: d.createdRev ?? null,
  }));

  return wrapOk(
    DECISIONS_TOOL,
    input,
    { decisions: normalized, total: normalized.length },
    normalized.length === 0
      ? "No architecture decisions found"
      : `Found ${normalized.length} architecture decision${normalized.length === 1 ? "" : "s"}`,
    undefined,
    result.durationMs,
  );
}

async function runHistory(input: HistoryInput): Promise<ToolResult> {
  const result = await runIx(["history", input.target]);
  if (!result.ok) {
    return wrapErr(HISTORY_TOOL, input, {
      code: "IX_HISTORY_FAILED",
      message: formatCommandFailure(result.stderr, "ix history"),
    });
  }

  const raw = parseIxJson(result.stdout) as HistoryRaw;
  const patches = Array.isArray(raw.patches) ? raw.patches : [];
  const normalized = patches.map((p) => ({
    id: p.id ?? null,
    rev: p.rev ?? null,
    summary: p.summary ?? null,
    created_at: p.created_at ?? null,
  }));

  return wrapOk(
    HISTORY_TOOL,
    input,
    {
      resolved_target: raw.resolvedTarget
        ? {
            kind: raw.resolvedTarget.kind ?? null,
            name: raw.resolvedTarget.name ?? null,
            path: raw.resolvedTarget.path ?? null,
          }
        : null,
      patches: normalized,
      total: normalized.length,
    },
    normalized.length === 0
      ? `No history found for ${input.target}`
      : `${normalized.length} patch${normalized.length === 1 ? "" : "es"} in history for ${input.target}`,
    undefined,
    result.durationMs,
  );
}

function formatCommandFailure(stderr: string, command: string): string {
  const detail = stderr.trim();
  if (detail.length === 0) {
    return `${command} failed without returning usable output.`;
  }
  return `${command} failed: ${detail}`;
}
