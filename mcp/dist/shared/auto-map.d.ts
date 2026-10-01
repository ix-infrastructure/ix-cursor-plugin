export declare const AUTO_MAP_DEBOUNCE_MS = 300000;
export type AutoMapOutcome = "no-project-dir" | "not-git" | "home" | "debounced" | "not-mapped" | "spawned";
export interface AutoMapOptions {
    ixBin?: string;
    now?: number;
    debounceMs?: number;
}
/** `git -C <dir> rev-parse --show-toplevel`, canonicalised; null when not a repo. */
export declare function gitRoot(dir: string): Promise<string | null>;
/** True only when `ix status` says the root's graph is complete. */
export declare function isMapped(root: string, ixBin: string): Promise<boolean>;
/**
 * Requests a guarded background map of the repo containing `projectDir`.
 * Never throws; resolves as soon as the detached child is spawned.
 */
export declare function requestAutoMap(projectDir: string | undefined, opts?: AutoMapOptions): Promise<AutoMapOutcome>;
/** Workspace roots from the payload, falling back to CURSOR_PROJECT_DIR. */
export declare function projectDirs(workspaceRoots: unknown): string[];
/** The workspace root that contains `filePath`, if any. */
export declare function rootContaining(filePath: string, dirs: string[]): string | undefined;
//# sourceMappingURL=auto-map.d.ts.map