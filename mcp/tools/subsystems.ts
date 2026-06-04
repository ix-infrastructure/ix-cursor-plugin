import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { runIx } from "../lib/cli.js";
import { tryLlm } from "../lib/llm.js";
import { parseIxJson, type ToolResult, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool, type ToolInput } from "./base.js";

const TOOL_NAME = "ix_subsystems";
const inputSchema = {};

type SubsystemsInput = ToolInput<typeof inputSchema>;

interface Region {
  label?: string;
  label_kind?: string;
  level?: number;
  files?: number;
  children?: number;
  parent_id?: string | null;
  confidence?: number;
  signals?: string[];
  interfaces?: number;
}

interface SubsystemsRaw {
  file_count?: number;
  region_count?: number;
  levels?: number;
  map_rev?: number;
  outcome?: string;
  regions?: Region[];
  hierarchy?: unknown;
}

export function register(server: McpServer): void {
  registerIxTool(server, {
    name: TOOL_NAME,
    description: "List graph-derived subsystems for top-level repository orientation",
    schema: inputSchema,
    handler: runSubsystems,
  });
}

async function runSubsystems(input: SubsystemsInput): Promise<ToolResult> {
  const args = ["subsystems"];

  const fast = await tryLlm(TOOL_NAME, args, input);
  if (fast) return fast;

  const result = await runIx(args);
  if (!result.ok) {
    return wrapErr(TOOL_NAME, input, {
      code: "IX_SUBSYSTEMS_FAILED",
      message: formatCommandFailure(result.stderr, "ix subsystems"),
    });
  }

  const raw = parseIxJson(result.stdout) as SubsystemsRaw;
  const regions = Array.isArray(raw.regions) ? raw.regions : [];
  const subsystems = regions.map((region) => ({
    name: region.label ?? "unknown",
    purpose: inferPurpose(region),
    files: region.files ?? 0,
    level: region.level ?? null,
    kind: region.label_kind ?? null,
    children: region.children ?? 0,
    confidence: region.confidence ?? null,
    signals: Array.isArray(region.signals) ? region.signals : [],
    interfaces: region.interfaces ?? 0,
  }));

  return wrapOk(
    TOOL_NAME,
    input,
    {
      subsystems,
      totals: {
        file_count: raw.file_count ?? 0,
        region_count: raw.region_count ?? subsystems.length,
        levels: raw.levels ?? null,
      },
      graph: {
        map_rev: raw.map_rev ?? null,
        outcome: raw.outcome ?? null,
        hierarchy: raw.hierarchy ?? null,
      },
    },
    `Loaded ${subsystems.length} subsystems from the graph`,
    undefined,
    result.durationMs,
  );
}

function inferPurpose(region: Region): string {
  const labelKind = region.label_kind ?? "region";
  const signals = Array.isArray(region.signals) ? region.signals : [];

  if (signals.length === 0) {
    return `${capitalize(labelKind)} inferred from graph clustering`;
  }

  return `${capitalize(labelKind)} inferred from ${signals.join(", ")} signals`;
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return "Unknown";
  }

  return value[0]!.toUpperCase() + value.slice(1);
}

function formatCommandFailure(stderr: string, command: string): string {
  const detail = stderr.trim();
  if (detail.length === 0) {
    return `${command} failed without returning usable output.`;
  }

  return `${command} failed: ${detail}`;
}
