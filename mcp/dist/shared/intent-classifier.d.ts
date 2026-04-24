export type Intent = "symbol" | "literal" | "file" | "unknown";
export interface IntentResult {
    intent: Intent;
    confidence: number;
}
export declare function classifyIntent(pattern: string): IntentResult;
export declare function looksLikeSecret(pattern: string): boolean;
//# sourceMappingURL=intent-classifier.d.ts.map