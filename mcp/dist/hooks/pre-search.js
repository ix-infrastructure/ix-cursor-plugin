#!/usr/bin/env node
// Copyright 2026 Ix Infrastructure Inc.
// Cursor Grep hook — where a searched-for symbol is defined and who calls it.
// Registered twice (matcher "Grep"), and branches on the payload's
// hook_event_name:
//
//   postToolUse (opt-in, IX_HOOK_SEARCH=true): for a symbol-like pattern, runs
//     ix locate and, when that resolves one confident definition, ix callers;
//     returns one line as `additional_context`, which Cursor injects "into the
//     conversation after the tool result". Anything else adds nothing.
//   preToolUse (opt-in, IX_BLOCK_ON_HIGH_CONFIDENCE=true): on that same
//     confident definition, denies the native Grep with the line as
//     `agent_message`, which Cursor feeds back to the agent "when the action is
//     denied". Otherwise it exits without output and the Grep runs.
//
// With both switches off (the default) each Grep still starts this script
// twice; it exits before running ix. hooks.json cannot register a hook
// conditionally.
//
// It used to also run `ix text` and report "N text hits in ..." — the same
// matches the Grep had just returned. The lookup lives in
// shared/search-context.ts, shared with shell-search.
//
// The augment path used to answer preToolUse with `permission: "allow"` +
// `agent_message`; Cursor delivers agent_message only on deny, so it never
// reached the model. The deny path used to exit 2; the docs define exit 0 as
// "use the JSON output" and exit 2 only as "block the action", so it now exits
// 0 to be sure the agent_message is read.
// Source: https://cursor.com/docs/hooks (Command-Based Hooks -> exit codes;
// Hook events -> preToolUse, postToolUse).
import { checkHealth } from "../lib/cli.js";
import { IX_BLOCK_ON_HIGH_CONFIDENCE, IX_HOOK_SEARCH, IX_HOOK_VERBOSITY } from "../lib/config.js";
import { ixRoot, readHookInput, writeHookOutput, } from "../shared/hook-io.js";
import { isSymbolSearch, searchContext } from "../shared/search-context.js";
async function main() {
    const input = await readHookInput();
    if (!input)
        process.exit(0);
    // preToolUse only matters when blocking is enabled; otherwise let Grep run
    // untouched and add context afterwards, from postToolUse, if that is on.
    const isPreToolUse = input.hook_event_name === "preToolUse";
    if (isPreToolUse && !IX_BLOCK_ON_HIGH_CONFIDENCE)
        process.exit(0);
    if (!isPreToolUse && (!IX_HOOK_SEARCH || IX_HOOK_VERBOSITY === "silent"))
        process.exit(0);
    const pattern = input.tool_input?.pattern ?? "";
    if (!isSymbolSearch(pattern))
        process.exit(0);
    const root = await ixRoot(input);
    if (!root)
        process.exit(0);
    // Health gate
    const healthy = await checkHealth();
    if (!healthy)
        process.exit(0);
    const found = await searchContext(pattern, root);
    if (!found)
        process.exit(0);
    const message = IX_HOOK_VERBOSITY === "verbose"
        ? `${found.text}\n\n${JSON.stringify(found.raw, null, 2)}`
        : found.text;
    if (isPreToolUse) {
        // Block native Grep — Ix has a high-confidence answer. Exit 0: that is the
        // exit code for which Cursor documents reading the JSON.
        const output = {
            permission: "deny",
            agent_message: message,
            user_message: `[ix] Blocked native Grep — graph-backed match found for '${pattern}'.`,
        };
        writeHookOutput(output);
        process.exit(0);
    }
    // Augment: the Grep already ran; add the graph view after its result.
    const output = { additional_context: message };
    writeHookOutput(output);
    process.exit(0);
}
main().catch(() => {
    process.exit(0);
});
//# sourceMappingURL=pre-search.js.map