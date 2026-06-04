import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { runIx } from "../lib/cli.js";
import { tryLlm } from "../lib/llm.js";
import { parseIxJson, type ToolResult, wrapErr, wrapOk } from "../lib/parser.js";
import { registerIxTool, type ToolInput } from "./base.js";

const TOOL_NAME = "ix_text";
const DEFAULT_LIMIT = 20;

const inputSchema = {
  pattern: z.string().min(1, "pattern is required"),
  limit: z.number().int().positive().max(100).optional(),
  path: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
};

type TextInput = ToolInput<typeof inputSchema>;

interface TextHit {
  path?: string;
  line_start?: number;
  line_end?: number;
  snippet?: string;
  engine?: string;
  score?: number;
  language?: string;
}

export function register(server: McpServer): void {
  registerIxTool(server, {
    name: TOOL_NAME,
    description: "Search text across the indexed repository and return ranked hits",
    schema: inputSchema,
    handler: runText,
  });
}

async function runText(input: TextInput): Promise<ToolResult> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const args = ["text", input.pattern, "--limit", String(limit)];
  if (input.path) {
    args.push("--path", input.path);
  }
  if (input.language) {
    args.push("--language", input.language);
  }

  const fast = await tryLlm(TOOL_NAME, args, { ...input, limit });
  if (fast) return fast;

  const result = await runIx(args);
  if (!result.ok) {
    return wrapErr(TOOL_NAME, input, {
      code: "IX_TEXT_FAILED",
      message: formatCommandFailure(result.stderr, "ix text"),
    });
  }

  const raw = parseIxJson(result.stdout);
  const hits = Array.isArray(raw) ? raw as TextHit[] : [];
  const normalizedHits = hits.map((hit) => ({
    path: hit.path ?? null,
    line_start: hit.line_start ?? null,
    line_end: hit.line_end ?? null,
    snippet: hit.snippet ?? null,
    engine: hit.engine ?? null,
    score: hit.score ?? null,
    language: hit.language ?? null,
  }));

  return wrapOk(
    TOOL_NAME,
    { ...input, limit },
    {
      hits: normalizedHits,
      total: normalizedHits.length,
    },
    summarizeText(input.pattern, normalizedHits.length),
    undefined,
    result.durationMs,
  );
}

function summarizeText(pattern: string, total: number): string {
  if (total === 0) {
    return `No text hits found for ${pattern}`;
  }

  return `Found ${total} text hits for ${pattern}`;
}

function formatCommandFailure(stderr: string, command: string): string {
  const detail = stderr.trim();
  if (detail.length === 0) {
    return `${command} failed without returning usable output.`;
  }

  return `${command} failed: ${detail}`;
}
