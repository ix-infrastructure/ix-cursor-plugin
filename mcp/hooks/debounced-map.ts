#!/usr/bin/env node
// Copyright 2026 Ix Infrastructure Inc.

// Cursor stop hook — guarded, debounced graph refresh after each agent turn.
//
// For each workspace root in the hook payload (falling back to
// CURSOR_PROJECT_DIR), requests the guarded root map from shared/auto-map.ts:
// git repo only, never $HOME, only when the repo is already mapped, debounced
// per root (shared with the afterFileEdit hook), and spawned detached as
// `ix map <root> --silent` with IX_AUTO_MAP=1.
//
// Contract:
//   Always exits 0; fire-and-forget; no meaningful stdout.

import { checkHealth } from "../lib/cli.js";
import { gitRoot, projectDirs, requestAutoMap } from "../shared/auto-map.js";

interface StopPayload {
  workspace_roots?: string[];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  let payload: StopPayload = {};
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as StopPayload;
  } catch {
    // No payload — fall back to CURSOR_PROJECT_DIR below.
  }

  const dirs = projectDirs(payload.workspace_roots);
  if (dirs.length === 0) process.exit(0);

  // Health gate
  const healthy = await checkHealth();
  if (!healthy) process.exit(0);

  // Two workspace folders in one repo are one map. Resolve and dedupe first,
  // then request in parallel: each may wait on `ix status`, and the hook has 5 s.
  const roots = new Set((await Promise.all(dirs.map(gitRoot))).filter((r): r is string => r !== null));
  await Promise.all([...roots].map((root) => requestAutoMap(root)));
  process.exit(0);
}

main().catch(() => process.exit(0));
