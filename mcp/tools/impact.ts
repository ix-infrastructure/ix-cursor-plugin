import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { runIx } from "../lib/cli.js";
import { parseIxJson, type ToolResult, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool, type ToolInput } from "./base.js";

const TOOL_NAME = "ix_impact";

const inputSchema = {
  target: z.string().min(1, "target is required"),
};

type ImpactInput = ToolInput<typeof inputSchema>;

interface ImpactRaw {
  resolvedTarget?: { kind?: string; name?: string; path?: string };
  riskLevel?: string;
  riskCategory?: string;
  riskSummary?: string;
  atRiskBehavior?: string[];
  nextStep?: string;
  summary?: {
    members?: number;
    directImporters?: number;
    directDependents?: number;
    memberLevelCallers?: number;
  };
  topImpactedMembers?: Array<{
    name?: string;
    kind?: string;
    id?: string;
    callerCount?: number;
  }>;
}

// Maps raw riskLevel → SPEC recommended_action
function toRecommendedAction(riskLevel: string): string {
  switch (riskLevel) {
    case "low":
      return "safe_to_proceed";
    case "medium":
      return "review_callers_first";
    case "high":
    case "critical":
      return "needs_change_plan";
    default:
      return "safe_to_proceed";
  }
}

export function register(server: McpServer): void {
  registerIxTool(server, {
    name: TOOL_NAME,
    description:
      "Analyze the blast radius of a symbol or file — returns risk_level, dependents, hotspots, and recommended_action",
    schema: inputSchema,
    handler: runImpact,
  });
}

async function runImpact(input: ImpactInput): Promise<ToolResult> {
  const result = await runIx(["impact", input.target]);
  if (!result.ok) {
    return wrapErr(TOOL_NAME, input, {
      code: "IX_IMPACT_FAILED",
      message: formatCommandFailure(result.stderr, "ix impact"),
    });
  }

  const raw = parseIxJson(result.stdout) as ImpactRaw;
  const riskLevel = raw.riskLevel ?? "unknown";
  const summary = raw.summary ?? {};

  // Use the higher of directDependents vs memberLevelCallers, matching pre-edit hook logic
  const directDependents = summary.directDependents ?? 0;
  const memberLevelCallers = summary.memberLevelCallers ?? 0;
  const effectiveDependents = Math.max(directDependents, memberLevelCallers);

  const hotspots = (raw.topImpactedMembers ?? [])
    .slice(0, 5)
    .map((m) => m.name ?? "")
    .filter(Boolean);

  return wrapOk(
    TOOL_NAME,
    input,
    {
      // SPEC RiskResult contract
      risk_level: riskLevel,
      summary: raw.riskSummary ?? null,
      dependents: effectiveDependents,
      hotspots,
      recommended_action: toRecommendedAction(riskLevel),
      // Extended fields for pre-edit hook and skills
      risk_category: raw.riskCategory ?? null,
      at_risk_behavior: raw.atRiskBehavior ?? [],
      next_step: raw.nextStep ?? null,
      resolved_target: raw.resolvedTarget
        ? {
            kind: raw.resolvedTarget.kind ?? null,
            name: raw.resolvedTarget.name ?? null,
            path: raw.resolvedTarget.path ?? null,
          }
        : null,
      raw_summary: {
        members: summary.members ?? 0,
        direct_importers: summary.directImporters ?? 0,
        direct_dependents: directDependents,
        member_level_callers: memberLevelCallers,
      },
    },
    summarizeImpact(riskLevel, raw.riskSummary, effectiveDependents),
    undefined,
    result.durationMs,
  );
}

function summarizeImpact(riskLevel: string, riskSummary: string | undefined, dependents: number): string {
  const summary = riskSummary ?? `${dependents} dependents`;
  return `Risk: ${riskLevel} — ${summary}`;
}

function formatCommandFailure(stderr: string, command: string): string {
  const detail = stderr.trim();
  if (detail.length === 0) {
    return `${command} failed without returning usable output.`;
  }
  return `${command} failed: ${detail}`;
}
