// Copyright 2026 Ix Infrastructure Inc.

// The MCP catalog Cursor gets from this plugin, read from a RELEASED `ix`.
//
// Starts the server exactly as mcp.json tells Cursor to (command and args
// read from the file), asks it for `tools/list` over stdio, and checks that
// every `ix_*` tool the skills, agents, rules and shared notes name is in it.
// It also prints the size of the tool listing: that listing is sent in every
// session, next to the always-on text tests/unit/always-on-size.test.ts
// limits.
//
// `ix_briefing`, `ix_decisions` and `ix_decide` are listed only when Ix Pro is
// installed, which CI does not do; tests/unit/skill-text.test.ts checks that
// every mention of them is conditional.
//
// Named *.real-ix.ts so `npm test` never picks it up: it needs the real
// binary. Run with `npm run test:real-ix`.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PLUGIN_ROOT } from "../helpers/cursor-hooks.js";

const ENDPOINT = process.env["IX_ENDPOINT"] ?? "";
assert.ok(ENDPOINT, "set IX_ENDPOINT to an address nothing listens on (CI: http://127.0.0.1:1)");
assert.doesNotMatch(ENDPOINT, /:(8090|8091|8100|8529)\b/, "refusing to run against a real backend port");

const PRO_TOOLS = new Set(["ix_briefing", "ix_decisions", "ix_decide"]);
const MODEL_TEXT_DIRS = ["skills", "agents", "rules", "shared"];

interface McpEntry {
  command: string;
  args?: string[];
}

function mcpEntry(): McpEntry {
  const config = JSON.parse(readFileSync(join(PLUGIN_ROOT, "mcp.json"), "utf8")) as {
    mcpServers: Record<string, McpEntry>;
  };
  const entries = Object.values(config.mcpServers);
  assert.equal(entries.length, 1, "mcp.json should register one server");
  return entries[0]!;
}

/** Every `ix_*` name in the model-facing text, with one place it appears. */
function namedTools(): Map<string, string> {
  const named = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(md|mdc)$/.test(name)) {
        readFileSync(path, "utf8")
          .split("\n")
          .forEach((line, i) => {
            for (const m of line.matchAll(/\bix_[a-z]+(?:_[a-z]+)*\b/g)) {
              if (!named.has(m[0])) named.set(m[0], `${path.slice(PLUGIN_ROOT.length + 1)}:${i + 1}`);
            }
          });
      }
    }
  };
  for (const dir of MODEL_TEXT_DIRS) walk(join(PLUGIN_ROOT, dir));
  return named;
}

interface ToolsList {
  tools: { name: string }[];
}

/** Runs the mcp.json server, initializes, and returns its `tools/list` result. */
async function listTools(): Promise<ToolsList> {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "ix-catalog-")));
  const home = join(tmp, "home");
  const ixHome = join(tmp, "ix-home");
  mkdirSync(home);
  mkdirSync(ixHome);
  const { command, args = [] } = mcpEntry();
  const child = spawn(command, args, {
    cwd: tmp,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      IX_HOME: ixHome,
      IX_ENDPOINT: ENDPOINT,
      IX_NO_UPDATE_CHECK: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  // A server that dies early makes the writes fail with EPIPE; the close
  // handler below reports the exit code and stderr instead.
  child.stdin.on("error", () => {});
  const send = (msg: object): void => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
  };

  try {
    return await new Promise<ToolsList>((resolve, reject) => {
      let buffer = "";
      const stray: string[] = [];
      const extra = (): string => (stray.length ? `\nnon-JSON lines on stdout:\n${stray.join("\n")}` : "");
      const timer = setTimeout(() => reject(new Error(`no tools/list answer in 30s; stderr:\n${stderr}${extra()}`)), 30_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        reject(new Error(`\`${command} ${args.join(" ")}\` exited ${code}; stderr:\n${stderr}${extra()}`));
      });
      child.stdout.on("data", (d: Buffer) => {
        buffer += d.toString();
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let msg: { id?: number; result?: unknown; error?: unknown };
          try {
            msg = JSON.parse(line) as typeof msg;
          } catch {
            // MCP stdio allows only JSON-RPC on stdout. Keep going so a later
            // answer still counts, and name the stray line if none comes.
            stray.push(line);
            continue;
          }
          if (msg.id === 1) {
            if (msg.error) return reject(new Error(`initialize failed: ${JSON.stringify(msg.error)}`));
            send({ method: "notifications/initialized" });
            send({ id: 2, method: "tools/list", params: {} });
          } else if (msg.id === 2) {
            clearTimeout(timer);
            if (msg.error) return reject(new Error(`tools/list failed: ${JSON.stringify(msg.error)}`));
            return resolve(msg.result as ToolsList);
          }
        }
      });
      send({
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "ix-cursor-plugin-tests", version: "0" },
        },
      });
    });
  } finally {
    child.kill();
  }
}

test("every tool the plugin's text names is in the catalog mcp.json launches", async (t) => {
  const result = await listTools();
  assert.ok(Array.isArray(result.tools) && result.tools.length > 0, "tools/list returned no tools");
  const catalog = new Set(result.tools.map((tool) => tool.name));
  t.diagnostic(`${result.tools.length} tools, ${Buffer.byteLength(JSON.stringify(result.tools), "utf8")} bytes of tools/list JSON`);

  const missing = [...namedTools()]
    .filter(([name]) => !PRO_TOOLS.has(name) && !catalog.has(name))
    .map(([name, where]) => `${name} (first named at ${where})`);
  assert.deepEqual(missing, [], `catalog: ${[...catalog].sort().join(", ")}`);
});
