export interface LedgerEvent {
    ts: string;
    turn_id: string;
    hook_event: string;
    tool: string;
    ctx_chars: number;
    ix_cmds: string[];
    conf: string;
    risk: string;
    note: string;
    ms: number;
}
export declare function appendEvent(event: LedgerEvent): void;
export declare function getLastTurnEvents(turnId: string): Promise<LedgerEvent[]>;
export declare function buildEvent(turnId: string, hookEvent: string, tool: string, opts?: Partial<Omit<LedgerEvent, "ts" | "turn_id" | "hook_event" | "tool">>): LedgerEvent;
//# sourceMappingURL=ledger.d.ts.map