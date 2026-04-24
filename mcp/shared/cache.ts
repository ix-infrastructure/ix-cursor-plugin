import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
const CACHE_DIR = join(tmpdir(), "ix-cursor-cache");

function cacheFile(key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return join(CACHE_DIR, `${safeKey}.json`);
}

async function readDiskEntry<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await readFile(cacheFile(key), "utf8");
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (typeof parsed.expiresAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeDiskEntry<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cacheFile(key), JSON.stringify(entry), "utf8");
  } catch {
    // non-fatal
  }
}

export async function withCache<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const memoryEntry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (memoryEntry && memoryEntry.expiresAt > now) {
    return memoryEntry.value;
  }

  const diskEntry = await readDiskEntry<T>(key);
  if (diskEntry && diskEntry.expiresAt > now) {
    memoryCache.set(key, diskEntry);
    return diskEntry.value;
  }

  const value = await fn();
  const entry: CacheEntry<T> = {
    expiresAt: now + ttlMs,
    value,
  };

  memoryCache.set(key, entry);
  await writeDiskEntry(key, entry);
  return value;
}
