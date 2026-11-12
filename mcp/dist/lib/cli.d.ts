export interface IxResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    durationMs: number;
}
export interface IxRunOptions {
    timeout?: number;
    /** Working directory for ix (the project root); defaults to the hook's cwd. */
    cwd?: string;
}
export declare function stripHeader(raw: string): string;
export declare function checkHealth(): Promise<boolean>;
export declare function runIx(args: string[], opts?: IxRunOptions): Promise<IxResult>;
//# sourceMappingURL=cli.d.ts.map