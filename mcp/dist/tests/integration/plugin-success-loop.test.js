// Copyright 2026 Ix Infrastructure Inc.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertOutputFields, commonInput, modelVisibleText, registrationsOf, } from "../helpers/cursor-hooks.js";
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = resolve(TEST_DIR, "../..");
const FIXTURE_DIR = resolve(TEST_DIR, "../fixtures/ix_outputs");
const MOCK_IX_PATH = resolve(TEST_DIR, "../fixtures/bin/ix");
process.env["IX_BIN"] = MOCK_IX_PATH;
process.env["IX_HOOK_VERBOSITY"] = "brief";
class FakeServer {
    callbacks = new Map();
    tool(name, _description, _paramsSchema, cb) {
        this.callbacks.set(name, cb);
    }
}
function fixtureEnv(tempDir, extra = {}) {
    return {
        IX_BIN: MOCK_IX_PATH,
        IX_HOOK_VERBOSITY: "brief",
        IX_MOCK_LOG_FILE: join(tempDir, "ix.log"),
        IX_MOCK_LOG_CWD: "1",
        IX_MOCK_STATE_FILE: join(tempDir, "ix-state.txt"),
        IX_MOCK_BRIEFING_FILE: join(FIXTURE_DIR, "briefing.json"),
        IX_MOCK_SUBSYSTEMS_FILE: join(FIXTURE_DIR, "subsystems_before_map.json"),
        IX_MOCK_SUBSYSTEMS_AFTER_MAP_FILE: join(FIXTURE_DIR, "subsystems_after_map.json"),
        IX_MOCK_IMPACT_FILE: join(FIXTURE_DIR, "impact_high.json"),
        IX_MOCK_MAP_LOG_FILE: join(tempDir, "map.log"),
        IX_MOCK_TEXT_FILE: join(FIXTURE_DIR, "text_hits.json"),
        CURSOR_PROJECT_DIR: "/repo",
        TMPDIR: tempDir,
        // Plugin state (caches, debounce stamps) is per-user; keep it per-test.
        XDG_STATE_HOME: join(tempDir, "state"),
        ...extra,
    };
}
function requiredEnv(env, key) {
    const value = env[key];
    assert.ok(value, `Missing required test env '${key}'`);
    return value;
}
async function runHook(entryRelativePath, payload, env) {
    const entryPath = resolve(MCP_ROOT, entryRelativePath);
    return await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, ["--import", "tsx", entryPath], {
            cwd: MCP_ROOT,
            env: {
                ...process.env,
                ...env,
            },
            stdio: ["pipe", "pipe", "pipe"],
        });
        const stdoutChunks = [];
        const stderrChunks = [];
        child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
        child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
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
/**
 * Runs mcp/hooks/<name>.ts once for each event hooks/hooks.json registers it
 * on (optionally only `event`), with the documented common input, and checks
 * the output against Cursor's schema for that event. Returns the parsed output
 * per event ({} for no output).
 */
async function runRegistered(name, input, env, workspaceRoots, only) {
    const registrations = registrationsOf(name).filter((r) => !only || r.event === only);
    assert.ok(registrations.length > 0, `hooks.json does not register ${name}${only ? ` on ${only}` : ""}`);
    const outputs = new Map();
    for (const { event } of registrations) {
        const result = await runHook(`hooks/${name}.ts`, { ...commonInput(event, workspaceRoots), ...input(event) }, env);
        assert.equal(result.code, 0, `${name} on ${event}: ${result.stderr}`);
        const output = result.stdout ? JSON.parse(result.stdout) : {};
        assertOutputFields(event, output);
        outputs.set(event, output);
    }
    return outputs;
}
async function gitRepo(path) {
    await mkdir(path, { recursive: true });
    execFileSync("git", ["init", "-q", path]);
    return await realpath(path);
}
async function readLogLines(logPath) {
    try {
        const raw = await readFile(logPath, "utf8");
        return raw.split("\n").map((line) => line.trim()).filter(Boolean);
    }
    catch {
        return [];
    }
}
async function waitForFile(filePath, timeoutMs = 2_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            await access(filePath);
            return;
        }
        catch {
            await delay(50);
        }
    }
    throw new Error(`Timed out waiting for ${filePath}`);
}
async function waitForLogLine(logPath, needle, timeoutMs = 2_000) {
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
async function invokeSubsystemsTool(env) {
    const previousValues = new Map();
    for (const [key, value] of Object.entries(env)) {
        previousValues.set(key, process.env[key]);
        process.env[key] = value;
    }
    try {
        // Reads the graph through lib/cli, the layer the hooks use. This used to go
        // through tools/subsystems; the CLI's own `ix mcp` serves those tools now,
        // so what is left to prove here is that the hook loop's writes are visible
        // to a subsequent read, not how a tool wrapper shaped its envelope.
        const { runIx } = await import("../../lib/cli.js");
        const result = await runIx(["subsystems"]);
        assert.ok(result.ok, `ix subsystems failed: ${result.stderr}`);
        return JSON.parse(result.stdout);
    }
    finally {
        for (const [key, value] of previousValues.entries()) {
            if (value === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = value;
            }
        }
    }
}
test("session briefing reaches the model through sessionStart additional_context", { concurrency: false }, async (t) => {
    const tempDir = await realpath(await mkdtemp(join(tmpdir(), "ix-cursor-itest-")));
    t.after(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });
    const repo = await gitRepo(join(tempDir, "repo"));
    const env = fixtureEnv(tempDir);
    const logPath = requiredEnv(env, "IX_MOCK_LOG_FILE");
    const outputs = await runRegistered("prompt-briefing", () => ({ session_id: "conv-1", is_background_agent: false, composer_mode: "agent" }), env, [repo]);
    // Registered on sessionStart only, and its text is in a field Cursor reads.
    assert.deepEqual([...outputs.keys()], ["sessionStart"]);
    const context = modelVisibleText("sessionStart", outputs.get("sessionStart"));
    assert.match(context, /\[ix\] Session briefing:/);
    assert.match(context, /Ship Cursor plugin integration tests/);
    await waitForLogLine(logPath, `briefing --format json\tcwd=${repo}`);
    const toolResult = await invokeSubsystemsTool(env);
    assert.equal(toolResult.map_rev, 101);
    assert.deepEqual(toolResult.regions?.map((region) => region.label), ["Hooks", "Tools"]);
    const logLines = await readLogLines(logPath);
    assert.ok(logLines.some((line) => line.includes("subsystems --format json")));
});
async function editFixture(t) {
    const tempDir = await realpath(await mkdtemp(join(tmpdir(), "ix-cursor-itest-")));
    t.after(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });
    const repo = await gitRepo(join(tempDir, "repo"));
    await mkdir(join(repo, "src"));
    const file = join(repo, "src", "shared.ts");
    await writeFile(file, "export const x = 1;\n");
    return { tempDir, repo, file };
}
const writeInput = (file, repo) => () => ({
    tool_name: "Write",
    tool_input: { file_path: file },
    tool_use_id: "tu-1",
    cwd: repo,
});
test("edit-impact warns the model after a high-risk write, from the repo root", { concurrency: false }, async (t) => {
    const { tempDir, repo, file } = await editFixture(t);
    const env = fixtureEnv(tempDir);
    const outputs = await runRegistered("edit-impact", writeInput(file, repo), env, [repo]);
    assert.deepEqual([...outputs.keys()], ["postToolUse"]);
    const context = modelVisibleText("postToolUse", outputs.get("postToolUse"));
    assert.match(context, /HIGH-RISK EDIT/);
    assert.match(context, /shared\.ts has 5 dependents/);
    // ix runs in the project, not wherever Cursor started the hook process.
    await waitForLogLine(requiredEnv(env, "IX_MOCK_LOG_FILE"), `impact src/shared.ts --format json\tcwd=${repo}`);
});
/**
 * `runIx` keeps stdout when ix exits non-zero, but this hook used to discard it
 * on `!result.ok` — so a body that arrived with a failing exit status was
 * thrown away. Since ix-infrastructure/Ix#547 that is the normal shape of a
 * refusal, and Ix#539 asks the plugins to tolerate it before the CLI starts
 * producing it.
 */
test("edit-impact still warns when ix exits non-zero with a usable body", { concurrency: false }, async (t) => {
    const { tempDir, repo, file } = await editFixture(t);
    const env = fixtureEnv(tempDir, { IX_MOCK_IMPACT_EXIT: "1" });
    const outputs = await runRegistered("edit-impact", writeInput(file, repo), env, [repo]);
    assert.match(modelVisibleText("postToolUse", outputs.get("postToolUse")), /HIGH-RISK EDIT/);
});
/** The other half: a refusal body carries no risk, so the hook stays quiet. */
test("edit-impact stays silent when ix refuses the target", { concurrency: false }, async (t) => {
    const { tempDir, repo, file } = await editFixture(t);
    const refusal = join(tempDir, "unresolved.json");
    await writeFile(refusal, JSON.stringify({ error: "unresolved_target", message: 'No entity found matching "shared.ts".' }));
    const env = fixtureEnv(tempDir, { IX_MOCK_IMPACT_EXIT: "1", IX_MOCK_IMPACT_FILE: refusal });
    const outputs = await runRegistered("edit-impact", writeInput(file, repo), env, [repo]);
    assert.deepEqual(outputs.get("postToolUse"), {}, "a refusal is not a risk warning");
});
test("edit-impact ignores a write outside every workspace root", { concurrency: false }, async (t) => {
    const { tempDir, repo } = await editFixture(t);
    const outside = join(tempDir, "elsewhere.ts");
    await writeFile(outside, "x\n");
    const env = fixtureEnv(tempDir);
    const outputs = await runRegistered("edit-impact", writeInput(outside, repo), env, [repo]);
    assert.deepEqual(outputs.get("postToolUse"), {});
    assert.deepEqual(await readLogLines(requiredEnv(env, "IX_MOCK_LOG_FILE")), []);
});
test("Grep gets graph context after it runs; preToolUse stays out of the way unless blocking is on", { concurrency: false }, async (t) => {
    const tempDir = await realpath(await mkdtemp(join(tmpdir(), "ix-cursor-itest-")));
    t.after(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });
    const repo = await gitRepo(join(tempDir, "repo"));
    const env = fixtureEnv(tempDir, { IX_MOCK_LOCATE_FILE: join(FIXTURE_DIR, "locate_resolved.json") });
    const grep = () => ({
        tool_name: "Grep",
        tool_input: { pattern: "SessionManager", path: join(repo, "src") },
        tool_use_id: "tu-2",
        cwd: repo,
    });
    const outputs = await runRegistered("pre-search", grep, env, [repo]);
    assert.deepEqual([...outputs.keys()].sort(), ["postToolUse", "preToolUse"]);
    // Augment (default): nothing before the Grep, the summary after it.
    assert.deepEqual(outputs.get("preToolUse"), {});
    const context = modelVisibleText("postToolUse", outputs.get("postToolUse"));
    assert.match(context, /symbol: SessionManager, class, manager\.ts/);
    assert.match(context, /2 text hits in manager\.ts, index\.ts/);
    // An absolute Grep path becomes the workspace-relative path `ix text` takes.
    const log = await readLogLines(requiredEnv(env, "IX_MOCK_LOG_FILE"));
    assert.ok(log.includes(`text SessionManager --limit 15 --path src --format json\tcwd=${repo}`), log.join("\n"));
    assert.ok(log.includes(`locate SessionManager --format json\tcwd=${repo}`), log.join("\n"));
    // Opt-in blocking: a deny whose agent_message carries the summary, exit 0.
    const blocking = fixtureEnv(tempDir, {
        IX_MOCK_LOCATE_FILE: join(FIXTURE_DIR, "locate_resolved.json"),
        IX_BLOCK_ON_HIGH_CONFIDENCE: "true",
    });
    const blocked = await runRegistered("pre-search", grep, blocking, [repo], "preToolUse");
    const denied = blocked.get("preToolUse");
    assert.equal(denied["permission"], "deny");
    assert.match(modelVisibleText("preToolUse", denied), /symbol: SessionManager/);
});
test("shell grep gets graph context after the command runs, in the command's repo", { concurrency: false }, async (t) => {
    const tempDir = await realpath(await mkdtemp(join(tmpdir(), "ix-cursor-itest-")));
    t.after(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });
    const repo = await gitRepo(join(tempDir, "repo"));
    const env = fixtureEnv(tempDir, { IX_MOCK_LOCATE_FILE: join(FIXTURE_DIR, "locate_resolved.json") });
    const outputs = await runRegistered("shell-search", () => ({
        tool_name: "Shell",
        tool_input: { command: "rg SessionManager src", working_directory: repo },
        tool_output: "{\"exitCode\":0}",
        tool_use_id: "tu-3",
        cwd: repo,
    }), env, [repo]);
    assert.deepEqual([...outputs.keys()], ["postToolUse"]);
    const context = modelVisibleText("postToolUse", outputs.get("postToolUse"));
    assert.match(context, /bash grep intercepted for 'SessionManager'/);
    assert.match(context, /symbol: SessionManager/);
    await waitForLogLine(requiredEnv(env, "IX_MOCK_LOG_FILE"), `locate SessionManager --format json\tcwd=${repo}`);
});
test("post-edit hook requests the guarded root map and a follow-up query sees the updated graph", { concurrency: false }, async (t) => {
    const tempDir = await realpath(await mkdtemp(join(tmpdir(), "ix-cursor-itest-")));
    t.after(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });
    const repo = await gitRepo(join(tempDir, "repo"));
    const env = fixtureEnv(tempDir, { IX_MOCK_MAPPED_ROOTS: repo, CURSOR_PROJECT_DIR: repo });
    const statePath = requiredEnv(env, "IX_MOCK_STATE_FILE");
    const logPath = requiredEnv(env, "IX_MOCK_LOG_FILE");
    const mapLogPath = requiredEnv(env, "IX_MOCK_MAP_LOG_FILE");
    const before = await invokeSubsystemsTool(env);
    assert.equal(before.map_rev, 101);
    const hookResult = await runHook("hooks/post-edit-ingest.ts", {
        file_path: join(repo, "src", "new-test.ts"),
        workspace_roots: [repo],
    }, env);
    assert.equal(hookResult.code, 0, hookResult.stderr);
    assert.equal(hookResult.stdout, "");
    await waitForFile(statePath);
    // The root, never the edited file: `ix map <file>` is rejected by ix.
    await waitForLogLine(logPath, `map ${repo} --silent`);
    assert.deepEqual(await readLogLines(mapLogPath), [`path=${repo}\tcwd=${repo}\tIX_AUTO_MAP=1`]);
    const after = await invokeSubsystemsTool(env);
    assert.equal(after.map_rev, 102);
    assert.deepEqual(after.regions?.map((region) => region.label), ["Hooks", "Tools", "Tests"]);
    // A burst of edits shares the per-root debounce with the stop hook.
    const again = await runHook("hooks/debounced-map.ts", { status: "completed", loop_count: 0, workspace_roots: [repo] }, env);
    assert.equal(again.code, 0, again.stderr);
    await delay(300);
    assert.equal((await readLogLines(mapLogPath)).length, 1);
});
test("post-edit hook does not map an unmapped repo or a file outside the workspace", { concurrency: false }, async (t) => {
    const tempDir = await realpath(await mkdtemp(join(tmpdir(), "ix-cursor-itest-")));
    t.after(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });
    const mapped = await gitRepo(join(tempDir, "mapped"));
    const unmapped = await gitRepo(join(tempDir, "unmapped"));
    const env = fixtureEnv(tempDir, { IX_MOCK_MAPPED_ROOTS: mapped, CURSOR_PROJECT_DIR: mapped });
    for (const payload of [
        { file_path: join(unmapped, "a.ts"), workspace_roots: [unmapped] },
        { file_path: join(tempDir, "elsewhere", "a.ts"), workspace_roots: [mapped] },
    ]) {
        const result = await runHook("hooks/post-edit-ingest.ts", payload, env);
        assert.equal(result.code, 0, result.stderr);
    }
    await delay(300);
    assert.deepEqual(await readLogLines(requiredEnv(env, "IX_MOCK_MAP_LOG_FILE")), []);
    assert.ok(!(await readLogLines(requiredEnv(env, "IX_MOCK_LOG_FILE"))).some((l) => l.startsWith("map ")));
});
test("stop hook maps each mapped workspace repo once, from the payload's workspace_roots", { concurrency: false }, async (t) => {
    const tempDir = await realpath(await mkdtemp(join(tmpdir(), "ix-cursor-itest-")));
    t.after(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });
    const a = await gitRepo(join(tempDir, "a"));
    const b = await gitRepo(join(tempDir, "b"));
    await mkdir(join(a, "pkg"));
    const plain = join(tempDir, "plain");
    await mkdir(plain);
    // CURSOR_PROJECT_DIR is only a fallback; the payload's roots win.
    const env = fixtureEnv(tempDir, { IX_MOCK_MAPPED_ROOTS: `${a}:${b}:${plain}`, CURSOR_PROJECT_DIR: plain });
    const outputs = await runRegistered("debounced-map", () => ({ status: "completed", loop_count: 0 }), env, [a, join(a, "pkg"), b, plain]);
    // stop's only output is followup_message, which would start another turn.
    assert.deepEqual(outputs.get("stop"), {});
    const mapLogPath = requiredEnv(env, "IX_MOCK_MAP_LOG_FILE");
    const started = Date.now();
    while ((await readLogLines(mapLogPath)).length < 2 && Date.now() - started < 3_000) {
        await delay(50);
    }
    await delay(300);
    assert.deepEqual((await readLogLines(mapLogPath)).sort(), [`path=${a}\tcwd=${a}\tIX_AUTO_MAP=1`, `path=${b}\tcwd=${b}\tIX_AUTO_MAP=1`].sort());
});
//# sourceMappingURL=plugin-success-loop.test.js.map