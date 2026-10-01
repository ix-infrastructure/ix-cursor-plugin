// Copyright 2026 Ix Infrastructure Inc.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ensureStateDir, stateDir } from "./state-dir.js";

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
// Per-user (see state-dir.ts), not a fixed path in the shared tmpdir.
const CACHE_SUBDIR = "cache";

function cacheFile(key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return join(stateDir(), CACHE_SUBDIR, `${safeKey}.json`);
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
    await ensureStateDir(CACHE_SUBDIR);
    await writeFile(cacheFile(key), JSON.stringify(entry), { encoding: "utf8", mode: 0o600 });
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
