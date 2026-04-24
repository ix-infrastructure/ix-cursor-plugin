#!/usr/bin/env node
// Cursor stop hook — debounced full graph refresh after each agent turn.
//
// Spawns `ix map` (full graph refresh) as a detached async process.
// Debounced to at most once per 300 seconds (5 minutes) to avoid saturating
// the graph store during multi-turn sessions. Also skips if a recent
// incremental ingest from the post-edit-ingest hook ran within 60 seconds.
//
// Async pattern: read debounce state → spawn detached ix map → update timestamp
// → exit 0 immediately. ix map runs independently after this process exits.
//
// Contract:
//   Always exits 0; fire-and-forget; no meaningful stdout.

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IX_BIN } from "../lib/config.js";
import { checkHealth } from "../lib/cli.js";

const DEBOUNCE_MS = 300_000; // 5 minutes, matches Claude plugin
const RECENT_INGEST_MS = 60_000; // skip if incremental ingest was < 60 s ago

const DEBOUNCE_FILE = join(tmpdir(), "ix-map-last");
const LOCK_FILE = join(tmpdir(), "ix-map-running");

// ── Timestamp helpers ─────────────────────────────────────────────────────────

async function readTs(file: string): Promise<number> {
  try {
    const raw = await readFile(file, "utf8");
    return parseInt(raw.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function writeTs(file: string, ts: number): Promise<void> {
  try {
    await writeFile(file, String(ts), "utf8");
  } catch {
    // non-fatal
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Drain stdin (not used by this hook)
  for await (const _chunk of process.stdin) { /* drain */ }

  // Health gate
  const healthy = await checkHealth();
  if (!healthy) process.exit(0);

  const now = Date.now();

  // Debounce — skip if a full map ran recently
  const lastMapTs = await readTs(DEBOUNCE_FILE);
  if (now - lastMapTs < DEBOUNCE_MS) process.exit(0);

  // Skip if a recent incremental ingest is sufficient
  // Check the most recent file in the rate-limit directory
  const rateDir = join(tmpdir(), "ix-cursor-cache", "ingest-rate");
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(rateDir);
    if (entries.length > 0) {
      // Find the most recent ingest timestamp among all tracked files
      let mostRecent = 0;
      for (const entry of entries) {
        const ts = await readTs(join(rateDir, entry));
        if (ts > mostRecent) mostRecent = ts;
      }
      if (now - mostRecent < RECENT_INGEST_MS) {
        // Recent incremental ingest is sufficient — skip full map
        process.exit(0);
      }
    }
  } catch {
    // rateDir doesn't exist yet — no incremental ingests, proceed
  }

  // Soft lock — skip if another map is already running (check lock file age)
  const lockTs = await readTs(LOCK_FILE);
  if (now - lockTs < DEBOUNCE_MS && lockTs > 0) {
    // Another map started recently and is likely still running
    process.exit(0);
  }

  // Record debounce timestamp and lock before spawning
  await writeTs(DEBOUNCE_FILE, now);
  await writeTs(LOCK_FILE, now);

  // Spawn ix map as a fully detached process — async, never blocks the agent
  const child = spawn(IX_BIN, ["map"], { detached: true, stdio: "ignore" });
  child.unref();

  process.exit(0);
}

main().catch(() => process.exit(0));
