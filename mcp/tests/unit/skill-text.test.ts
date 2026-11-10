// Copyright 2026 Ix Infrastructure Inc.

// The skills, agents, rules and shared notes are read by the model next to the
// results of `ix mcp --tools=all` (mcp.json), which answers in the CLI's
// line-oriented `--format llm` text. The plugin's own MCP server used to wrap
// every result as `{ok, tool, input, summary, data, evidence, timing_ms}`; that
// server is gone, so text that branches on those fields (or on the old JSON
// names inside `data`) points the model at things it never sees.
//
// `ix_briefing`, `ix_decisions` and `ix_decide` are listed by the CLI's MCP server only
// when Ix Pro is installed, so every mention of them must be conditional on
// the tool being available.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import { PLUGIN_ROOT } from "../helpers/cursor-hooks.js";

const MODEL_TEXT_DIRS = ["skills", "agents", "rules", "shared"];

function modelTextFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(md|mdc)$/.test(name)) out.push(path);
    }
  };
  for (const dir of MODEL_TEXT_DIRS) walk(join(PLUGIN_ROOT, dir));
  assert.ok(out.length > 0, "no skill/agent/rule text found");
  return out;
}

interface Line {
  file: string;
  n: number;
  text: string;
}

function lines(): Line[] {
  return modelTextFiles().flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .map((text, i) => ({ file: relative(PLUGIN_ROOT, path), n: i + 1, text })),
  );
}

const where = (l: Line): string => `${l.file}:${l.n}: ${l.text.trim()}`;

test("no text refers to the removed server's result envelope", () => {
  // The issue's acceptance grep, verbatim:
  //   grep -rn 'data\.\|facts\.\|risk_level\|nodes_visited\|`ok`' skills agents rules shared
  const acceptance = /data\.|facts\.|risk_level|nodes_visited|`ok`/;
  const hits = lines().filter((l) => acceptance.test(l.text)).map(where);
  assert.deepEqual(hits, []);
});

test("no text names a JSON field path or snake_case result field", () => {
  const hits: string[] = [];
  for (const l of lines()) {
    for (const m of l.text.matchAll(/`([^`]+)`/g)) {
      const token = m[1]!.trim();
      // `ok: false`, `ok: true` and friends: the old envelope's status flag.
      if (/^ok\b/.test(token)) hits.push(where(l));
      // `role.role`, `ix_explain.rendered.explanation`: a JSON path. File
      // names (`index.md`) are not.
      else if (/^[a-z_]\w*(\.[A-Za-z_]\w*)+$/.test(token) && !/\.(md|mdc|json|ts|js|sh)$/.test(token))
        hits.push(where(l));
      // `resolution_mode`, `children_by_kind`: a snake_case JSON key. MCP tool
      // names (`ix_callers`) are the one snake_case thing the model does see.
      else if (/^[a-z]+(_[a-z]+)+$/.test(token) && !token.startsWith("ix_")) hits.push(where(l));
    }
  }
  assert.deepEqual(hits, []);
});

test("Pro tools are only ever used conditionally", () => {
  const pro = /`?ix_(briefing|decisions|decide)\b`?/;
  const hits: string[] = [];
  for (const path of modelTextFiles()) {
    let heading = "";
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((text, i) => {
        if (/^#{1,6}\s/.test(text)) heading = text;
        if (!pro.test(text)) return;
        const conditional =
          /\[Pro\]/.test(heading) ||
          /\[Pro\]/.test(text) ||
          /\b(un)?available\b/i.test(text) ||
          /\bdo not call\b/i.test(text) ||
          // a row of the tier table in shared/cognitive-model.md
          /^\s*\|/.test(text);
        if (!conditional) hits.push(where({ file: relative(PLUGIN_ROOT, path), n: i + 1, text }));
      });
  }
  assert.deepEqual(hits, []);
});

test("no step probes for Pro by calling ix_briefing and reading its result", () => {
  // The CLI server does not list ix_briefing without Ix Pro, so "call it and
  // see" is a call to a tool that is not there. The check is the tool list.
  const hits = lines()
    .filter((l) => /(?<!not )call(ing)? `ix_briefing`/i.test(l.text) && !/not available|is available|if .*available/i.test(l.text))
    .map(where);
  assert.deepEqual(hits, []);
});

test("no text promises prose that ix_explain's llm output drops", () => {
  // The llm renderer omits the explanation and why-it-matters text; it prints
  // role, importance and edges records plus caller rows.
  const hits = lines()
    .filter((l) => /why-it-matters|`ix_explain` explanation/i.test(l.text))
    .map(where);
  assert.deepEqual(hits, []);
});

test("impact guidance names the records ix_impact prints", () => {
  // A leaf target prints `counts callers= callees=`; only a container prints
  // `dependents=`. "the dependent count" alone has no answer for a leaf.
  const hits = lines()
    .filter((l) => /dependent count/i.test(l.text) && /ix_impact/.test(l.text))
    .map(where);
  assert.deepEqual(hits, []);
  for (const file of ["skills/ix-impact/SKILL.md", "agents/ix-safe-refactor-planner.md"]) {
    const text = readFileSync(join(PLUGIN_ROOT, file), "utf8");
    for (const rec of ["`risk=`", "`callers=`", "`dependents=`"]) assert.ok(text.includes(rec), `${file} should name ${rec}`);
  }
});
