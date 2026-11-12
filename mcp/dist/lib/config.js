// Copyright 2026 Ix Infrastructure Inc.
// All plugin configuration comes from environment variables.
// Read once at import time so the values are stable for the process lifetime.
function envBool(name, defaultVal) {
    const v = process.env[name]?.toLowerCase();
    if (v === "true" || v === "1")
        return true;
    if (v === "false" || v === "0")
        return false;
    return defaultVal;
}
function envStr(name, defaultVal) {
    return process.env[name] ?? defaultVal;
}
function envNullable(name) {
    return process.env[name] ?? null;
}
function envChoice(name, choices, defaultVal) {
    const value = process.env[name];
    if (value && choices.includes(value)) {
        return value;
    }
    return defaultVal;
}
// ── Binary ────────────────────────────────────────────────────────────────────
export const IX_BIN = envStr("IX_BIN", "ix");
// ── Logging ───────────────────────────────────────────────────────────────────
export const IX_DEBUG_LOG = envNullable("IX_DEBUG_LOG");
// ── Behaviour flags ───────────────────────────────────────────────────────────
// When true, the pre-search hook blocks the native Grep if ix confidence
// is high. Default false — ship in augment mode first. Independent of
// IX_HOOK_SEARCH: blocking is its own opt-in.
export const IX_BLOCK_ON_HIGH_CONFIDENCE = envBool("IX_BLOCK_ON_HIGH_CONFIDENCE", false);
// One switch per hook that adds text for the model, so each can be turned off
// on its own. IX_HOOK_VERBOSITY=silent still turns all of them off together.
//
// The two search hooks are off by default, as in the Claude Code plugin they
// were ported from: each costs two ix calls after a search, and what it adds
// (where a name is defined and who calls it) the agent can get from
// ix_locate and ix_callers when it wants it.
// The briefing and edit-impact hooks say something the agent would not
// otherwise ask for, so they stay on.
export const IX_HOOK_SEARCH = envBool("IX_HOOK_SEARCH", false);
export const IX_HOOK_SHELL_SEARCH = envBool("IX_HOOK_SHELL_SEARCH", false);
export const IX_HOOK_EDIT_IMPACT = envBool("IX_HOOK_EDIT_IMPACT", true);
export const IX_HOOK_BRIEFING = envBool("IX_HOOK_BRIEFING", true);
// Unified hook output control. Replaces the older per-hook output flags.
export const IX_HOOK_VERBOSITY = envChoice("IX_HOOK_VERBOSITY", ["silent", "brief", "verbose"], "brief");
// ── Timeouts (ms) ─────────────────────────────────────────────────────────────
export const TIMEOUT_DEFAULT_MS = 15_000;
export const TIMEOUT_MAP_MS = 60_000;
// Returns the appropriate timeout for a given ix subcommand.
export function timeoutFor(subcommand) {
    if (subcommand === "map")
        return TIMEOUT_MAP_MS;
    return TIMEOUT_DEFAULT_MS;
}
//# sourceMappingURL=config.js.map