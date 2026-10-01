// Copyright 2026 Ix Infrastructure Inc.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AUTO_MAP_DEBOUNCE_MS,
  projectDirs,
  requestAutoMap,
  rootContaining,
} from "../../shared/auto-map.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MOCK_IX = resolve(TEST_DIR, "../fixtures/bin/ix");

interface Sandbox {
  dir: string;
  mapLog: string;
  callLog: string;
}

const ENV_KEYS = [
  "HOME",
  "XDG_STATE_HOME",
  "IX_MOCK_MAPPED_ROOTS",
  "IX_MOCK_MAP_LOG_FILE",
  "IX_MOCK_LOG_FILE",
  "IX_MOCK_STATE_FILE",
  "IX_AUTO_MAP",
  "CURSOR_PROJECT_DIR",
];

async function sandbox(t: test.TestContext, mapped: string[] = []): Promise<Sandbox> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ix-cursor-automap-")));
  const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));
  t.after(async () => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(dir, { recursive: true, force: true });
  });

  const box = { dir, mapLog: join(dir, "map.log"), callLog: join(dir, "ix.log") };
  process.env["HOME"] = join(dir, "home");
  process.env["XDG_STATE_HOME"] = join(dir, "state");
  process.env["IX_MOCK_MAP_LOG_FILE"] = box.mapLog;
  process.env["IX_MOCK_LOG_FILE"] = box.callLog;
  process.env["IX_MOCK_MAPPED_ROOTS"] = mapped.join(":");
  delete process.env["IX_MOCK_STATE_FILE"];
  delete process.env["IX_AUTO_MAP"];
  await mkdir(process.env["HOME"], { recursive: true });
  return box;
}

async function gitRepo(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  execFileSync("git", ["init", "-q", path]);
  return await realpath(path);
}

async function lines(path: string): Promise<string[]> {
  try {
    return (await readFile(path, "utf8")).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function waitForLines(path: string, count: number, timeoutMs = 3_000): Promise<string[]> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await lines(path);
    if (found.length >= count) return found;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${count} line(s) in ${path}`);
}

/** Gives a wrongly spawned detached map time to land before asserting none did. */
async function assertNoMap(box: Sandbox): Promise<void> {
  await delay(300);
  assert.deepEqual(await lines(box.mapLog), []);
}

function mapLine(root: string): string {
  return `path=${root}\tcwd=${root}\tIX_AUTO_MAP=1`;
}

test("non-git project dir never maps", async (t) => {
  const box = await sandbox(t);
  const plain = join(box.dir, "plain");
  await mkdir(plain);
  process.env["IX_MOCK_MAPPED_ROOTS"] = plain;

  assert.equal(await requestAutoMap(plain, { ixBin: MOCK_IX }), "not-git");
  await assertNoMap(box);
});

test("a repo rooted at $HOME never maps", async (t) => {
  const box = await sandbox(t);
  const home = await gitRepo(process.env["HOME"]!);
  process.env["IX_MOCK_MAPPED_ROOTS"] = home;
  await mkdir(join(home, "sub"));

  assert.equal(await requestAutoMap(join(home, "sub"), { ixBin: MOCK_IX }), "home");
  await assertNoMap(box);
});

test("a repo whose graph is not complete never maps (no implicit workspace)", async (t) => {
  const box = await sandbox(t);
  const repo = await gitRepo(join(box.dir, "repo"));

  assert.equal(await requestAutoMap(repo, { ixBin: MOCK_IX }), "not-mapped");
  await assertNoMap(box);
  assert.ok(
    (await lines(box.callLog)).includes(`status --format json --root ${repo}`),
    "the guard must ask ix status about the resolved root",
  );
});

test("an ix status failure counts as not mapped", async (t) => {
  const box = await sandbox(t);
  const repo = await gitRepo(join(box.dir, "repo"));
  process.env["IX_MOCK_MAPPED_ROOTS"] = repo;

  assert.equal(
    await requestAutoMap(repo, { ixBin: join(box.dir, "no-such-ix") }),
    "not-mapped",
  );
  await assertNoMap(box);
});

test("a mapped repo gets exactly `ix map <root> --silent`, cwd root, IX_AUTO_MAP=1", async (t) => {
  const box = await sandbox(t);
  const repo = await gitRepo(join(box.dir, "repo"));
  process.env["IX_MOCK_MAPPED_ROOTS"] = repo;
  await mkdir(join(repo, "src", "deep"), { recursive: true });

  // A project dir below the top level still maps the repo root.
  assert.equal(await requestAutoMap(join(repo, "src", "deep"), { ixBin: MOCK_IX }), "spawned");
  assert.deepEqual(await waitForLines(box.mapLog, 1), [mapLine(repo)]);
  assert.ok((await lines(box.callLog)).includes(`map ${repo} --silent`));

  // The debounce stamp lives in the per-user state dir, not the shared tmpdir.
  const stampDir = join(process.env["XDG_STATE_HOME"]!, "ix-cursor-plugin", "auto-map");
  assert.equal((await stat(stampDir)).mode & 0o777, 0o700);
});

test("a second request inside the debounce window does not map again", async (t) => {
  const box = await sandbox(t);
  const repo = await gitRepo(join(box.dir, "repo"));
  process.env["IX_MOCK_MAPPED_ROOTS"] = repo;
  const now = Date.now();

  assert.equal(await requestAutoMap(repo, { ixBin: MOCK_IX, now }), "spawned");
  await waitForLines(box.mapLog, 1);
  assert.equal(
    await requestAutoMap(repo, { ixBin: MOCK_IX, now: now + AUTO_MAP_DEBOUNCE_MS - 1 }),
    "debounced",
  );
  await delay(300);
  assert.equal((await lines(box.mapLog)).length, 1);

  // Once the window has passed the root maps again.
  assert.equal(
    await requestAutoMap(repo, { ixBin: MOCK_IX, now: now + AUTO_MAP_DEBOUNCE_MS }),
    "spawned",
  );
  assert.equal((await waitForLines(box.mapLog, 2)).length, 2);
});

test("two different roots do not debounce each other", async (t) => {
  const box = await sandbox(t);
  const a = await gitRepo(join(box.dir, "a"));
  const b = await gitRepo(join(box.dir, "b"));
  process.env["IX_MOCK_MAPPED_ROOTS"] = `${a}:${b}`;
  const now = Date.now();

  assert.equal(await requestAutoMap(a, { ixBin: MOCK_IX, now }), "spawned");
  assert.equal(await requestAutoMap(b, { ixBin: MOCK_IX, now }), "spawned");
  assert.deepEqual((await waitForLines(box.mapLog, 2)).sort(), [mapLine(a), mapLine(b)].sort());
});

test("missing or relative project dirs never map", async (t) => {
  const box = await sandbox(t);
  assert.equal(await requestAutoMap(undefined, { ixBin: MOCK_IX }), "no-project-dir");
  assert.equal(await requestAutoMap("relative/dir", { ixBin: MOCK_IX }), "no-project-dir");
  await assertNoMap(box);
});

test("project dirs come from the payload, then CURSOR_PROJECT_DIR — never the hook cwd", async (t) => {
  await sandbox(t);
  delete process.env["CURSOR_PROJECT_DIR"];
  assert.deepEqual(projectDirs(undefined), []);
  assert.deepEqual(projectDirs(["/w/a", "/w/a", "rel", 3]), ["/w/a"]);

  process.env["CURSOR_PROJECT_DIR"] = "/w/env";
  assert.deepEqual(projectDirs([]), ["/w/env"]);
  assert.deepEqual(projectDirs(["/w/a"]), ["/w/a"]);
});

test("an edited file maps only through the workspace root that contains it", () => {
  const roots = ["/w/a", "/w/b"];
  assert.equal(rootContaining("/w/b/src/x.ts", roots), "/w/b");
  assert.equal(rootContaining("/w/ab/x.ts", roots), undefined);
  assert.equal(rootContaining("/home/u/.cursor/x.json", roots), undefined);
  assert.equal(rootContaining("/w/a", roots), undefined);
  assert.equal(rootContaining("src/x.ts", roots), undefined);
});
