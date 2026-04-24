import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { checkHealth, runIx } from "../lib/cli.js";
import { TIMEOUT_HEALTH_MS } from "../lib/config.js";
import { parseIxJson, type ToolResult, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool, type ToolInput } from "./base.js";

const TOOL_NAME = "ix_health";
const inputSchema = {};

type HealthInput = ToolInput<typeof inputSchema>;

export function register(server: McpServer): void {
  registerIxTool(server, {
    name: TOOL_NAME,
    description: "Check whether the ix CLI is available and the graph is ready",
    schema: inputSchema,
    handler: runHealthCheck,
  });
}

async function runHealthCheck(input: HealthInput): Promise<ToolResult> {
  const isHealthy = await checkHealth();

  if (!isHealthy) {
    return wrapErr(TOOL_NAME, input, {
      code: "IX_NOT_FOUND",
      message: "ix CLI not found. Install it and ensure it is on PATH.",
    });
  }

  const result = await runIx(["--version"], { timeout: TIMEOUT_HEALTH_MS });
  if (!result.ok) {
    return wrapErr(TOOL_NAME, input, {
      code: "IX_HEALTH_PROBE_FAILED",
      message: formatProbeFailure(result.stderr),
    });
  }

  const version = extractVersion(result.stdout);
  return wrapOk(
    TOOL_NAME,
    input,
    {
      version,
      graph_ready: true,
    },
    `ix ${version} is available`,
    undefined,
    result.durationMs,
  );
}

function extractVersion(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "unknown";
  }

  try {
    const parsed = parseIxJson(trimmed) as Record<string, unknown>;
    const candidate = parsed["version"];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  } catch {
    // ix currently prints plain text here; keep the parser tolerant.
  }

  return trimmed.split(/\s+/)[0] ?? "unknown";
}

function formatProbeFailure(stderr: string): string {
  const detail = stderr.trim();
  if (detail.length === 0) {
    return "ix health probe failed while checking the installed version.";
  }

  return `ix health probe failed: ${detail}`;
}
