// Copyright 2026 Ix Infrastructure Inc.
// Guarded automatic graph refresh, shared by the afterFileEdit and stop hooks.
//
// An automatic `ix map` runs only when all of these hold:
//   1. The project dir (from the Cursor hook payload, never the plugin dir or
//      the hook process cwd) is inside a git repo, and that repo's top level is
//      not $HOME.
//   2. The repo is already mapped: `ix status --format json --root <root>`
//      reports `graphCompleted: true`. An automatic refresh never creates a
//      workspace; any failure, timeout or non-JSON answer means "skip".
//   3. No automatic map was requested for this root within the debounce window.
//      The stamp lives in the per-user state dir, keyed by a hash of the root.
//      Ix holds its own per-workspace map lock, so there is no plugin lock.
// Then it spawns `ix map <root> --silent` detached, cwd = root, with
// IX_AUTO_MAP=1 so Ix skips the automatic map against a remote backend.
import { execFile, spawn } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { IX_BIN } from "../lib/config.js";
import { stripHeader } from "../lib/cli.js";
import { ensureStateDir, rootKey } from "./state-dir.js";
const execFileAsync = promisify(execFile);
export const AUTO_MAP_DEBOUNCE_MS = 300_000; // 5 minutes per root
const GIT_TIMEOUT_MS = 2_000;
const STATUS_TIMEOUT_MS = 3_000; // hooks run under a 5 s Cursor timeout
async function canonical(path) {
    try {
        return await realpath(path);
    }
    catch {
        return path;
    }
}
/** `git -C <dir> rev-parse --show-toplevel`, canonicalised; null when not a repo. */
export async function gitRoot(dir) {
    try {
        const { stdout } = await execFileAsync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
            timeout: GIT_TIMEOUT_MS,
        });
        const top = stdout.trim();
        return top ? await canonical(top) : null;
    }
    catch {
        return null;
    }
}
/** True only when `ix status` says the root's graph is complete. */
export async function isMapped(root, ixBin) {
    try {
        const { stdout } = await execFileAsync(ixBin, ["status", "--format", "json", "--root", root], {
            cwd: root,
            timeout: STATUS_TIMEOUT_MS,
            maxBuffer: 1024 * 1024,
        });
        const parsed = JSON.parse(stripHeader(stdout));
        return parsed.graphCompleted === true;
    }
    catch {
        return false;
    }
}
async function debounceFile(root) {
    return join(await ensureStateDir("auto-map"), `${rootKey(root)}.stamp`);
}
async function lastRequest(root) {
    try {
        return parseInt((await readFile(await debounceFile(root), "utf8")).trim(), 10) || 0;
    }
    catch {
        return 0;
    }
}
/**
 * Requests a guarded background map of the repo containing `projectDir`.
 * Never throws; resolves as soon as the detached child is spawned.
 */
export async function requestAutoMap(projectDir, opts = {}) {
    if (!projectDir || !isAbsolute(projectDir))
        return "no-project-dir";
    const root = await gitRoot(projectDir);
    if (!root)
        return "not-git";
    if (root === (await canonical(homedir())))
        return "home";
    const now = opts.now ?? Date.now();
    const debounceMs = opts.debounceMs ?? AUTO_MAP_DEBOUNCE_MS;
    if (now - (await lastRequest(root)) < debounceMs)
        return "debounced";
    const ixBin = opts.ixBin ?? IX_BIN;
    if (!(await isMapped(root, ixBin)))
        return "not-mapped";
    try {
        await writeFile(await debounceFile(root), String(now), { encoding: "utf8", mode: 0o600 });
    }
    catch {
        // A missing stamp only means the next request is not debounced.
    }
    try {
        const child = spawn(ixBin, ["map", root, "--silent"], {
            cwd: root,
            env: { ...process.env, IX_AUTO_MAP: "1" },
            detached: true,
            stdio: "ignore",
        });
        child.on("error", () => { });
        child.unref();
    }
    catch {
        // non-fatal
    }
    return "spawned";
}
// ── Cursor payload helpers ────────────────────────────────────────────────────
/** Workspace roots from the payload, falling back to CURSOR_PROJECT_DIR. */
export function projectDirs(workspaceRoots) {
    const roots = Array.isArray(workspaceRoots)
        ? workspaceRoots.filter((r) => typeof r === "string" && isAbsolute(r))
        : [];
    if (roots.length > 0)
        return [...new Set(roots)];
    const envDir = process.env["CURSOR_PROJECT_DIR"];
    return envDir && isAbsolute(envDir) ? [envDir] : [];
}
/** The workspace root that contains `filePath`, if any. */
export function rootContaining(filePath, dirs) {
    if (!isAbsolute(filePath))
        return undefined;
    return dirs.find((dir) => {
        const rel = relative(dir, filePath);
        return rel !== "" && rel.split(sep)[0] !== ".." && !isAbsolute(rel);
    });
}
//# sourceMappingURL=auto-map.js.map