#!/usr/bin/env node
// Cursor beforeShellExecution hook — intercept grep/rg calls in bash commands.
//
// Fires before any shell command executes. Detects grep or rg invocations,
// extracts the search pattern, and runs the same ix text + ix locate parallel
// flow as the pre-search hook. Always augments — never blocks bash.
//
// Contract:
//   exit 0 + JSON → inject agent_message, shell command still runs
//   exit 0 + no stdout → pass through silently

import { checkHealth, runIxParallel } from "../lib/cli.js";
import { IX_HOOK_VERBOSITY } from "../lib/config.js";
import { classifyIntent, looksLikeSecret } from "../shared/intent-classifier.js";
import { parseIxJson } from "../lib/parser.js";

// ── Payload type ──────────────────────────────────────────────────────────────

interface ShellPayload {
  command?: string;
  cwd?: string;
  sandbox?: boolean;
  // common base
  conversation_id?: string;
  generation_id?: string;
}

// ── Pattern extraction ────────────────────────────────────────────────────────
// Port of the shell pipeline in ix-bash.sh: intercept `grep` / `rg` in common
// forms including `cd src && rg Foo`, `find . | xargs grep Foo`, etc.

const GREP_CMD_RE = /(?:^|[\s;|&(])(grep|rg)\s+([\s\S]+)/;

function extractGrepPattern(command: string): string | null {
  const match = GREP_CMD_RE.exec(command);
  if (!match) return null;

  const argsStr = match[2]?.trimStart() ?? "";

  // Try: "quoted pattern" or 'quoted pattern'
  const dq = /^"([^"]+)"/.exec(argsStr);
  if (dq?.[1]) return dq[1];
  const sq = /^'([^']+)'/.exec(argsStr);
  if (sq?.[1]) return sq[1];

  // Try: skip flags and grab first non-flag argument
  // Handles: -r -n --include=*.ts PatternHere
  const withoutFlags = argsStr.replace(/(-[a-zA-Z0-9]+\s+|--[a-zA-Z-]+=\S+\s+|-[a-zA-Z0-9]+)/g, "").trim();
  const plain = /^([^\s]+)/.exec(withoutFlags);
  return plain?.[1] ?? null;
}

// ── Shared result summaries (duplicated from pre-search for locality) ─────────

interface LocateRaw {
  confidence?: number;
  resolvedTarget?: { confidence?: number; kind?: string; name?: string; path?: string };
  candidates?: Array<{ name?: string; kind?: string }>;
}

interface TextHit {
  path?: string;
}

function summarizeLocate(raw: LocateRaw): { part: string; confidence: number } {
  const confidence = raw.confidence ?? raw.resolvedTarget?.confidence ?? 1.0;
  const target = raw.resolvedTarget;
  if (target?.name) {
    const kind = target.kind ? `, ${target.kind}` : "";
    const file = target.path ? `, ${target.path.split("/").at(-1)}` : "";
    return { part: `symbol: ${target.name}${kind}${file}`, confidence };
  }
  const candidates = (raw.candidates ?? []).slice(0, 3);
  if (candidates.length > 0) {
    const list = candidates.map((c) => `${c.name ?? "?"}${c.kind ? ` (${c.kind})` : ""}`).join(", ");
    return { part: `candidates: ${list}`, confidence };
  }
  return { part: "", confidence };
}

function summarizeText(hits: TextHit[]): string {
  if (hits.length === 0) return "";
  const files = [...new Set(hits.map((h) => h.path?.split("/").at(-1) ?? "").filter(Boolean))];
  const shown = files.slice(0, 4).join(", ");
  const more = files.length > 4 ? ` (+${files.length - 4} more)` : "";
  return `${hits.length} text hits in ${shown}${more}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  let payload: ShellPayload = {};
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ShellPayload;
  } catch {
    process.exit(0);
  }

  const command = payload.command ?? "";
  if (!command) process.exit(0);

  // Only intercept grep/rg
  const pattern = extractGrepPattern(command);
  if (!pattern || pattern.length < 3) process.exit(0);

  // Skip secrets
  if (looksLikeSecret(pattern)) process.exit(0);

  // Classify intent — only pursue symbol-like patterns
  const { intent } = classifyIntent(pattern);
  if (intent === "literal" || intent === "file" || intent === "unknown") process.exit(0);

  // Health gate
  const healthy = await checkHealth();
  if (!healthy) process.exit(0);

  // Parallel ix calls (same flow as pre-search, no path/lang args from bash context)
  const isRegex = /[*+?]|[[\]()]|\\[a-zA-Z]|\{[0-9]/.test(pattern);
  const calls = [{ args: ["text", pattern, "--limit", "15"], label: "text" }];
  if (!isRegex) {
    calls.push({ args: ["locate", pattern], label: "locate" });
  }

  const results = await runIxParallel(calls, { timeout: 9_000 });

  let locatePart = "";
  let locateRaw: LocateRaw | null = null;
  const locateResult = results["locate"];
  if (locateResult?.stdout) {
    try {
      locateRaw = parseIxJson(locateResult.stdout) as LocateRaw;
      const s = summarizeLocate(locateRaw);
      if (s.confidence >= 0.3) locatePart = s.part;
    } catch { /* ignore */ }
  }

  let textPart = "";
  let textRaw: unknown = null;
  const textResult = results["text"];
  if (textResult?.stdout) {
    try {
      textRaw = parseIxJson(textResult.stdout);
      textPart = summarizeText(Array.isArray(textRaw) ? (textRaw as TextHit[]) : []);
    } catch { /* ignore */ }
  }

  if (!locatePart && !textPart) process.exit(0);
  if (IX_HOOK_VERBOSITY === "silent") process.exit(0);

  const parts: string[] = [`[ix] bash grep intercepted for '${pattern}'`];
  if (locatePart) parts.push(locatePart);
  if (textPart) parts.push(textPart);
  parts.push(`Prefer: ix_locate / ix_text over shell grep`);

  const context = parts.join(" — ");
  const agentMessage =
    IX_HOOK_VERBOSITY === "verbose"
      ? `${context}\n\n${JSON.stringify({ locate: locateRaw, text: textRaw }, null, 2)}`
      : context;

  process.stdout.write(
    JSON.stringify({ permission: "allow", agent_message: agentMessage }),
  );
  process.exit(0);
}

main().catch(() => process.exit(0));
