// Copyright 2026 Ix Infrastructure Inc.

// install.sh end to end, offline: `curl` is a stub that records the URL it was
// asked for and hands back a tarball built here, `ix` is a stub that reports a
// supported version, and `npm` is a stub that records every call. HOME points
// into a temp dir, so the install lands there and not in the real
// ~/.cursor/plugins/local.
//
// install.ps1 is checked only for the same source-level contract at the end:
// it needs PowerShell and Windows paths, which this suite does not run.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { PLUGIN_ROOT } from "../helpers/cursor-hooks.js";

const INSTALL_SH = join(PLUGIN_ROOT, "install.sh");
const INSTALL_PS1 = join(PLUGIN_ROOT, "install.ps1");
const ARCHIVE_BASE = "https://codeload.github.com/ix-infrastructure/ix-cursor-plugin/tar.gz/";

interface Options {
  env?: Record<string, string>;
  /** `version` written into the archive's .cursor-plugin/plugin.json. */
  archiveVersion?: string;
  /** Whether the archive carries the committed mcp/dist hooks. */
  withDist?: boolean;
  /** `npm` exits 127 instead of succeeding. */
  failingNpm?: boolean;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  urls: string[];
  npmCalls: string[];
  dest: string;
}

function stub(path: string, body: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

function lines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
}

function runInstaller(t: test.TestContext, opts: Options = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), "ix-cursor-installer-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const root = join(dir, "src", "ix-cursor-plugin-archive");
  mkdirSync(join(root, ".cursor-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".cursor-plugin", "plugin.json"),
    JSON.stringify({ name: "ix-memory", version: opts.archiveVersion ?? "0.2.4" }),
  );
  if (opts.withDist ?? true) {
    mkdirSync(join(root, "mcp", "dist", "hooks"), { recursive: true });
    writeFileSync(join(root, "mcp", "dist", "hooks", "prompt-briefing.js"), "// built\n");
  } else {
    mkdirSync(join(root, "mcp"), { recursive: true });
  }
  const archive = join(dir, "plugin.tar.gz");
  const tar = spawnSync("tar", ["-czf", archive, "-C", join(dir, "src"), "ix-cursor-plugin-archive"]);
  assert.equal(tar.status, 0, `tar failed: ${String(tar.stderr)}`);

  const bin = join(dir, "bin");
  mkdirSync(bin);
  stub(
    join(bin, "curl"),
    [
      'out=""; url=""',
      "while [ $# -gt 0 ]; do",
      '  case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac',
      "done",
      'printf "%s\\n" "$url" >> "$FAKE_CURL_LOG"',
      'cp "$FAKE_ARCHIVE" "$out"',
    ].join("\n"),
  );
  stub(join(bin, "ix"), 'echo "ix 0.12.0"');
  // Succeeds without doing anything, so a run that reaches npm still finishes
  // and the log says exactly what was asked of it.
  stub(
    join(bin, "npm"),
    'printf "%s\\n" "$*" >> "$FAKE_NPM_LOG"' + (opts.failingNpm ? '; echo "npm must not run" >&2; exit 127' : ""),
  );

  const home = join(dir, "home");
  const tmp = join(dir, "tmp");
  mkdirSync(home);
  mkdirSync(tmp);
  const curlLog = join(dir, "curl.log");
  const npmLog = join(dir, "npm.log");

  // A fresh env, not process.env: an IX_CURSOR_* in the caller's environment
  // must not leak into the run. The stub bin comes first, ahead of the real npm
  // that sits next to node.
  const env: Record<string, string> = {
    PATH: [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
    HOME: home,
    TMPDIR: tmp,
    FAKE_ARCHIVE: archive,
    FAKE_CURL_LOG: curlLog,
    FAKE_NPM_LOG: npmLog,
    ...opts.env,
  };
  const res = spawnSync("bash", [INSTALL_SH], { env, encoding: "utf8" });
  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    urls: lines(curlLog),
    npmCalls: lines(npmLog),
    dest: join(home, ".cursor", "plugins", "local", "ix-memory"),
  };
}

function assertInstalled(run: Run): void {
  assert.equal(run.status, 0, `install.sh failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  assert.ok(existsSync(join(run.dest, ".cursor-plugin", "plugin.json")), "plugin not installed");
}

test("default install fetches main, as before, and never runs npm when mcp/dist is present", (t) => {
  const run = runInstaller(t);
  assertInstalled(run);
  assert.deepEqual(run.urls, [`${ARCHIVE_BASE}refs/heads/main`]);
  assert.deepEqual(run.npmCalls, [], "npm ran although the archive ships mcp/dist");
});

test("npm is not even required when mcp/dist is present", (t) => {
  // npm resolves to a stub that fails: a run that asked for it would exit non-zero.
  const run = runInstaller(t, { failingNpm: true });
  assertInstalled(run);
  assert.deepEqual(run.npmCalls, []);
});

test("the summary says which version and ref were installed", (t) => {
  const run = runInstaller(t, { archiveVersion: "0.2.4" });
  assertInstalled(run);
  assert.match(run.stdout, /ix-memory 0\.2\.4 from ix-infrastructure\/ix-cursor-plugin@main/);
  // main is a moving branch, and the summary says so.
  assert.match(run.stdout, /branch/i);
});

test("IX_CURSOR_VERSION installs the v<version> tag", (t) => {
  for (const requested of ["0.3.0", "v0.3.0"]) {
    const run = runInstaller(t, { env: { IX_CURSOR_VERSION: requested }, archiveVersion: "0.3.0" });
    assertInstalled(run);
    assert.deepEqual(run.urls, [`${ARCHIVE_BASE}refs/tags/v0.3.0`], `for ${requested}`);
    assert.match(run.stdout, /ix-memory 0\.3\.0 from ix-infrastructure\/ix-cursor-plugin@refs\/tags\/v0\.3\.0/);
    assert.doesNotMatch(run.stdout, /branch/i);
    assert.equal(run.stderr, "", `unexpected warning for ${requested}: ${run.stderr}`);
  }
});

test("a tag whose manifest names another version installs with a warning", (t) => {
  const run = runInstaller(t, { env: { IX_CURSOR_VERSION: "0.3.0" }, archiveVersion: "0.2.9" });
  assertInstalled(run);
  assert.match(run.stderr, /0\.3\.0/);
  assert.match(run.stderr, /0\.2\.9/);
  assert.match(run.stdout, /ix-memory 0\.2\.9 /);
});

test("a malformed IX_CURSOR_VERSION is refused before anything is downloaded", (t) => {
  for (const bad of ["0.3", "latest", "1.2.3/../../x", "1.2.3 "]) {
    const run = runInstaller(t, { env: { IX_CURSOR_VERSION: bad } });
    assert.notEqual(run.status, 0, `accepted ${JSON.stringify(bad)}`);
    assert.match(run.stderr, /IX_CURSOR_VERSION/);
    assert.deepEqual(run.urls, []);
    assert.equal(existsSync(run.dest), false);
  }
});

test("IX_CURSOR_VERSION and IX_CURSOR_REF together are refused", (t) => {
  const run = runInstaller(t, { env: { IX_CURSOR_VERSION: "0.3.0", IX_CURSOR_REF: "main" } });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /IX_CURSOR_VERSION/);
  assert.match(run.stderr, /IX_CURSOR_REF/);
  assert.deepEqual(run.urls, []);
});

test("IX_CURSOR_REF takes a branch name, a full ref or a commit sha", (t) => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const cases: Array<[string, string]> = [
    ["some-branch", "refs/heads/some-branch"],
    ["refs/heads/some-branch", "refs/heads/some-branch"],
    ["refs/tags/v0.3.0", "refs/tags/v0.3.0"],
    [sha, sha],
  ];
  for (const [ref, path] of cases) {
    const run = runInstaller(t, { env: { IX_CURSOR_REF: ref } });
    assertInstalled(run);
    assert.deepEqual(run.urls, [`${ARCHIVE_BASE}${path}`], `for IX_CURSOR_REF=${ref}`);
  }
});

test("without mcp/dist the installer still builds the hooks with npm", (t) => {
  const run = runInstaller(t, { withDist: false });
  assertInstalled(run);
  assert.deepEqual(run.npmCalls, ["ci", "run build"]);
});

test("install.ps1 follows the same contract", () => {
  const src = readFileSync(INSTALL_PS1, "utf8");
  assert.doesNotMatch(src, /--omit=dev/, "install.ps1 still runs npm ci --omit=dev");
  assert.doesNotMatch(src, /node_modules/, "install.ps1 still keys an npm step on node_modules");
  assert.match(src, /IX_CURSOR_VERSION/);
  assert.match(src, /refs\/tags\/v\$Version/);
  assert.match(src, /refs\/heads\/\$Ref/);
});
