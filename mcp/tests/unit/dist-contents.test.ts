// Copyright 2026 Ix Infrastructure Inc.

// mcp/dist is committed and is what hooks/hooks.json runs. It should hold the
// hooks and the modules they import, and nothing else: no compiled tests, no
// declaration files, no source maps. CI separately checks that the committed
// dist equals a clean `npm run build`; this checks what that build contains.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import test from "node:test";

import { PLUGIN_ROOT, hookEntries, scriptName } from "../helpers/cursor-hooks.js";

const MCP = join(PLUGIN_ROOT, "mcp");
const DIST = join(MCP, "dist");
const RUNTIME_DIRS = ["hooks", "lib", "shared"];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function distFiles(): string[] {
  return walk(DIST)
    .map((path) => relative(DIST, path).split(sep).join("/"))
    .sort();
}

// Relative module specifiers in emitted ESM: `from "./x.js"`, `import("../y.js")`.
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;

function relativeImports(file: string): string[] {
  const text = readFileSync(join(DIST, file), "utf8");
  return [...text.matchAll(IMPORT_RE)].map((m) => posix.join(posix.dirname(file), m[1]!));
}

test("dist holds one .js per runtime source file and nothing else", () => {
  const expected = RUNTIME_DIRS.flatMap((dir) =>
    readdirSync(join(MCP, dir))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
      .map((name) => `${dir}/${name.replace(/\.ts$/, ".js")}`),
  ).sort();
  assert.deepEqual(distFiles(), expected);
});

test("every dist file is loaded by a registered hook, and every import resolves", () => {
  const files = new Set(distFiles());
  const entries = [...new Set(hookEntries().map((entry) => scriptName(entry.command)))];
  const queue = entries.map((name) => {
    assert.ok(name, "hook command does not name an mcp/dist/hooks script");
    return `hooks/${name}.js`;
  });
  const reached = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (reached.has(file)) continue;
    assert.ok(files.has(file), `dist/${file} is loaded at runtime but missing from dist`);
    reached.add(file);
    queue.push(...relativeImports(file));
  }
  assert.deepEqual([...files].filter((file) => !reached.has(file)), [], "dist files no hook loads");
});

test("dist .js files carry no source-map reference", () => {
  for (const file of distFiles()) {
    const text = readFileSync(join(DIST, file), "utf8");
    assert.doesNotMatch(text, /sourceMappingURL/, `dist/${file} points at a source map`);
  }
});
