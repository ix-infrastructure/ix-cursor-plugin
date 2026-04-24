import type { LedgerEvent } from "./ledger.js";
export interface RiskResult {
    target?: string;
    riskLevel?: string;
    riskSummary?: string;
    nextStep?: string;
    dependents?: number;
    summary?: {
        directDependents?: number;
        memberLevelCallers?: number;
    };
    topImpactedMembers?: Array<{
        name?: string;
    }>;
}
export declare function summarizeTurn(events: LedgerEvent[]): string;
export declare function summarizeRisk(result: RiskResult): string;
//# sourceMappingURL=summarizers.d.ts.map