import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = resolve(fileURLToPath(import.meta.url), "..");
const MOCK_IX_PATH = resolve(TEST_DIR, "../fixtures/bin/ix");
const LLM_FIXTURE = resolve(TEST_DIR, "../fixtures/ix_outputs/subsystems.llm.txt");

// Must be set before the tools (and lib/config) are imported.
process.env["IX_BIN"] = MOCK_IX_PATH;

const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

type ToolCallback = (rawInput: unknown, extra: unknown) => Promise<{
  content: Array<{ type: string; text: string }>;
}>;

class FakeServer {
  readonly callbacks = new Map<string, ToolCallback>();
  tool(name: string, _d: string, _s: unknown, cb: ToolCallback): void {
    this.callbacks.set(name, cb);
  }
}

async function callSubsystems(): Promise<{ type: string; text: string }> {
  const mod = await import("../../tools/subsystems.js");
  const server = new FakeServer();
  mod.register(server as never);
  const cb = server.callbacks.get("ix_subsystems");
  assert.ok(cb, "ix_subsystems registered");
  const response = await cb({}, {});
  const content = response.content[0];
  assert.ok(content, "tool returned content");
  return content;
}

test("llm passthrough: ix >= 0.7.0 forwards verbatim text (not a JSON envelope) and redacts secrets", async () => {
  const { resetLlmSupportCache } = await import("../../lib/llm.js");
  process.env["IX_MOCK_VERSION"] = "0.7.0";
  process.env["IX_MOCK_LLM_FILE"] = LLM_FIXTURE;
  delete process.env["IX_DISABLE_LLM_FORMAT"];
  resetLlmSupportCache();

  const content = await callSubsystems();

  // Verbatim compact text, not the JSON envelope.
  assert.equal(content.type, "text");
  assert.ok(content.text.startsWith("subsystems count=2"), `expected llm text, got: ${content.text.slice(0, 80)}`);
  assert.throws(() => JSON.parse(content.text), "llm passthrough must not be JSON-wrapped");

  // Secret embedded in the fixture is redacted on the way out.
  assert.ok(!content.text.includes(SECRET), "secret leaked through llm passthrough");
  assert.ok(content.text.includes("[REDACTED]"), "secret was not redacted");
});

test("fallback: ix < 0.7.0 ignores --format llm and returns the JSON envelope unchanged", async () => {
  const { resetLlmSupportCache } = await import("../../lib/llm.js");
  process.env["IX_MOCK_VERSION"] = "0.6.1";
  process.env["IX_MOCK_LLM_FILE"] = LLM_FIXTURE; // present but must be ignored on old CLI
  delete process.env["IX_DISABLE_LLM_FORMAT"];
  resetLlmSupportCache();

  const content = await callSubsystems();
  const parsed = JSON.parse(content.text) as { ok: boolean; tool: string; data?: unknown };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tool, "ix_subsystems");
  assert.ok(parsed.data, "JSON envelope retains structured data on the fallback path");
});

test("kill switch: IX_DISABLE_LLM_FORMAT forces the JSON path even on a new CLI", async () => {
  const { resetLlmSupportCache } = await import("../../lib/llm.js");
  process.env["IX_MOCK_VERSION"] = "0.7.0";
  process.env["IX_MOCK_LLM_FILE"] = LLM_FIXTURE;
  process.env["IX_DISABLE_LLM_FORMAT"] = "1";
  resetLlmSupportCache();

  try {
    const content = await callSubsystems();
    const parsed = JSON.parse(content.text) as { ok: boolean; tool: string };
    assert.equal(parsed.tool, "ix_subsystems");
  } finally {
    delete process.env["IX_DISABLE_LLM_FORMAT"];
    resetLlmSupportCache();
  }
});
