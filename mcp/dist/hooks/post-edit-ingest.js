#!/usr/bin/env node
// Cursor afterFileEdit hook — incremental graph ingest after each file write.
//
// Fires after the agent edits or creates a file. Spawns `ix map <file>` as a
// fully detached process so it never delays the agent's next turn. Rate-limited
// to one ingest per file per 30 seconds to suppress burst re-ingests during
// multi-edit sessions.
//
// Async pattern: spawn detached child → unref → exit 0 immediately.
// The afterFileEdit event has no consumed output in Cursor, so hook verbosity
// does not change behavior here (documented Cursor limitation).
//
// Contract:
//   Always exits 0; never blocks; never produces meaningful stdout.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, relative } from "node:path";
import { join } from "node:path";
import { IX_BIN } from "../lib/config.js";
import { checkHealth } from "../lib/cli.js";
const RATE_LIMIT_MS = 30_000; // 30 seconds, matches Claude plugin
const RATE_DIR = join(tmpdir(), "ix-cursor-cache", "ingest-rate");
// ── Rate limiting ─────────────────────────────────────────────────────────────
function rateKey(filePath) {
    // Use a sanitized filename as the key — not a full hash, but sufficient for V1
    return basename(filePath).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}
async function isRateLimited(filePath) {
    const key = rateKey(filePath);
    const tsFile = join(RATE_DIR, key);
    try {
        const raw = await readFile(tsFile, "utf8");
        const last = parseInt(raw.trim(), 10);
        return Date.now() - last < RATE_LIMIT_MS;
    }
    catch {
        return false;
    }
}
async function recordIngest(filePath) {
    const key = rateKey(filePath);
    try {
        await mkdir(RATE_DIR, { recursive: true });
        await writeFile(join(RATE_DIR, key), String(Date.now()), "utf8");
    }
    catch {
        // non-fatal
    }
}
// ── Repo-relative path ────────────────────────────────────────────────────────
function toRelPath(filePath, workspaceRoots) {
    const root = process.env["CURSOR_PROJECT_DIR"] ??
        workspaceRoots[0] ??
        "";
    if (filePath.startsWith("/") && root) {
        const rel = relative(root, filePath);
        if (!rel.startsWith(".."))
            return rel;
    }
    return filePath;
}
// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    // Consume stdin
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    let payload = {};
    try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch {
        process.exit(0);
    }
    const filePath = payload.file_path ?? "";
    if (!filePath)
        process.exit(0);
    // Health gate
    const healthy = await checkHealth();
    if (!healthy)
        process.exit(0);
    // Rate limit — skip if this file was ingested within the last 30 seconds
    if (await isRateLimited(filePath))
        process.exit(0);
    const relPath = toRelPath(filePath, payload.workspace_roots ?? []);
    // Record ingest timestamp before spawning so concurrent edits are also suppressed
    await recordIngest(filePath);
    // Spawn ix map as a fully detached process — never block the agent turn.
    // Retry-once is implemented by chaining two calls in a minimal shell one-liner.
    // Shell injection is safe here: relPath is constructed from a controlled source,
    // and we quote it. In production, verify paths with allowlist logic (Phase 4.6).
    const child = spawn("sh", ["-c", `${IX_BIN} map "$1" 2>/dev/null || ${IX_BIN} map "$1" 2>/dev/null`, "--", relPath], { detached: true, stdio: "ignore" });
    child.unref();
    process.exit(0);
}
main().catch(() => {
    process.exit(0);
});
//# sourceMappingURL=post-edit-ingest.js.map