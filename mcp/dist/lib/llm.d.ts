import { type ToolResult } from "./parser.js";
export declare const MIN_LLM_VERSION: SemVer;
type SemVer = [number, number, number];
export declare function parseSemver(value: string): SemVer | null;
export declare function gte(a: SemVer, b: SemVer): boolean;
export declare function resetLlmSupportCache(): void;
export declare function ixSupportsLlm(): Promise<boolean>;
export declare function redactLlmText(text: string): string;
export declare function isLlmErrorLine(text: string): boolean;
export declare function tryLlm(toolName: string, args: string[], input: Record<string, unknown>, opts?: {
    timeout?: number;
}): Promise<ToolResult | null>;
export {};
//# sourceMappingURL=llm.d.ts.map