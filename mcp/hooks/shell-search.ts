#!/usr/bin/env node
// Copyright 2026 Ix Infrastructure Inc.

// Cursor postToolUse hook (matcher: "Shell") — graph context for shell grep/rg.
//
// After a shell command runs, detects grep or rg invocations, extracts the
// search pattern, and runs the same ix text + ix locate flow as the Grep hook,
// returning the summary as `additional_context`.
//
// Was a beforeShellExecution hook answering `permission: "allow"` +
// `agent_message`: a permission decision (merged across hook sources, "deny
// wins over ask, ask wins over allow") on commands it only meant to observe,
// and not a documented way to add context to a command that is allowed.
// postToolUse's `additional_context` is "injected into the conversation after
// the tool result", and Shell is one of its matcher values; Shell's tool_input
// carries `command` and `working_directory`.
// Source: https://cursor.com/docs/hooks (Configuration; Matcher Configuration;
// Hook events -> preToolUse, postToolUse, beforeShellExecution).
//
// Contract:
//   exit 0 + {"additional_context": ...} → context shown to the agent
//   exit 0 + no stdout                   → nothing to say
//   never blocks: postToolUse has no permission output

import { checkHealth, runIxParallel } from "../lib/cli.js";
import { IX_HOOK_VERBOSITY } from "../lib/config.js";
import { classifyIntent, looksLikeSecret } from "../shared/intent-classifier.js";
import { parseIxJson } from "../lib/parser.js";
import {
  ixRoot,
  readHookInput,
  writeHookOutput,
  type PostToolUseOutput,
  type ToolHookInput,
} from "../shared/hook-io.js";

// ── Payload type ──────────────────────────────────────────────────────────────

interface ShellToolInput {
  command?: string;
  working_directory?: string;
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
  const input = await readHookInput<ToolHookInput<ShellToolInput>>();
  if (!input) process.exit(0);
  if (IX_HOOK_VERBOSITY === "silent") process.exit(0);

  const command = input.tool_input?.command ?? "";
  if (!command) process.exit(0);

  // Only intercept grep/rg
  const pattern = extractGrepPattern(command);
  if (!pattern || pattern.length < 3) process.exit(0);

  // Skip secrets
  if (looksLikeSecret(pattern)) process.exit(0);

  // Classify intent — only pursue symbol-like patterns
  const { intent } = classifyIntent(pattern);
  if (intent === "literal" || intent === "file" || intent === "unknown") process.exit(0);

  // Run ix in the repo the command ran in.
  const workingDir = input.tool_input?.working_directory;
  const root = await ixRoot({
    workspace_roots: input.workspace_roots,
    cwd: typeof workingDir === "string" && workingDir ? workingDir : input.cwd,
  });
  if (!root) process.exit(0);

  // Health gate
  const healthy = await checkHealth();
  if (!healthy) process.exit(0);

  // Parallel ix calls (same flow as pre-search, no path/lang args from bash context)
  const isRegex = /[*+?]|[[\]()]|\\[a-zA-Z]|\{[0-9]/.test(pattern);
  const calls = [{ args: ["text", pattern, "--limit", "15"], label: "text" }];
  if (!isRegex) {
    calls.push({ args: ["locate", pattern], label: "locate" });
  }

  const results = await runIxParallel(calls, { timeout: 9_000, cwd: root });

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

  const parts: string[] = [`[ix] bash grep intercepted for '${pattern}'`];
  if (locatePart) parts.push(locatePart);
  if (textPart) parts.push(textPart);
  parts.push(`Prefer: ix_locate / ix_text over shell grep`);

  const context = parts.join(" — ");
  const additionalContext =
    IX_HOOK_VERBOSITY === "verbose"
      ? `${context}\n\n${JSON.stringify({ locate: locateRaw, text: textRaw }, null, 2)}`
      : context;

  const output: PostToolUseOutput = { additional_context: additionalContext };
  writeHookOutput(output);
  process.exit(0);
}

main().catch(() => process.exit(0));
