// Copyright 2026 Ix Infrastructure Inc.

// How the hooks start `ix`. The pure tests simulate win32 on any host; the
// host tests put a fake `ix` on PATH and drive the real hook code paths
// (checkHealth, runIx, isMapped, requestAutoMap). On Windows the fake is an
// `ix.cmd` launcher that forwards %* to node, and a second fake mirrors the
// installer's two-level bin\ix.cmd -> cli\ix.cmd -> node layout, so these
// run in CI's windows-latest job.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { batchLaunch, findExecutable, installerLaunch, ixLaunch, quoteCmdArg } from "../../lib/launch.js";

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

// Every cmd.exe special character on its own and mixed, % sequences cmd would
// expand, and backslash edge cases.
const CANARY_DIR = await realpath(await mkdtemp(join(tmpdir(), "ix-canary-")));
const MARKER = join(CANARY_DIR, "marker");
// Would leave MARKER behind if cmd.exe ran any part of them as a command.
const CANARIES = [
  `" & type nul > "${MARKER}" & "`,
  `^" & type nul > "${MARKER}" ^& "`,
  `& type nul > "${MARKER}"`,
  `%cd:~,%" | type nul > "${MARKER}" | "`,
];
const DEEP = [
  "&", "|", "<", ">", "^", '"', "%", "!", "(", ")",
  "a & b | c < d > e ^ f ( g ) ! h",
  'say "hi"', '""', "two words", " lead and trail ",
  "trailing\\", "\\", "dir\\\\", 'back\\"slash', "",
  "%PATH%", "%PATH:a=b%", "!PATH!", "%%", "%cd:~,%", "%~dp0", "100%",
  ...CANARIES,
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
  await rm(CANARY_DIR, { recursive: true, force: true });
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

test("win32 lookup skips relative PATH entries, never the working directory", async () => {
  const cwd = process.cwd();
  const rel = join(ROOT, "rel");
  await mkdir(rel, { recursive: true });
  await writeFile(join(rel, "ix.cmd"), "");
  await writeFile(join(rel, "ix"), "#!/bin/sh\n");
  await chmod(join(rel, "ix"), 0o755);
  try {
    process.chdir(ROOT);
    assert.equal(await findExecutable("ix", { platform: "win32", env: { PATH: "rel;.;", PATHEXT: ".CMD" } }), null);
    process.chdir(rel);
    assert.equal(await findExecutable("ix", { platform: "win32", env: { PATH: ".", PATHEXT: ".CMD" } }), null);
    if (!WIN) {
      assert.equal(await findExecutable("ix", { platform: "linux", env: { PATH: ".:rel:" } }), null);
    }
    // The same directory given absolute is found.
    assert.equal(await findExecutable("ix", { platform: "win32", env: { PATH: rel, PATHEXT: ".CMD" } }), join(rel, "ix.cmd"));
  } finally {
    process.chdir(cwd);
  }
});

test("a found path is cached for the process; a changed PATH is looked up again", async () => {
  const dir = join(ROOT, "cached");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "ix.cmd"), "");
  const env = { PATH: dir, PATHEXT: ".CMD" };
  assert.equal(await findExecutable("ix", { platform: "win32", env }), join(dir, "ix.cmd"));
  await rm(join(dir, "ix.cmd"));
  // No second walk of PATH x PATHEXT: the first answer stands.
  assert.equal(await findExecutable("ix", { platform: "win32", env }), join(dir, "ix.cmd"));
  assert.equal(await findExecutable("ix", { platform: "win32", env: { PATH: `${dir};${EMPTY_DIR}`, PATHEXT: ".CMD" } }), null);
});

test("win32 runs an unknown .cmd through cmd.exe /e:on /d /v:off /s /c with every argument quoted", async () => {
  const dir = join(ROOT, "launch");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "ix.cmd"), "");
  const env = { PATH: dir, PATHEXT: ".EXE;.CMD", ComSpec: "C:\\Windows\\system32\\cmd.exe" };

  const launch = await ixLaunch("ix", ["text", "a&b"], { platform: "win32", env });
  assert.equal(launch.file, "C:\\Windows\\system32\\cmd.exe");
  assert.equal(launch.windowsVerbatimArguments, true);
  assert.deepEqual(launch.args, [
    "/e:on",
    "/d",
    "/v:off",
    "/s",
    "/c",
    `""${join(dir, "ix.cmd")}" "text" "a&b""`,
  ]);
});

test("a % in the launcher path is written so the /c line does not expand it", () => {
  const launch = batchLaunch("C:\\100%\\ix.cmd", ["x"], { platform: "win32", env: {} });
  assert.equal(launch.file, "cmd.exe");
  assert.equal(launch.args.at(-1), '""C:\\100%%cd:~,%\\ix.cmd" "x""');
  assert.throws(() => batchLaunch('C:\\a"b\\ix.cmd', [], { platform: "win32", env: {} }), /launcher path/);
});

/** A fake installer home: bin\ix.cmd -> cli\ix.cmd -> node "<script>" %*. */
async function fakeInstall(name: string, innerLine: string | null, opts: { knownMain?: boolean } = {}) {
  const home = join(ROOT, name);
  await mkdir(join(home, "bin"), { recursive: true });
  await mkdir(join(home, "cli", "dist", "cli"), { recursive: true });
  const script = join(home, "cli", "main.js");
  await writeFile(script, INSTALL_MAIN);
  if (opts.knownMain) await writeFile(join(home, "cli", "dist", "cli", "main.js"), INSTALL_MAIN);
  await writeFile(join(home, "bin", "ix.cmd"), '@"%~dp0..\\cli\\ix.cmd" %*\r\n');
  if (innerLine !== null) {
    await writeFile(join(home, "cli", "ix.cmd"), `@echo off\r\n${innerLine.replace("<main>", script)}\r\n`);
  }
  return { home, launcher: join(home, "bin", "ix.cmd"), script, argvFile: join(home, "cli", "argv.json") };
}

// The fake CLI entry: records its argv next to itself and answers like `ix`.
const INSTALL_MAIN = [
  'const fs = require("fs"), path = require("path");',
  "const argv = process.argv.slice(2);",
  'fs.writeFileSync(path.join(__dirname, "argv.json"), JSON.stringify(argv));',
  "process.stdout.write(JSON.stringify({ argv, graphCompleted: true }) + '\\n');",
].join("\n");

// A node.exe for simulated win32 lookups; a link to this node, so it runs anywhere.
const NODE_DIR = join(ROOT, "node dir");
await mkdir(NODE_DIR);
// Windows may refuse a symlink without privileges; then a hard link, then a copy.
await symlink(process.execPath, join(NODE_DIR, "node.exe"))
  .catch(() => link(process.execPath, join(NODE_DIR, "node.exe")))
  .catch(() => copyFile(process.execPath, join(NODE_DIR, "node.exe")));

test("win32 starts the installer layout as node + script with no shell (simulated)", async () => {
  const env = { PATH: NODE_DIR, PATHEXT: ".EXE;.CMD" };
  const plain = await fakeInstall("install-plain", '@node "<main>" %*');
  assert.deepEqual(await installerLaunch(plain.launcher, { platform: "win32", env }), {
    node: join(NODE_DIR, "node.exe"),
    script: plain.script,
  });
  assert.deepEqual(
    await ixLaunch(plain.launcher, ["text", ...DEEP], { platform: "win32", env }),
    { file: join(NODE_DIR, "node.exe"), args: [plain.script, "text", ...DEEP], windowsVerbatimArguments: false },
  );
  // No cmd.exe means a line break is just data here.
  const nl = await ixLaunch(plain.launcher, ["a\r\nb"], { platform: "win32", env });
  assert.deepEqual(nl.args, [plain.script, "a\r\nb"]);

  // %~dp0-relative script, quoted node.
  const rel = await fakeInstall("install-dp0", '"node.exe" "%~dp0main.js" %*');
  assert.deepEqual(await installerLaunch(rel.launcher, { platform: "win32", env }), {
    node: join(NODE_DIR, "node.exe"),
    script: rel.script,
  });

  // No node on PATH: the Node running this plugin.
  const noNode = await fakeInstall("install-nonode", '@node "<main>" %*');
  assert.deepEqual(await installerLaunch(noNode.launcher, { platform: "win32", env: { PATH: EMPTY_DIR } }), {
    node: process.execPath,
    script: noNode.script,
  });
});

test("win32 falls back to the known CLI path, then to cmd.exe, when the layout is not recognised", async () => {
  const env = { PATH: NODE_DIR, PATHEXT: ".EXE;.CMD" };
  const known = await fakeInstall("install-known", "@call something-else %*", { knownMain: true });
  assert.deepEqual(await installerLaunch(known.launcher, { platform: "win32", env }), {
    node: join(NODE_DIR, "node.exe"),
    script: join(known.home, "cli", "dist", "cli", "main.js"),
  });

  for (const [name, line] of [
    ["install-other", "@call something-else %*"],
    ["install-var", '@node "%IX_HOME%\\main.js" %*'],
    ["install-nonnode", '@python "<main>" %*'],
    ["install-missing", null],
  ] as const) {
    const fake = await fakeInstall(name, line);
    assert.equal(await installerLaunch(fake.launcher, { platform: "win32", env }), null, name);
    const launch = await ixLaunch(fake.launcher, ["x"], { platform: "win32", env });
    assert.equal(launch.windowsVerbatimArguments, true, name);
    assert.deepEqual(launch.args.slice(0, 5), ["/e:on", "/d", "/v:off", "/s", "/c"], name);
  }
});

test("the installer layout, started as ixLaunch says, receives every argument exactly", async () => {
  const fake = await fakeInstall("install-run", '@node "<main>" %*');
  const env = { PATH: NODE_DIR, PATHEXT: ".EXE;.CMD" };
  const launch = await ixLaunch(fake.launcher, DEEP, { platform: "win32", env });
  execFileSync(launch.file, launch.args, { windowsHide: true });
  assert.deepEqual(JSON.parse(await readFile(fake.argvFile, "utf8")), DEEP);
  assert.equal(existsSync(MARKER), false);
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

test("quoteCmdArg: always quoted, \"\" for a quote, %%cd:~,% for %, no carets", () => {
  assert.equal(quoteCmdArg("ix"), '"ix"');
  assert.equal(quoteCmdArg("a&b|c<d>e^f(g)!h"), '"a&b|c<d>e^f(g)!h"');
  assert.equal(quoteCmdArg('say "hi"'), '"say ""hi"""');
  assert.equal(quoteCmdArg("trailing\\"), '"trailing\\\\"');
  assert.equal(quoteCmdArg('a\\"b'), '"a\\\\""b"');
  assert.equal(quoteCmdArg("a\\b"), '"a\\b"');
  assert.equal(quoteCmdArg(""), '""');
  assert.equal(quoteCmdArg("%PATH:a=b%"), '"%%cd:~,%PATH:a=b%%cd:~,%"');
  const carets = (x: string) => x.split("^").length - 1;
  for (const arg of DEEP) assert.equal(carets(quoteCmdArg(arg)), carets(arg), arg);
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
  const result = await runIx(["text", ...NASTY, ...DEEP]);
  assert.equal(result.ok, true, result.stderr);
  const { argv } = JSON.parse(result.stdout) as { argv: string[] };
  assert.deepEqual(argv, ["text", ...NASTY, ...DEEP, "--format", "json"]);
  assert.equal(existsSync(MARKER), false);
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

// ── Host, Windows only: through the installer's two-level launcher ───────────

test("windows: arguments reach node unchanged through cmd.exe and both launcher levels", { skip: !WIN }, async () => {
  const fake = await fakeInstall("two-level", '@node "<main>" %*');
  const launch = batchLaunch(fake.launcher, DEEP);
  const run = spawnSync(launch.file, launch.args, {
    cwd: CANARY_DIR,
    encoding: "utf8",
    windowsHide: true,
    windowsVerbatimArguments: launch.windowsVerbatimArguments,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(await readFile(fake.argvFile, "utf8")), DEEP);
  assert.equal(existsSync(MARKER), false);
});

test("windows: runIx starts the installer layout with node directly", { skip: !WIN }, async () => {
  const fake = await fakeInstall("two-level-path", '@node "<main>" %*');
  process.env["PATH"] = `${join(fake.home, "bin")}${delimiter}${ORIGINAL_PATH}`;
  const launch = await ixLaunch("ix", ["x"]);
  assert.match(launch.file, /node\.exe$/i);
  assert.equal(launch.windowsVerbatimArguments, false);
  assert.deepEqual(launch.args, [fake.script, "x"]);

  const result = await runIx(["text", ...DEEP]);
  assert.equal(result.ok, true, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(fake.argvFile, "utf8")), ["text", ...DEEP, "--format", "json"]);
  assert.equal(existsSync(MARKER), false);
});
