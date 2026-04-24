// Per-turn attribution ledger (port of hooks/ix-ledger.sh).
//
// Hooks append events after each ix invocation. The stop-annotate hook reads
// the current turn's events to build an attribution summary. All writes are
// fire-and-forget — ledger failure never blocks the hook path.
//
// Storage: ~/.local/share/ix/cursor-plugin/ledger/YYYY-MM-DD.jsonl
// Turn key: generation_id from hook payload (unique per agent turn)
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
// ── Storage paths ─────────────────────────────────────────────────────────────
function ledgerDir() {
    return join(homedir(), ".local", "share", "ix", "cursor-plugin", "ledger");
}
function ledgerFile() {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return join(ledgerDir(), `${date}.jsonl`);
}
// ── Public: fire-and-forget append ───────────────────────────────────────────
export function appendEvent(event) {
    void (async () => {
        try {
            await mkdir(ledgerDir(), { recursive: true });
            const line = JSON.stringify({
                ...event,
                ts: event.ts || new Date().toISOString(),
            });
            await appendFile(ledgerFile(), line + "\n", "utf8");
        }
        catch {
            // truly fire-and-forget
        }
    })();
}
// ── Public: read current turn's events ───────────────────────────────────────
// Reads the last 200 lines of today's ledger, filters to the given turn_id.
// Scopes to the current turn by finding events after the last Briefing record.
export async function getLastTurnEvents(turnId) {
    try {
        const raw = await readFile(ledgerFile(), "utf8");
        const lines = raw.split("\n").filter(Boolean);
        // Use last 200 lines to bound memory
        const recent = lines.slice(-200);
        const allEvents = [];
        for (const line of recent) {
            try {
                const ev = JSON.parse(line);
                if (ev.turn_id === turnId)
                    allEvents.push(ev);
            }
            catch {
                // skip malformed lines
            }
        }
        // Scope to the current turn: find the last Briefing record timestamp
        // (beforeSubmitPrompt fires before any preToolUse, so it marks the turn start)
        const lastBriefingIdx = [...allEvents]
            .reverse()
            .findIndex((e) => e.tool === "Briefing");
        if (lastBriefingIdx === -1)
            return allEvents;
        // lastBriefingIdx is from the reversed array; convert to forward index
        const splitAt = allEvents.length - 1 - lastBriefingIdx;
        return allEvents.slice(splitAt);
    }
    catch {
        return [];
    }
}
// ── Convenience builder ───────────────────────────────────────────────────────
export function buildEvent(turnId, hookEvent, tool, opts = {}) {
    return {
        ts: new Date().toISOString(),
        turn_id: turnId,
        hook_event: hookEvent,
        tool,
        ctx_chars: opts.ctx_chars ?? 0,
        ix_cmds: opts.ix_cmds ?? [],
        conf: opts.conf ?? "1",
        risk: opts.risk ?? "",
        note: opts.note ?? "",
        ms: opts.ms ?? 0,
    };
}
//# sourceMappingURL=ledger.js.map