import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = resolve(TEST_DIR, "../..");
const FIXTURE_DIR = resolve(TEST_DIR, "../fixtures/ix_outputs");
const MOCK_IX_PATH = resolve(TEST_DIR, "../fixtures/bin/ix");

process.env["IX_BIN"] = MOCK_IX_PATH;
process.env["IX_HOOK_VERBOSITY"] = "brief";

interface HookResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface ToolResponse {
  ok: boolean;
  tool: string;
  summary?: string;
  data?: {
    subsystems?: Array<{ name?: string }>;
    graph?: {
      map_rev?: number;
    };
  };
  error?: {
    code: string;
    message: string;
  };
}

type ToolCallback = (rawInput: unknown, extra: unknown) => Promise<{
  content: Array<{ type: string; text: string }>;
}>;

class FakeServer {
  readonly callbacks = new Map<string, ToolCallback>();

  tool(
    name: string,
    _description: string,
    _paramsSchema: unknown,
    cb: ToolCallback,
  ): void {
    this.callbacks.set(name, cb);
  }
}

function fixtureEnv(tempDir: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    IX_BIN: MOCK_IX_PATH,
    IX_HOOK_VERBOSITY: "brief",
    IX_MOCK_LOG_FILE: join(tempDir, "ix.log"),
    IX_MOCK_STATE_FILE: join(tempDir, "ix-state.txt"),
    IX_MOCK_BRIEFING_FILE: join(FIXTURE_DIR, "briefing.json"),
    IX_MOCK_SUBSYSTEMS_FILE: join(FIXTURE_DIR, "subsystems_before_map.json"),
    IX_MOCK_SUBSYSTEMS_AFTER_MAP_FILE: join(FIXTURE_DIR, "subsystems_after_map.json"),
    IX_MOCK_IMPACT_FILE: join(FIXTURE_DIR, "impact_high.json"),
    CURSOR_PROJECT_DIR: "/repo",
    TMPDIR: tempDir,
    ...extra,
  };
}

function requiredEnv(env: Record<string, string>, key: string): string {
  const value = env[key];
  assert.ok(value, `Missing required test env '${key}'`);
  return value;
}

async function runHook(
  entryRelativePath: string,
  payload: unknown,
  env: Record<string, string>,
): Promise<HookResult> {
  const entryPath = resolve(MCP_ROOT, entryRelativePath);

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", entryPath],
      {
        cwd: MCP_ROOT,
        env: {
          ...process.env,
          ...env,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk as Buffer));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk as Buffer));
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({
        code: code ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
        stderr: Buffer.concat(stderrChunks).toString("utf8").trim(),
      });
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

async function readLogLines(logPath: string): Promise<string[]> {
  try {
    const raw = await readFile(logPath, "utf8");
    return raw.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function waitForFile(filePath: string, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await access(filePath);
      return;
    } catch {
      await delay(50);
    }
  }

  throw new Error(`Timed out waiting for ${filePath}`);
}

async function waitForLogLine(logPath: string, needle: string, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const lines = await readLogLines(logPath);
    if (lines.some((line) => line.includes(needle))) {
      return;
    }
    await delay(50);
  }

  throw new Error(`Timed out waiting for log entry '${needle}' in ${logPath}`);
}

async function invokeSubsystemsTool(env: Record<string, string>): Promise<ToolResponse> {
  const previousValues = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previousValues.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    const mod = await import(new URL("../../tools/subsystems.ts", import.meta.url).href);
    const server = new FakeServer();
    mod.register(server as never);

    const callback = server.callbacks.get("ix_subsystems");
    assert.ok(callback, "ix_subsystems should be registered");

    const response = await callback({}, {});
    assert.equal(response.content[0]?.type, "text");

    return JSON.parse(response.content[0]!.text) as ToolResponse;
  } finally {
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("prompt briefing injects context and subsystem tool returns structured data", { concurrency: false }, async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "ix-cursor-itest-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const env = fixtureEnv(tempDir);
  const logPath = requiredEnv(env, "IX_MOCK_LOG_FILE");

  const hookResult = await runHook(
    "hooks/prompt-briefing.ts",
    { prompt: "What subsystems are in this repo?" },
    env,
  );

  assert.equal(hookResult.code, 0, hookResult.stderr);
  assert.ok(hookResult.stdout, "prompt briefing hook should emit JSON");

  const hookJson = JSON.parse(hookResult.stdout) as {
    continue?: boolean;
    additional_context?: string;
  };

  assert.equal(hookJson.continue, true);
  assert.match(hookJson.additional_context ?? "", /\[ix\] Session briefing:/);
  assert.match(hookJson.additional_context ?? "", /Ship Cursor plugin integration tests/);

  await waitForLogLine(logPath, "briefing --format json");

  const toolResult = await invokeSubsystemsTool(env);
  assert.equal(toolResult.ok, true, JSON.stringify(toolResult.error));
  assert.equal(toolResult.tool, "ix_subsystems");
  assert.equal(toolResult.data?.graph?.map_rev, 101);
  assert.deepEqual(
    toolResult.data?.subsystems?.map((subsystem) => subsystem.name),
    ["Hooks", "Tools"],
  );

  const logLines = await readLogLines(logPath);
  assert.ok(logLines.some((line) => line.includes("subsystems --format json")));
});

test("pre-edit hook warns for high-risk file edits", { concurrency: false }, async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "ix-cursor-itest-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const env = fixtureEnv(tempDir);
  const result = await runHook(
    "hooks/pre-edit.ts",
    {
      tool_name: "Edit",
      tool_input: { file_path: "/repo/src/shared.ts" },
      cwd: "/repo",
    },
    env,
  );

  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout, "pre-edit hook should emit advisory JSON");

  const output = JSON.parse(result.stdout) as {
    permission?: string;
    agent_message?: string;
  };

  assert.equal(output.permission, "allow");
  assert.match(output.agent_message ?? "", /HIGH-RISK EDIT/);
  assert.match(output.agent_message ?? "", /shared\.ts has 5 dependents/);

  await waitForLogLine(requiredEnv(env, "IX_MOCK_LOG_FILE"), "impact src/shared.ts --format json");
});

/**
 * `runIx` keeps stdout when ix exits non-zero, but this hook used to discard it
 * on `!result.ok` — so a body that arrived with a failing exit status was
 * thrown away. Since ix-infrastructure/Ix#547 that is the normal shape of a
 * refusal, and Ix#539 asks the plugins to tolerate it before the CLI starts
 * producing it.
 */
test("pre-edit hook still warns when ix exits non-zero with a usable body", { concurrency: false }, async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "ix-cursor-itest-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const env = fixtureEnv(tempDir, { IX_MOCK_IMPACT_EXIT: "1" });
  const result = await runHook(
    "hooks/pre-edit.ts",
    { tool_name: "Edit", tool_input: { file_path: "/repo/src/shared.ts" }, cwd: "/repo" },
    env,
  );

  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout, "a non-zero exit must not discard the impact body");

  const output = JSON.parse(result.stdout) as { permission?: string; agent_message?: string };
  assert.equal(output.permission, "allow");
  assert.match(output.agent_message ?? "", /HIGH-RISK EDIT/);
});

/** The other half: a refusal body carries no risk, so the hook stays quiet. */
test("pre-edit hook stays silent when ix refuses the target", { concurrency: false }, async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "ix-cursor-itest-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const refusal = join(tempDir, "unresolved.json");
  await writeFile(
    refusal,
    JSON.stringify({ error: "unresolved_target", message: 'No entity found matching "shared.ts".' }),
  );

  const env = fixtureEnv(tempDir, { IX_MOCK_IMPACT_EXIT: "1", IX_MOCK_IMPACT_FILE: refusal });
  const result = await runHook(
    "hooks/pre-edit.ts",
    { tool_name: "Edit", tool_input: { file_path: "/repo/src/shared.ts" }, cwd: "/repo" },
    env,
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), "", "a refusal is not a risk warning");
});

test("post-edit ingest triggers async map and follow-up subsystem query reflects updated graph state", { concurrency: false }, async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), "ix-cursor-itest-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const env = fixtureEnv(tempDir);
  const statePath = requiredEnv(env, "IX_MOCK_STATE_FILE");
  const logPath = requiredEnv(env, "IX_MOCK_LOG_FILE");

  const before = await invokeSubsystemsTool(env);
  assert.equal(before.data?.graph?.map_rev, 101);

  const hookResult = await runHook(
    "hooks/post-edit-ingest.ts",
    {
      file_path: "/repo/src/new-test.ts",
      workspace_roots: ["/repo"],
    },
    env,
  );

  assert.equal(hookResult.code, 0, hookResult.stderr);
  assert.equal(hookResult.stdout, "");

  await waitForFile(statePath);
  await waitForLogLine(logPath, "map src/new-test.ts");

  const after = await invokeSubsystemsTool(env);
  assert.equal(after.ok, true, JSON.stringify(after.error));
  assert.equal(after.data?.graph?.map_rev, 102);
  assert.deepEqual(
    after.data?.subsystems?.map((subsystem) => subsystem.name),
    ["Hooks", "Tools", "Tests"],
  );
});
