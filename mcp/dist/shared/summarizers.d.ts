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
export declare function summarizeRisk(result: RiskResult): string;
export interface Definition {
    name: string;
    kind: string | undefined;
    path: string | undefined;
}
/**
 * The single definition `ix locate` resolved with confidence, or null. A
 * refusal record (ambiguous target, not found, workspace not mapped — reported
 * under `error`, or `code` for ambiguity) has no single definition.
 */
export declare function confidentDefinition(locate: unknown): Definition | null;
/** One line: what `pattern` resolved to, where it is defined, and who calls it. */
export declare function summarizeDefinition(pattern: string, definition: Definition, callers: unknown): string;
//# sourceMappingURL=summarizers.d.ts.map