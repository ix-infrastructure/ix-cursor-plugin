import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { runIx } from "../lib/cli.js";
import { parseIxJson, type ToolResult, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool, type ToolInput } from "./base.js";

const TOOL_NAME = "ix_explain";

const inputSchema = {
  symbol: z.string().min(1, "symbol is required"),
};

type ExplainInput = ToolInput<typeof inputSchema>;

interface ExplainRaw {
  resolvedTarget?: {
    id?: string;
    kind?: string;
    name?: string;
    path?: string;
  };
  facts?: {
    id?: string;
    name?: string;
    kind?: string;
    path?: string;
    container?: { kind?: string; name?: string };
    members?: string[];
    memberCount?: number;
    callerCount?: number;
    calleeCount?: number;
    dependentCount?: number;
    importerCount?: number;
    topCallers?: string[];
    topDependents?: string[];
    stale?: boolean;
  };
  role?: {
    role?: string;
    confidence?: string;
    reasons?: string[];
  };
  importance?: {
    level?: string;
    category?: string;
    reasons?: string[];
  };
  rendered?: {
    explanation?: string;
    context?: string;
    usedBy?: string;
    whyItMatters?: string;
    notes?: string[];
  };
}

export function register(server: McpServer): void {
  registerIxTool(server, {
    name: TOOL_NAME,
    description: "Explain a symbol's role, importance, callers, and callees using graph data",
    schema: inputSchema,
    handler: runExplain,
  });
}

async function runExplain(input: ExplainInput): Promise<ToolResult> {
  const result = await runIx(["explain", input.symbol]);
  if (!result.ok) {
    return wrapErr(TOOL_NAME, input, {
      code: "IX_EXPLAIN_FAILED",
      message: formatCommandFailure(result.stderr, "ix explain"),
    });
  }

  const raw = parseIxJson(result.stdout) as ExplainRaw;
  const target = raw.resolvedTarget;
  const facts = raw.facts;
  const rendered = raw.rendered;

  return wrapOk(
    TOOL_NAME,
    input,
    {
      resolved_target: target
        ? {
            id: target.id ?? null,
            kind: target.kind ?? null,
            name: target.name ?? null,
            path: target.path ?? null,
          }
        : null,
      facts: facts
        ? {
            id: facts.id ?? null,
            name: facts.name ?? null,
            kind: facts.kind ?? null,
            path: facts.path ?? null,
            container: facts.container ?? null,
            members: facts.members ?? [],
            member_count: facts.memberCount ?? 0,
            caller_count: facts.callerCount ?? 0,
            callee_count: facts.calleeCount ?? 0,
            dependent_count: facts.dependentCount ?? 0,
            importer_count: facts.importerCount ?? 0,
            top_callers: facts.topCallers ?? [],
            top_dependents: facts.topDependents ?? [],
            stale: facts.stale ?? false,
          }
        : null,
      role: raw.role
        ? {
            role: raw.role.role ?? null,
            confidence: raw.role.confidence ?? null,
            reasons: raw.role.reasons ?? [],
          }
        : null,
      importance: raw.importance
        ? {
            level: raw.importance.level ?? null,
            category: raw.importance.category ?? null,
            reasons: raw.importance.reasons ?? [],
          }
        : null,
      rendered: rendered
        ? {
            explanation: rendered.explanation ?? null,
            context: rendered.context ?? null,
            used_by: rendered.usedBy ?? null,
            why_it_matters: rendered.whyItMatters ?? null,
            notes: rendered.notes ?? [],
          }
        : null,
    },
    summarizeExplain(raw),
    undefined,
    result.durationMs,
  );
}

function summarizeExplain(raw: ExplainRaw): string {
  const name = raw.resolvedTarget?.name ?? raw.facts?.name ?? "symbol";
  const explanation = raw.rendered?.explanation;
  if (explanation) {
    return explanation;
  }
  const importanceLevel = raw.importance?.level;
  return importanceLevel ? `${name} — ${importanceLevel} importance` : `Explained ${name}`;
}

function formatCommandFailure(stderr: string, command: string): string {
  const detail = stderr.trim();
  if (detail.length === 0) {
    return `${command} failed without returning usable output.`;
  }
  return `${command} failed: ${detail}`;
}
