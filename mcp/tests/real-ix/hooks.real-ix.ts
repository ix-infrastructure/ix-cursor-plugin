// Copyright 2026 Ix Infrastructure Inc.

// The plugin's hooks against a RELEASED `ix`, with no backend.
//
// Everything in tests/integration drives the POSIX mock in tests/fixtures/bin,
// whose output we wrote. This file runs the hooks exactly as Cursor does — the
// `node .../mcp/dist/hooks/<name>.js` commands from hooks/hooks.json — with
// the real CLI on PATH and IX_ENDPOINT pointing at a port nothing answers on.
// It checks that the hooks read what real ix actually prints (its JSON error
// records and its unreachable-backend failures), answer in Cursor's protocol,
// and that every ix argv the plugin builds is one this CLI accepts.
//
// Named *.real-ix.ts so `npm test` (tests/**/*.test.ts) never picks it up: it
// needs the real binary. Run with `npm run test:real-ix`; CI's `real ix` job
// installs a pinned release first.

import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseIxJson } from "../../lib/parser.js";
import { PLUGIN_ROOT, assertOutputFields, commonInput, registrationsOf } from "../helpers/cursor-hooks.js";

// ── Environment guard ─────────────────────────────────────────────────────────

const ENDPOINT = process.env["IX_ENDPOINT"] ?? "";
assert.ok(ENDPOINT, "set IX_ENDPOINT to an address nothing listens on (CI: http://127.0.0.1:1)");
assert.doesNotMatch(
  ENDPOINT,
  /:(8090|8091|8100|8529)\b/,
  "refusing to run against a real backend port",
);
assert.equal(process.env["IX_BIN"], undefined, "IX_BIN must be unset: the hooks must find the real `ix` on PATH");

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "ix-real-")));
const HOME = join(TMP, "home");
const IX_HOME = join(TMP, "ix-home");
const STATE = join(TMP, "state");
const PROJ = join(TMP, "proj");
mkdirSync(HOME);
mkdirSync(IX_HOME);
mkdirSync(PROJ);
execFileSync("git", ["init", "-q", PROJ]);
writeFileSync(
  join(PROJ, "widget.ts"),
  "export function resolveWidgetConfig(name: string) {\n  return { name };\n}\n",
);
writeFileSync(join(PROJ, "use.ts"), 'import { resolveWidgetConfig } from "./widget";\nresolveWidgetConfig("a");\n');

const BASE_ENV: Record<string, string> = {
  PATH: process.env["PATH"] ?? "",
  HOME,
  IX_HOME,
  IX_ENDPOINT: ENDPOINT,
  IX_NO_UPDATE_CHECK: "1",
  XDG_STATE_HOME: STATE,
  IX_HOOK_VERBOSITY: "brief",
  CURSOR_PLUGIN_ROOT: PLUGIN_ROOT,
};

/** Registers PROJ as an ix workspace, so read commands go to the (absent) backend. */
function registerWorkspace(): void {
  writeFileSync(
    join(IX_HOME, "config.yaml"),
    `workspaces:\n  - workspace_id: "1"\n    workspace_name: proj\n    root_path: ${PROJ}\n    default: true\n`,
  );
}

// ── Running hooks the way Cursor does ─────────────────────────────────────────

interface HookRun {
  code: number;
  stdout: string;
  ms: number;
  log: string;
}

const debugLogs: string[] = [];

async function runHook(script: string, event: string, payload: Record<string, unknown>): Promise<HookRun> {
  const entry = registrationsOf(script).find((e) => e.event === event);
  assert.ok(entry, `hooks.json registers ${script} for ${event}`);
  // `node "${CURSOR_PLUGIN_ROOT}/mcp/dist/hooks/x.js"` -> argv, root substituted.
  const argv = [...entry.command.matchAll(/"([^"]+)"|(\S+)/g)].map((m) =>
    (m[1] ?? m[2]!).replace("${CURSOR_PLUGIN_ROOT}", PLUGIN_ROOT),
  );
  const log = join(TMP, `debug-${debugLogs.length}.log`);
  debugLogs.push(log);
  const start = Date.now();
  return await new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: TMP,
      env: { ...BASE_ENV, IX_DEBUG_LOG: log },
      stdio: ["pipe", "pipe", "ignore"],
    });
    const out: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      const ms = Date.now() - start;
      assert.ok(ms < (entry.timeout ?? 10) * 1000, `${script} finished inside its ${entry.timeout}s Cursor timeout (${ms} ms)`);
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out).toString("utf8").trim(),
        ms,
        log: existsSync(log) ? readFileSync(log, "utf8") : "",
      });
    });
    child.stdin.end(JSON.stringify({ ...commonInput(event, [PROJ]), ...payload }));
  });
}

function ix(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync("ix", args, { cwd: PROJ, env: BASE_ENV, encoding: "utf8", timeout: 30_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const grepPayload = {
  tool_name: "Grep",
  tool_input: { pattern: "resolveWidgetConfig", path: PROJ },
  cwd: PROJ,
};

// ── Tests (order matters: unmapped first, then a registered workspace) ────────

test("the real ix release is on PATH, not the test mock", () => {
  const r = ix(["--version"]);
  assert.equal(r.code, 0);
  const expected = process.env["IX_EXPECTED_VERSION"];
  if (expected) assert.equal(r.stdout.trim(), expected);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("parser reads ix's real error record (unmapped workspace)", () => {
  const r = ix(["locate", "resolveWidgetConfig", "--format", "json"]);
  assert.notEqual(r.code, 0, "an unmapped dir is a failure exit");
  const record = parseIxJson(r.stdout) as { error?: string; message?: string };
  assert.equal(record.error, "workspace_not_mapped");
  assert.equal(typeof record.message, "string");
});

test("postToolUse Grep, unmapped: locate's error record is no answer, ripgrep hits still reported", async () => {
  const r = await runHook("pre-search", "postToolUse", grepPayload);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout) as Record<string, unknown>;
  assertOutputFields("postToolUse", out);
  const ctx = String(out["additional_context"]);
  assert.match(ctx, /text hits in (widget|use)\.ts/);
  assert.doesNotMatch(ctx, /symbol:|candidates:|workspace_not_mapped/, "an error record must not read as a symbol");
  assert.match(r.log, /CMD ix text resolveWidgetConfig --limit 15 --format json/);
  assert.match(r.log, /CMD ix locate resolveWidgetConfig --format json/);
});

test("postToolUse Write, unmapped: impact's exit-1 error body is parsed and stays silent", async () => {
  const r = await runHook("edit-impact", "postToolUse", {
    tool_name: "Write",
    tool_input: { file_path: join(PROJ, "widget.ts") },
  });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "", "no warning from an error record");
  assert.match(r.log, /CMD ix impact widget\.ts --format json/);
});

test("backend unreachable: every hook exits 0 and answers in Cursor's protocol", async () => {
  registerWorkspace();
  assert.notEqual(ix(["impact", "widget.ts", "--format", "json"]).code, 0, "impact really fails with no backend");

  const grep = await runHook("pre-search", "postToolUse", grepPayload);
  assert.equal(grep.code, 0);
  const out = JSON.parse(grep.stdout) as Record<string, unknown>;
  assertOutputFields("postToolUse", out);
  assert.match(String(out["additional_context"]), /text hits in/, "ix text needs no backend");

  const write = await runHook("edit-impact", "postToolUse", {
    tool_name: "Write",
    tool_input: { file_path: join(PROJ, "widget.ts") },
  });
  assert.deepEqual([write.code, write.stdout], [0, ""]);

  const session = await runHook("prompt-briefing", "sessionStart", {});
  assert.equal(session.code, 0);
  if (session.stdout) assertOutputFields("sessionStart", JSON.parse(session.stdout) as Record<string, unknown>);

  const shell = await runHook("shell-search", "postToolUse", {
    tool_name: "Shell",
    tool_input: { command: "rg resolveWidgetConfig", working_directory: PROJ },
  });
  assert.equal(shell.code, 0);
  if (shell.stdout) assertOutputFields("postToolUse", JSON.parse(shell.stdout) as Record<string, unknown>);

  for (const [script, event, payload] of [
    ["post-edit-ingest", "afterFileEdit", { file_path: join(PROJ, "widget.ts") }],
    ["debounced-map", "stop", {}],
  ] as const) {
    const r = await runHook(script, event, payload);
    assert.deepEqual([r.code, r.stdout], [0, ""], `${script}`);
  }
  // `ix status` cannot confirm the graph, so no automatic map was requested.
  const stamps = join(STATE, "ix-cursor-plugin", "auto-map");
  assert.deepEqual(existsSync(stamps) ? readdirSync(stamps) : [], [], "no auto-map debounce stamp written");
});

test("every ix argv the plugin builds is accepted by this CLI (no unknown option)", () => {
  // Argv the hooks actually ran, from their own debug log (lib/cli.ts).
  const ran = debugLogs
    .filter(existsSync)
    .flatMap((f) => readFileSync(f, "utf8").split("\n"))
    .filter((l) => l.includes("] CMD "))
    .map((l) => l.slice(l.indexOf("] CMD ") + 6).split(" ").slice(1));
  assert.ok(ran.length >= 4, `hooks invoked ix (${ran.length} calls logged)`);
  // shared/auto-map.ts builds these two without lib/cli.ts, and with no backend
  // the map is never reached, so they are listed here. Keep in step with
  // isMapped() and requestAutoMap().
  const autoMap = [
    ["status", "--format", "json", "--root", PROJ],
    ["map", PROJ, "--silent"],
  ];
  // Plus the optional Grep filters pre-search adds when Cursor passes them.
  const optional = [["text", "resolveWidgetConfig", "--limit", "15", "--path", ".", "--language", "typescript", "--format", "json"]];
  const rejected: string[] = [];
  for (const args of [...ran, ...autoMap, ...optional]) {
    const r = ix(args);
    if (/unknown (option|command)|too many arguments|missing required argument/i.test(r.stderr)) {
      rejected.push(`ix ${args.join(" ")}\n    ${r.stderr.trim().split("\n")[0]}`);
    }
  }
  assert.deepEqual(rejected, [], `this ix rejects argv the plugin uses:\n  ${rejected.join("\n  ")}`);
});
