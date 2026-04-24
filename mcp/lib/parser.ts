import { stripHeader } from "./cli.js";
import { containsSecret, redactSecrets } from "../shared/secrets.js";

export interface Evidence {
  kind: "graph" | "symbol" | "file";
  id?: string;
  name?: string;
}

export interface ToolResultOk {
  ok: true;
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  data: unknown;
  evidence?: Evidence[];
  timing_ms?: number;
}

export interface ToolResultErr {
  ok: false;
  tool: string;
  input: Record<string, unknown>;
  error: {
    code: string;
    message: string;
  };
}

export type ToolResult = ToolResultOk | ToolResultErr;

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

// ── Envelope builders ─────────────────────────────────────────────────────────

export function wrapOk(
  tool: string,
  input: Record<string, unknown>,
  data: unknown,
  summary: string,
  evidence?: Evidence[],
  durationMs?: number,
): ToolResult {
  const result: ToolResultOk = { ok: true, tool, input, summary, data };
  if (evidence !== undefined) result.evidence = evidence;
  if (durationMs !== undefined) result.timing_ms = durationMs;
  return result;
}

export function wrapErr(
  tool: string,
  input: Record<string, unknown>,
  err: { code: string; message: string },
): ToolResult {
  return { ok: false, tool, input, error: { code: err.code, message: err.message } };
}

// ── JSON parser ───────────────────────────────────────────────────────────────
// Strips ix header noise, then parses JSON. Throws ParseError on failure.

function sanitizeParsedValue(value: unknown): unknown {
  if (typeof value === "string") {
    return containsSecret(value) ? redactSecrets(value) : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeParsedValue(entry));
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).map(([key, entry]) => [key, sanitizeParsedValue(entry)]);
    return Object.fromEntries(entries);
  }

  return value;
}

export function parseIxJson(raw: string): unknown {
  const cleaned = stripHeader(raw).trim();
  if (!cleaned) {
    throw new ParseError("ix produced no JSON output");
  }
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    return sanitizeParsedValue(parsed);
  } catch (cause) {
    throw new ParseError(
      `ix output is not valid JSON: ${cleaned.slice(0, 120)}`,
    );
  }
}
