export declare function stateDir(): string;
/** Returns `stateDir()/<sub>`, creating it (mode 0700) if needed. */
export declare function ensureStateDir(sub?: string): Promise<string>;
/** Short stable key for per-project state, derived from a canonical root path. */
export declare function rootKey(root: string): string;
//# sourceMappingURL=state-dir.d.ts.map