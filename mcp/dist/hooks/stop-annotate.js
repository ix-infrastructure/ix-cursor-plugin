#!/usr/bin/env node
// Cursor stop hook — attribution summary after each agent turn.
//
// Reads the current turn's ledger events and emits a one-line summary of how
// Ix contributed: surfaced symbols, flagged risk, injected briefing context, etc.
//
// Controlled by IX_HOOK_VERBOSITY. "silent" disables annotations, while "brief"
// and "verbose" both emit a one-line attribution summary when enough Ix work
// happened during the turn.
//
// The Cursor `stop` hook output supports `followup_message` — an automated
// follow-up prompt. We avoid that (too noisy). Instead, when enabled, we emit
// the annotation only when >= 2 Ix tools were used, and only via agent_message
// if the Cursor runtime supports it from a stop hook (unverified — may be no-op).
//
// Contract:
//   exit 0 + no stdout → silent (default)
//   exit 0 + JSON stdout → annotation (when IX_ANNOTATE_MODE=brief)
import { IX_HOOK_VERBOSITY } from "../lib/config.js";
import { getLastTurnEvents } from "../shared/ledger.js";
import { summarizeTurn } from "../shared/summarizers.js";
// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    if (IX_HOOK_VERBOSITY === "silent")
        process.exit(0);
    let payload = {};
    try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch {
        process.exit(0);
    }
    // Use generation_id as the turn key; fall back to conversation_id
    const turnId = payload.generation_id ?? payload.conversation_id ?? "";
    if (!turnId)
        process.exit(0);
    const events = await getLastTurnEvents(turnId);
    if (events.length === 0)
        process.exit(0);
    const summary = summarizeTurn(events);
    if (!summary)
        process.exit(0);
    // Emit annotation. Cursor stop hook supports `followup_message` for auto-prompts.
    // We use agent_message to inject silently (unverified field for stop hook — may
    // be ignored). We do NOT use followup_message to avoid noisy auto-prompts.
    process.stdout.write(JSON.stringify({ agent_message: summary }));
    process.exit(0);
}
main().catch(() => process.exit(0));
//# sourceMappingURL=stop-annotate.js.map