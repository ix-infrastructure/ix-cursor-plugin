#!/usr/bin/env node
// Cursor preToolUse hook (matcher: "Write") — pre-edit impact warning.
//
// Fires before any file write. Calls ix impact on the target file and injects
// a blast-radius warning when the file has significant dependents.
//
// Contract:
//   exit 0 + JSON stdout → Cursor uses the output (permission: allow + agent_message)
//   exit 0 + no stdout  → Cursor proceeds silently
//   never exit 2        → never block an edit; warnings are advisory only

import { basename, relative } from "node:path";

import { checkHealth, runIx } from "../lib/cli.js";
import { IX_HOOK_VERBOSITY } from "../lib/config.js";
import { parseIxJson } from "../lib/parser.js";
import { summarizeRisk } from "../shared/summarizers.js";

// ── Skip lists (matches ix-pre-edit.sh) ──────────────────────────────────────

const SKIP_EXTENSIONS = new Set([
  ".md", ".txt", ".lock",
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".bin",
  ".pyc", ".class", ".o",
]);

const SKIP_PATTERNS = [/__pycache__/];

function shouldSkip(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot !== -1) {
    const ext = filePath.slice(dot).toLowerCase();
    if (SKIP_EXTENSIONS.has(ext)) return true;
  }
  return SKIP_PATTERNS.some((re) => re.test(filePath));
}

// ── Repo-relative path resolution ────────────────────────────────────────────

function toRelPath(filePath: string, cwd: string): string {
  const root = process.env["CURSOR_PROJECT_DIR"] ?? cwd;
  if (filePath.startsWith("/") && root) {
    const rel = relative(root, filePath);
    // relative() returns something like "../../outside" for paths outside root
    if (!rel.startsWith("..")) return rel;
  }
  // Already relative, or outside root — use as-is
  return filePath;
}

// ── Hook payload types ────────────────────────────────────────────────────────

interface PreToolUsePayload {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    path?: string; // some tools use "path" instead of "file_path"
  };
  cwd?: string;
}

// ── ix impact response (subset we need) ──────────────────────────────────────

interface ImpactRaw {
  riskLevel?: string;
  riskSummary?: string;
  nextStep?: string;
  summary?: {
    directDependents?: number;
    memberLevelCallers?: number;
  };
  topImpactedMembers?: Array<{ name?: string }>;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Read and parse the hook payload
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  let payload: PreToolUsePayload = {};
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as PreToolUsePayload;
  } catch {
    process.exit(0);
  }

  const filePath = payload.tool_input?.file_path ?? payload.tool_input?.path ?? "";
  const cwd = payload.cwd ?? process.env["CURSOR_PROJECT_DIR"] ?? "";

  if (!filePath) process.exit(0);
  if (shouldSkip(filePath)) process.exit(0);
  if (IX_HOOK_VERBOSITY === "silent") process.exit(0);

  // Health gate
  const healthy = await checkHealth();
  if (!healthy) process.exit(0);

  const relPath = toRelPath(filePath, cwd);
  const filename = basename(filePath);

  // Call ix impact (9 s budget; hook timeout is 10 s)
  const result = await runIx(["impact", relPath], { timeout: 9_000 });
  // Not `!result.ok`. A non-zero exit is not the same as no answer: `runIx`
  // keeps stdout across a failure, and since ix-infrastructure/Ix#547 a target
  // that is not in the graph exits 1 while still printing its JSON body. Gating
  // on the exit code alone conflated "ix could not run" with "ix ran and had
  // nothing to say", and threw the body away in both cases. Bail only when
  // there is genuinely nothing to read — a missing binary, a timeout, a crash.
  if (!result.stdout.trim()) process.exit(0);

  let raw: ImpactRaw;
  try {
    raw = parseIxJson(result.stdout) as ImpactRaw;
  } catch {
    process.exit(0);
  }

  const riskLevel = raw.riskLevel ?? "unknown";
  if (riskLevel === "unknown" || riskLevel === "low") process.exit(0);

  const directDependents = raw.summary?.directDependents ?? 0;
  const memberCallers = raw.summary?.memberLevelCallers ?? 0;
  const effectiveDependents = Math.max(directDependents, memberCallers);

  // Only warn when there are enough dependents to be meaningful
  if (effectiveDependents < 3) process.exit(0);

  const warning = summarizeRisk({
    ...raw,
    target: filename,
    dependents: effectiveDependents,
  });
  if (!warning) process.exit(0);

  const agentMessage =
    IX_HOOK_VERBOSITY === "verbose"
      ? `${warning}\n\n${JSON.stringify(raw, null, 2)}`
      : warning;

  // Output allow + agent_message. Never deny — warnings are advisory.
  process.stdout.write(
    JSON.stringify({
      permission: "allow",
      agent_message: agentMessage,
    }),
  );

  process.exit(0);
}

main().catch(() => {
  process.exit(0);
});
