// Copyright 2026 Ix Infrastructure Inc.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureStateDir, stateDir } from "./state-dir.js";
const memoryCache = new Map();
// Per-user (see state-dir.ts), not a fixed path in the shared tmpdir.
const CACHE_SUBDIR = "cache";
function cacheFile(key) {
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    return join(stateDir(), CACHE_SUBDIR, `${safeKey}.json`);
}
async function readDiskEntry(key) {
    try {
        const raw = await readFile(cacheFile(key), "utf8");
        const parsed = JSON.parse(raw);
        if (typeof parsed.expiresAt !== "number") {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
async function writeDiskEntry(key, entry) {
    try {
        await ensureStateDir(CACHE_SUBDIR);
        await writeFile(cacheFile(key), JSON.stringify(entry), { encoding: "utf8", mode: 0o600 });
    }
    catch {
        // non-fatal
    }
}
export async function withCache(key, ttlMs, fn) {
    const now = Date.now();
    const memoryEntry = memoryCache.get(key);
    if (memoryEntry && memoryEntry.expiresAt > now) {
        return memoryEntry.value;
    }
    const diskEntry = await readDiskEntry(key);
    if (diskEntry && diskEntry.expiresAt > now) {
        memoryCache.set(key, diskEntry);
        return diskEntry.value;
    }
    const value = await fn();
    const entry = {
        expiresAt: now + ttlMs,
        value,
    };
    memoryCache.set(key, entry);
    await writeDiskEntry(key, entry);
    return value;
}
//# sourceMappingURL=cache.js.map