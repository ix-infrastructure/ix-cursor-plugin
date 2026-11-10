// Copyright 2026 Ix Infrastructure Inc.

// How the hooks start `ix`. The pure tests simulate win32 on any host; the
// host tests put a fake `ix` on PATH and drive the real hook code paths
// (checkHealth, runIx, isMapped, requestAutoMap). On Windows the fake is an
// `ix.cmd` launcher that forwards %* to node, the way an installed ix.cmd
// does, so these run in CI's windows-latest job.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { findExecutable, ixLaunch, quoteCmdArg } from "../../lib/launch.js";

const WIN = process.platform === "win32";

// Arguments cmd.exe would split, expand or eat if they were concatenated raw.
const NASTY = [
  "foo&bar",
  "a|b",
  'say "hi"',
  "100% ^caret <in> (out) !bang",
  "%PATH%",
  "semi;colon,comma",
  "trailing\\",
  'back\\"slash',
  "two words",
  "",
];

// Built before importing lib/cli.js, which reads IX_BIN at import time.
const ROOT = await realpath(await mkdtemp(join(tmpdir(), "ix launch & co ")));
const FAKE_DIR = join(ROOT, "bin dir");
const EMPTY_DIR = join(ROOT, "empty");
const LOG = join(ROOT, "calls.log");
await mkdir(FAKE_DIR);
await mkdir(EMPTY_DIR);
await writeFile(
  join(FAKE_DIR, "argv.cjs"),
  [
    'const fs = require("fs");',
    "const argv = process.argv.slice(2);",
    "if (process.env.IX_FAKE_LOG) fs.appendFileSync(process.env.IX_FAKE_LOG, JSON.stringify(argv) + '\\n');",
    "process.stdout.write(JSON.stringify({ argv, graphCompleted: true }) + '\\n');",
  ].join("\n"),
);
if (WIN) {
  await writeFile(
    join(FAKE_DIR, "ix.cmd"),
    `@echo off\r\n"${process.execPath}" "%~dp0argv.cjs" %*\r\n`,
  );
} else {
  await writeFile(
    join(FAKE_DIR, "ix"),
    `#!/bin/sh\nexec "${process.execPath}" "${join(FAKE_DIR, "argv.cjs")}" "$@"\n`,
  );
  await chmod(join(FAKE_DIR, "ix"), 0o755);
}

const ORIGINAL_PATH = process.env["PATH"] ?? "";
delete process.env["IX_BIN"];
process.env["XDG_STATE_HOME"] = join(ROOT, "state");
process.env["HOME"] = join(ROOT, "home");
process.env["USERPROFILE"] = join(ROOT, "home");
process.env["IX_FAKE_LOG"] = LOG;
await mkdir(join(ROOT, "home"));

const { checkHealth, runIx } = await import("../../lib/cli.js");
const { isMapped, requestAutoMap } = await import("../../shared/auto-map.js");

test.after(async () => {
  process.env["PATH"] = ORIGINAL_PATH;
  // A detached `ix map` may still hold the dir for a moment on Windows.
  await rm(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function withFakeOnPath(): void {
  process.env["PATH"] = `${FAKE_DIR}${delimiter}${ORIGINAL_PATH}`;
}

// ── Pure: resolution and quoting, win32 simulated on any host ────────────────

test("win32 lookup finds ix.cmd on PATH through PATHEXT, skipping empty and quoted entries", async () => {
  const dir = join(ROOT, "lookup");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "ix.cmd"), "@echo off\r\n");
  const env = { Path: `;"${EMPTY_DIR}";${dir}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" };

  assert.equal(await findExecutable("ix", { platform: "win32", env }), join(dir, "ix.cmd"));
  assert.equal(await findExecutable("ix.cmd", { platform: "win32", env }), join(dir, "ix.cmd"));
  assert.equal(await findExecutable("nope", { platform: "win32", env }), null);
  // A bare `ix` with no extension (a POSIX script) is not something Windows can start.
  await writeFile(join(EMPTY_DIR, "ix"), "#!/bin/sh\n");
  assert.equal(
    await findExecutable("ix", { platform: "win32", env: { PATH: EMPTY_DIR, PATHEXT: ".EXE;.CMD" } }),
    null,
  );
  await rm(join(EMPTY_DIR, "ix"));
});

test("win32 lookup honours PATHEXT order (.exe before .cmd)", async () => {
  const dir = join(ROOT, "order");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "ix.cmd"), "");
  await writeFile(join(dir, "ix.exe"), "");
  const env = { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  assert.equal(await findExecutable("ix", { platform: "win32", env }), join(dir, "ix.exe"));
});

test("an explicit path is checked as given, never searched on PATH", async () => {
  const env = { PATH: FAKE_DIR, PATHEXT: ".CMD" };
  assert.equal(await findExecutable(join(ROOT, "missing", "ix"), { platform: "win32", env }), null);
  const posixFake = join(ROOT, "posix-ix");
  await writeFile(posixFake, "#!/bin/sh\n");
  await chmod(posixFake, 0o755);
  if (!WIN) {
    assert.equal(await findExecutable(posixFake, { platform: "linux", env: { PATH: "" } }), posixFake);
    // Not executable: `command -v` would not have accepted it either.
    await chmod(posixFake, 0o644);
    assert.equal(await findExecutable(posixFake, { platform: "linux", env: { PATH: "" } }), null);
  }
});

test("POSIX launch is unchanged: the bare name, no shell, no verbatim args", async () => {
  assert.deepEqual(await ixLaunch("ix", ["text", "a&b"], { platform: "linux", env: {} }), {
    file: "ix",
    args: ["text", "a&b"],
    windowsVerbatimArguments: false,
  });
});

test("win32 runs a .cmd through cmd.exe /d /s /c with every argument escaped", async () => {
  const dir = join(ROOT, "launch");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "ix.cmd"), "");
  const env = { PATH: dir, PATHEXT: ".EXE;.CMD", ComSpec: "C:\\Windows\\system32\\cmd.exe" };

  const launch = await ixLaunch("ix", ["text", "a&b"], { platform: "win32", env });
  assert.equal(launch.file, "C:\\Windows\\system32\\cmd.exe");
  assert.equal(launch.windowsVerbatimArguments, true);
  assert.deepEqual(launch.args, [
    "/d",
    "/s",
    "/c",
    `""${join(dir, "ix.cmd")}" ${quoteCmdArg("text")} ${quoteCmdArg("a&b")}"`,
  ]);
});

test("win32 starts an .exe directly, and falls back to the bare name when nothing is found", async () => {
  const dir = join(ROOT, "exe");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "ix.exe"), "");
  const found = await ixLaunch("ix", ["status"], { platform: "win32", env: { PATH: dir } });
  assert.deepEqual(found, { file: join(dir, "ix.exe"), args: ["status"], windowsVerbatimArguments: false });
  const missing = await ixLaunch("ix", ["status"], { platform: "win32", env: { PATH: EMPTY_DIR } });
  assert.deepEqual(missing, { file: "ix", args: ["status"], windowsVerbatimArguments: false });
});

test("quoteCmdArg quotes for the program, then caret-escapes twice for cmd and the .cmd's %* line", () => {
  assert.equal(quoteCmdArg("ix"), '^^^"ix^^^"');
  assert.equal(quoteCmdArg("a&b"), '^^^"a^^^&b^^^"');
  assert.equal(quoteCmdArg('say "hi"'), '^^^"say^^^ \\^^^"hi\\^^^"^^^"');
  assert.equal(quoteCmdArg("trailing\\"), '^^^"trailing\\\\^^^"');
  assert.equal(quoteCmdArg('a\\"b'), '^^^"a\\\\\\^^^"b^^^"');
  assert.equal(quoteCmdArg(""), '^^^"^^^"');
});

test("an argument with a line break is refused rather than cut at the newline", async () => {
  assert.throws(() => quoteCmdArg("a\nb"), /line break/);
  const dir = join(ROOT, "launch");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "ix.cmd"), "");
  await assert.rejects(
    ixLaunch("ix", ["text", "a\r\nb"], { platform: "win32", env: { PATH: dir, PATHEXT: ".CMD" } }),
    /line break/,
  );
});

// ── Host: the real hook paths against a fake ix on PATH ──────────────────────

test("checkHealth is false without ix on PATH and true with it (ix.cmd on Windows)", async () => {
  process.env["PATH"] = EMPTY_DIR;
  assert.equal(await checkHealth(), false);
  withFakeOnPath();
  assert.equal(await checkHealth(), true);
});

test("every argument, metacharacters and quotes included, reaches ix as one argument", async () => {
  withFakeOnPath();
  const result = await runIx(["text", ...NASTY]);
  assert.equal(result.ok, true, result.stderr);
  const { argv } = JSON.parse(result.stdout) as { argv: string[] };
  assert.deepEqual(argv, ["text", ...NASTY, "--format", "json"]);
});

test("auto-map: ix status and the detached ix map both start through the launcher", async () => {
  withFakeOnPath();
  const repo = join(ROOT, "repo & more");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", repo]);
  const root = await realpath(repo);

  assert.equal(await isMapped(root, "ix"), true);
  assert.equal(await requestAutoMap(root, { ixBin: "ix" }), "spawned");

  const started = Date.now();
  let maps: string[][] = [];
  while (Date.now() - started < 10_000) {
    const calls = (await readFile(LOG, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[]);
    maps = calls.filter((c) => c[0] === "map");
    if (maps.length > 0) break;
    await delay(50);
  }
  assert.deepEqual(maps, [["map", root, "--silent"]]);
});
