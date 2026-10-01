#!/usr/bin/env node
// Copyright 2026 Ix Infrastructure Inc.

// Cursor afterFileEdit hook — request a guarded graph refresh after a write.
//
// `ix map` takes a directory, never a file ("Map path is not a directory"), so
// this hook does not map per file. It requests the guarded root map instead
// (shared/auto-map.ts): only for the git repo of the workspace root that holds
// the edited file, only when that repo is already mapped, debounced per root,
// and spawned detached so it never delays the agent's next turn.
//
// The afterFileEdit event has no consumed output in Cursor, so hook verbosity
// does not change behavior here (documented Cursor limitation).
//
// Contract:
//   Always exits 0; never blocks; never produces meaningful stdout.

import { checkHealth } from "../lib/cli.js";
import { projectDirs, requestAutoMap, rootContaining } from "../shared/auto-map.js";

// ── Hook payload ──────────────────────────────────────────────────────────────

interface AfterFileEditPayload {
  file_path?: string;
  workspace_roots?: string[];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Consume stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  let payload: AfterFileEditPayload = {};
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as AfterFileEditPayload;
  } catch {
    process.exit(0);
  }

  const filePath = payload.file_path ?? "";
  if (!filePath) process.exit(0);

  // Only refresh the workspace the edit landed in; an edit outside every
  // workspace root (e.g. a user config file) never triggers a map.
  const projectDir = rootContaining(filePath, projectDirs(payload.workspace_roots));
  if (!projectDir) process.exit(0);

  // Health gate
  const healthy = await checkHealth();
  if (!healthy) process.exit(0);

  await requestAutoMap(projectDir);
  process.exit(0);
}

main().catch(() => {
  process.exit(0);
});
