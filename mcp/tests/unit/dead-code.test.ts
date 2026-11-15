// Copyright 2026 Ix Infrastructure Inc.

// The plugin used to bundle its own MCP server. When it went, the helpers only
// it called stayed behind in lib/, still compiled into dist and still described
// as if something used them. These tests keep that from happening again:
// scripts/check-dead-exports.mjs (run by `npm run typecheck`) must catch an
// export nothing ships uses, and no comment may point at a file that is gone.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MCP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = resolve(MCP_ROOT, "..");
const CHECK = join(MCP_ROOT, "scripts", "check-dead-exports.mjs");

function runCheck(projectDir?: string): { code: number | null; out: string } {
  const args = projectDir ? [CHECK, projectDir] : [CHECK];
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function writeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ix-dead-exports-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

test("dead-exports: mcp/ has no export that nothing uses", () => {
  const { code, out } = runCheck();
  assert.equal(code, 0, out);
});

test("dead-exports: reports an export only a test uses, not one the module itself uses", () => {
  const dir = writeProject({
    "tsconfig.json": JSON.stringify({
      compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true },
      include: ["./**/*.ts"],
    }),
    "lib/util.ts": [
      "export interface Shape { n: number }",
      "export function imported(): Shape { return { n: helper() }; }",
      "export function helper(): number { return 1; }",
      "export function onlyATestUsesMe(): number { return 2; }",
      "export const NOBODY = 3;",
      "",
    ].join("\n"),
    "hooks/main.ts": 'import { imported } from "../lib/util.js";\nimported();\n',
    "tests/util.test.ts": 'import { onlyATestUsesMe } from "../lib/util.js";\nonlyATestUsesMe();\n',
  });
  try {
    const { code, out } = runCheck(dir);
    assert.equal(code, 1, out);
    assert.match(out, /lib\/util\.ts:4 {2}onlyATestUsesMe/);
    assert.match(out, /lib\/util\.ts:5 {2}NOBODY/);
    // Imported elsewhere, or used by its own module: not dead.
    assert.doesNotMatch(out, /\b(imported|helper|Shape)\b/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Comments name only files that exist ──────────────────────────────────────

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

function commentText(line: string): string {
  const slash = line.indexOf("//");
  if (slash !== -1) return line.slice(slash);
  return /^\s*(\/\*|\*)/.test(line) ? line : "";
}

// A plugin-relative path such as `lib/cli.ts` or `hooks/hooks.json`. Not one
// that continues a longer path (`.../mcp/dist/hooks/x.js`, another repo's
// `advisor/hooks/hooks.json`): those are not paths in this checkout.
const FILE_REF = /(?<![\w./-])(?:lib|shared|hooks|tools|tests|scripts)\/[\w./-]*\w\.(?:ts|js|mjs|json|md|sh)\b/g;

test("comments: every file a comment names exists", () => {
  const missing: string[] = [];
  for (const file of sourceFiles(MCP_ROOT)) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      for (const [ref] of commentText(line).matchAll(FILE_REF)) {
        const candidates = [join(MCP_ROOT, ref), join(REPO_ROOT, ref)];
        // Comments name the source, which builds to dist/*.js.
        if (ref.endsWith(".js")) candidates.push(join(MCP_ROOT, ref.replace(/\.js$/, ".ts")));
        if (!candidates.some((p) => existsSync(p))) {
          missing.push(`${relative(MCP_ROOT, file)}:${i + 1}  ${ref}`);
        }
      }
    });
  }
  assert.deepEqual(missing, []);
});
