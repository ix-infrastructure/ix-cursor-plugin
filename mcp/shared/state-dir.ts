// Copyright 2026 Ix Infrastructure Inc.

// Per-user state directory for plugin caches, debounce stamps and the like.
//
// `${XDG_STATE_HOME:-~/.local/state}/ix-cursor-plugin`, created 0700. This
// replaces fixed paths under the shared, world-writable tmpdir, where another
// user could pre-create or read the files.

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export function stateDir(): string {
  const xdg = process.env["XDG_STATE_HOME"];
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "state");
  return join(base, "ix-cursor-plugin");
}

/** Returns `stateDir()/<sub>`, creating it (mode 0700) if needed. */
export async function ensureStateDir(sub = ""): Promise<string> {
  const dir = sub ? join(stateDir(), sub) : stateDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Short stable key for per-project state, derived from a canonical root path. */
export function rootKey(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 16);
}
