import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile } from "node:fs/promises";
import { basename } from "node:path";
import { IX_BIN, IX_DEBUG_LOG, timeoutFor } from "./config.js";
import { IxError } from "./errors.js";
import { withCache } from "../shared/cache.js";

const execFileAsync = promisify(execFile);

export interface IxResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ParallelCall {
  args: string[];
  label: string;
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
      await execFileAsync("command", ["-v", IX_BIN], { shell: true, timeout: 3000 });
      return true;
    });
    return true;
  } catch {
    return false;
  }
}

// ── Allowlist enforcement ─────────────────────────────────────────────────────

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "branch",
  "diff",
  "log",
  "ls-files",
  "ls-remote",
  "merge-base",
  "reflog",
  "rev-list",
  "rev-parse",
  "show",
  "status",
]);

function assertAllowedCommand(bin: string, args: string[]): void {
  const command = basename(bin);

  if (command === "ix") {
    return;
  }

  if (command === "git") {
    const subcommand = args[0] ?? "";
    if (READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
      return;
    }
    throw new IxError(
      "PERMISSION_DENIED",
      `git subcommand '${subcommand || "(missing)"}' is not permitted by the MCP allowlist.`,
    );
  }

  throw new IxError(
    "PERMISSION_DENIED",
    `Command '${command}' is outside the MCP allowlist.`,
  );
}

// ── Core CLI invocation ───────────────────────────────────────────────────────

export async function runIx(
  args: string[],
  opts: { timeout?: number } = {},
): Promise<IxResult> {
  const start = Date.now();
  const timeout = opts.timeout ?? timeoutFor(args[0] ?? "");
  assertAllowedCommand(IX_BIN, args);

  await debugLog(`CMD ${IX_BIN} ${[...args, "--format", "json"].join(" ")}`);

  try {
    const { stdout, stderr } = await execFileAsync(IX_BIN, [...args, "--format", "json"], {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
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

// ── Parallel invocation ───────────────────────────────────────────────────────

export async function runIxParallel(
  calls: ParallelCall[],
  opts: { timeout?: number } = {},
): Promise<Record<string, IxResult>> {
  const settled = await Promise.allSettled(
    calls.map((c) => runIx(c.args, opts)),
  );

  const result: Record<string, IxResult> = {};
  for (let i = 0; i < calls.length; i++) {
    const label = calls[i]!.label;
    const outcome = settled[i]!;
    if (outcome.status === "fulfilled") {
      result[label] = outcome.value;
    } else {
      result[label] = {
        ok: false,
        stdout: "",
        stderr: String(outcome.reason),
        durationMs: 0,
      };
    }
  }
  return result;
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
