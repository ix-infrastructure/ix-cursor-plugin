// All plugin configuration comes from environment variables.
// Read once at import time so the values are stable for the process lifetime.

function envBool(name: string, defaultVal: boolean): boolean {
  const v = process.env[name]?.toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return defaultVal;
}

function envStr(name: string, defaultVal: string): string {
  return process.env[name] ?? defaultVal;
}

function envNullable(name: string): string | null {
  return process.env[name] ?? null;
}

function envChoice<T extends string>(name: string, choices: readonly T[], defaultVal: T): T {
  const value = process.env[name];
  if (value && choices.includes(value as T)) {
    return value as T;
  }
  return defaultVal;
}

// ── Binary ────────────────────────────────────────────────────────────────────

export const IX_BIN = envStr("IX_BIN", "ix");

// ── Logging ───────────────────────────────────────────────────────────────────

export const IX_DEBUG_LOG = envNullable("IX_DEBUG_LOG");

// ── Behaviour flags ───────────────────────────────────────────────────────────

// When true, the pre-search hook blocks the native Grep/Glob if ix confidence
// is high. Default false — ship in augment mode first.
export const IX_BLOCK_ON_HIGH_CONFIDENCE = envBool("IX_BLOCK_ON_HIGH_CONFIDENCE", false);

export type HookVerbosity = "silent" | "brief" | "verbose";

// Unified hook output control. Replaces the older per-hook output flags.
export const IX_HOOK_VERBOSITY = envChoice(
  "IX_HOOK_VERBOSITY",
  ["silent", "brief", "verbose"] as const,
  "brief",
);

// ── Timeouts (ms) ─────────────────────────────────────────────────────────────

export const TIMEOUT_DEFAULT_MS = 15_000;
export const TIMEOUT_MAP_MS = 60_000;
export const TIMEOUT_HEALTH_MS = 5_000;

// Returns the appropriate timeout for a given ix subcommand.
export function timeoutFor(subcommand: string): number {
  if (subcommand === "map") return TIMEOUT_MAP_MS;
  return TIMEOUT_DEFAULT_MS;
}
