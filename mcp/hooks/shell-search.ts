#!/usr/bin/env node
// Copyright 2026 Ix Infrastructure Inc.

// Cursor postToolUse hook (matcher: "Shell") — graph context for shell grep/rg.
//
// Opt-in: IX_HOOK_SHELL_SEARCH=true. After a shell command runs, detects grep
// or rg invocations, extracts the search pattern, and runs the same lookup as
// the Grep hook (shared/search-context.ts): where the symbol is defined and who
// calls it, or nothing when ix locate has no single confident definition.
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

import { checkHealth } from "../lib/cli.js";
import { IX_HOOK_SHELL_SEARCH, IX_HOOK_VERBOSITY } from "../lib/config.js";
import {
  ixRoot,
  readHookInput,
  writeHookOutput,
  type PostToolUseOutput,
  type ToolHookInput,
} from "../shared/hook-io.js";
import { isSymbolSearch, searchContext } from "../shared/search-context.js";

// ── Payload type ──────────────────────────────────────────────────────────────

interface ShellToolInput {
  command?: string;
  working_directory?: string;
}

// ── Pattern extraction ────────────────────────────────────────────────────────
// Intercepts `grep` / `rg` in common forms, including `cd src && rg Foo` and
// `find . | xargs grep Foo`.

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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const input = await readHookInput<ToolHookInput<ShellToolInput>>();
  if (!input) process.exit(0);
  if (!IX_HOOK_SHELL_SEARCH || IX_HOOK_VERBOSITY === "silent") process.exit(0);

  const command = input.tool_input?.command ?? "";
  if (!command) process.exit(0);

  // Only grep/rg, and only a symbol-like pattern
  const pattern = extractGrepPattern(command);
  if (!pattern || !isSymbolSearch(pattern)) process.exit(0);

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

  const found = await searchContext(pattern, root);
  if (!found) process.exit(0);

  const additionalContext =
    IX_HOOK_VERBOSITY === "verbose"
      ? `${found.text}\n\n${JSON.stringify(found.raw, null, 2)}`
      : found.text;

  const output: PostToolUseOutput = { additional_context: additionalContext };
  writeHookOutput(output);
  process.exit(0);
}

main().catch(() => process.exit(0));
