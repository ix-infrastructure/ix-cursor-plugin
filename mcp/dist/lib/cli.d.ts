export interface IxResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    durationMs: number;
}
export interface ParallelCall {
    args: string[];
    label: string;
}
export declare function stripHeader(raw: string): string;
export declare function checkHealth(): Promise<boolean>;
export declare function runIx(args: string[], opts?: {
    timeout?: number;
}): Promise<IxResult>;
export declare function runIxLlm(args: string[], opts?: {
    timeout?: number;
}): Promise<IxResult>;
export declare function runIxParallel(calls: ParallelCall[], opts?: {
    timeout?: number;
}): Promise<Record<string, IxResult>>;
//# sourceMappingURL=cli.d.ts.map