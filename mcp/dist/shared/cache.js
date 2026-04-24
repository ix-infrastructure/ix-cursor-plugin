import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const memoryCache = new Map();
const CACHE_DIR = join(tmpdir(), "ix-cursor-cache");
function cacheFile(key) {
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    return join(CACHE_DIR, `${safeKey}.json`);
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
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(cacheFile(key), JSON.stringify(entry), "utf8");
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