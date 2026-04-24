import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { runIx } from "../lib/cli.js";
import { parseIxJson, type ToolResult, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool, type ToolInput } from "./base.js";

const TOOL_NAME = "ix_briefing";
const inputSchema = {};

type BriefingInput = ToolInput<typeof inputSchema>;

interface BriefingGoal {
  id?: string;
  name?: string;
}

interface BriefingPlan {
  id?: string;
  name?: string;
  nextTask?: string | null;
  taskSummary?: {
    total?: number;
    done?: number;
    pending?: number;
  };
}

interface BriefingDecision {
  id?: string;
  name?: string;
  rationale?: string;
}

interface BriefingFreshness {
  lastIngestAt?: string;
  ageMinutes?: number;
  stale?: boolean;
}

interface BriefingRaw {
  revision?: number;
  lastIngestAt?: string;
  goalCount?: number;
  activeGoals?: BriefingGoal[];
  activePlans?: BriefingPlan[];
  openBugs?: unknown[];
  recentDecisions?: BriefingDecision[];
  recentChanges?: unknown[];
  freshness?: BriefingFreshness;
}

export function register(server: McpServer): void {
  registerIxTool(server, {
    name: TOOL_NAME,
    description: "Load the ix Pro session briefing for current goals, plans, and recent decisions",
    schema: inputSchema,
    handler: runBriefing,
  });
}

async function runBriefing(input: BriefingInput): Promise<ToolResult> {
  const result = await runIx(["briefing"]);
  if (!result.ok) {
    return wrapErr(TOOL_NAME, input, {
      code: "IX_BRIEFING_FAILED",
      message: formatCommandFailure(result.stderr, "ix briefing"),
    });
  }

  const raw = parseIxJson(result.stdout) as BriefingRaw;
  const goals = Array.isArray(raw.activeGoals) ? raw.activeGoals : [];
  const plans = Array.isArray(raw.activePlans) ? raw.activePlans : [];
  const decisions = Array.isArray(raw.recentDecisions) ? raw.recentDecisions : [];
  const openBugs = Array.isArray(raw.openBugs) ? raw.openBugs : [];
  const recentChanges = Array.isArray(raw.recentChanges) ? raw.recentChanges : [];

  return wrapOk(
    TOOL_NAME,
    input,
    {
      goals,
      plans,
      decisions,
      repo_orientation: {
        revision: raw.revision ?? null,
        last_ingest_at: raw.lastIngestAt ?? raw.freshness?.lastIngestAt ?? null,
        goal_count: raw.goalCount ?? goals.length,
        open_bug_count: openBugs.length,
        recent_change_count: recentChanges.length,
        freshness: raw.freshness ?? null,
      },
    },
    `Loaded session briefing with ${goals.length} goals, ${plans.length} plans, and ${decisions.length} recent decisions`,
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
