// Copyright 2026 Ix Infrastructure Inc.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile } from "node:fs/promises";
import { basename } from "node:path";
import { IX_BIN, IX_DEBUG_LOG, timeoutFor } from "./config.js";
import { IxError } from "./errors.js";
import { findExecutable, ixLaunch } from "./launch.js";
import { withCache } from "../shared/cache.js";

const execFileAsync = promisify(execFile);

export interface IxResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface IxRunOptions {
  timeout?: number;
  /** Working directory for ix (the project root); defaults to the hook's cwd. */
  cwd?: string;
}

// ── Debug log ─────────────────────────────────────────────────────────────────

async function debugLog(message: string): Promise<void> {
  if (!IX_DEBUG_LOG) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [ix-cursor-mcp] ${message}\n`;
  try {
    await appendFile(IX_DEBUG_LOG, line, "utf8");
  } catch {
    // non-fatal
  }
}

// ── Header stripping (port of ix-lib.sh parse_json) ──────────────────────────
// ix sometimes emits "Update available" or other prose lines before the JSON.
// Skip everything before the first line that starts with [ or {.

export function stripHeader(raw: string): string {
  const lines = raw.split("\n");
  const start = lines.findIndex((l) => /^\s*[\[{]/.test(l));
  if (start === -1) return raw;
  return lines.slice(start).join("\n");
}

// ── Health check with TTL cache ───────────────────────────────────────────────

const HEALTH_TTL_MS = 300_000;

export async function checkHealth(): Promise<boolean> {
  try {
    await withCache("health", HEALTH_TTL_MS, async () => {
      // A PATH lookup, not `command -v`: that is a POSIX shell builtin and the
      // default shell on Windows is cmd.exe. Not found throws, so it is not cached.
      if (!(await findExecutable(IX_BIN))) throw new Error(`${IX_BIN} not found on PATH`);
      return true;
    });
    return true;
  } catch {
    return false;
  }
}

// ── Allowlist enforcement ─────────────────────────────────────────────────────

// Only ix is ever run. IX_BIN may point anywhere, but its file name must be ix.
function assertAllowedCommand(bin: string): void {
  const command = basename(bin);
  if (command === "ix") {
    return;
  }

  throw new IxError(
    "PERMISSION_DENIED",
    `Command '${command}' is not ix; the plugin runs only ix.`,
  );
}

// ── Core CLI invocation ───────────────────────────────────────────────────────

// Machine-readable JSON. Every caller (the hooks) parses the output, so any
// prose ix prints before the JSON is stripped.
export async function runIx(
  args: string[],
  opts: IxRunOptions = {},
): Promise<IxResult> {
  const start = Date.now();
  const timeout = opts.timeout ?? timeoutFor(args[0] ?? "");
  assertAllowedCommand(IX_BIN);

  const fullArgs = [...args, "--format", "json"];
  await debugLog(`CMD ${IX_BIN} ${fullArgs.join(" ")}`);

  try {
    const launch = await ixLaunch(IX_BIN, fullArgs);
    const { stdout, stderr } = await execFileAsync(launch.file, launch.args, {
      timeout,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });

    if (stderr.trim()) {
      await debugLog(`STDERR ${stderr.trim().slice(0, 300)}`);
    }

    return { ok: true, stdout: stripHeader(stdout), stderr, durationMs: Date.now() - start };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    if (isExecError(err)) {
      const stderr = err.stderr ?? "";
      if (stderr.trim()) {
        await debugLog(`STDERR ${stderr.trim().slice(0, 300)}`);
      }
      return {
        ok: false,
        stdout: stripHeader(err.stdout ?? ""),
        stderr,
        durationMs,
      };
    }
    return { ok: false, stdout: "", stderr: String(err), durationMs };
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
  code?: number | string;
  killed?: boolean;
}

function isExecError(err: unknown): err is ExecError {
  return err instanceof Error && ("stdout" in err || "stderr" in err);
}
