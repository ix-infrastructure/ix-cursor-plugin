// Copyright 2026 Ix Infrastructure Inc.

// The text this plugin puts in front of the model in every Cursor session,
// before the user types anything and whether or not Ix is used:
//
//   * the body of every rule with `alwaysApply: true`;
//   * the description of every other rule, which Cursor lists so the agent can
//     ask for the rule (a glob-scoped rule is counted too, to stay on the safe
//     side);
//   * the name and description of every skill the model may invoke on its own
//     (a skill with `disable-model-invocation: true` is a slash command only);
//   * the name and description of every subagent, which Cursor lists for
//     delegation.
//
// The MCP `tools/list` that `ix mcp` (mcp.json) answers is the other
// per-session cost. It comes from the Ix CLI, not from files here, so
// tests/real-ix measures it against a released CLI.
//
// `npm test` runs in CI, so going over ALWAYS_ON_LIMIT is a red build. The
// README records the current figure; this test keeps that figure honest.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { PLUGIN_ROOT } from "../helpers/cursor-hooks.js";

/** Bytes of always-on text the plugin may add to a session. */
const ALWAYS_ON_LIMIT = 2048;

interface Doc {
  fields: Record<string, string>;
  body: string;
}

function parse(path: string): Doc {
  return parseText(readFileSync(path, "utf8"), path);
}

/**
 * Top-level `key: value` frontmatter fields. A value that goes on over more
 * lines (a `>`/`|` block scalar, or a plain scalar continued on indented
 * lines) is read in full, so a multi-line description is counted at its real
 * size rather than as its first line.
 */
function parseText(raw: string, path: string): Doc {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  assert.ok(match, `${path} has no YAML frontmatter`);
  const fields: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]!);
    if (!kv) continue;
    const head = kv[2]!.trim();
    const more: string[] = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]!) || (lines[i + 1]!.trim() === "" && /^\s+\S/.test(lines[i + 2] ?? "")))) {
      more.push(lines[++i]!.trim());
    }
    const block = /^[>|][+-]?\d*$/.exec(head);
    if (block) fields[kv[1]!] = more.join(head.startsWith("|") ? "\n" : " ");
    else fields[kv[1]!] = [head, ...more].filter(Boolean).join(" ");
  }
  return { fields, body: raw.slice(match[0].length) };
}

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

interface Part {
  source: string;
  bytes: number;
}

/**
 * `honourSkillOptOut: false` gives the figure if Cursor listed every skill's
 * description whatever `disable-model-invocation` says. Cursor's skill docs
 * say it does not, but no test here runs Cursor, so the README states both.
 */
function alwaysOnParts({ honourSkillOptOut = true } = {}): Part[] {
  const parts: Part[] = [];

  const rulesDir = join(PLUGIN_ROOT, "rules");
  for (const file of readdirSync(rulesDir).filter((f) => f.endsWith(".mdc")).sort()) {
    const { fields, body } = parse(join(rulesDir, file));
    if (fields["alwaysApply"] === "true") parts.push({ source: `rules/${file} (body)`, bytes: bytes(body) });
    else parts.push({ source: `rules/${file} (description)`, bytes: bytes(fields["description"] ?? "") });
  }

  const skillsDir = join(PLUGIN_ROOT, "skills");
  for (const skill of readdirSync(skillsDir).sort()) {
    const { fields } = parse(join(skillsDir, skill, "SKILL.md"));
    if (honourSkillOptOut && fields["disable-model-invocation"] === "true") continue;
    parts.push({
      source: `skills/${skill} (name + description)`,
      bytes: bytes(fields["name"] ?? "") + bytes(fields["description"] ?? ""),
    });
  }

  const agentsDir = join(PLUGIN_ROOT, "agents");
  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md")).sort()) {
    const { fields } = parse(join(agentsDir, file));
    parts.push({
      source: `agents/${file} (name + description)`,
      bytes: bytes(fields["name"] ?? "") + bytes(fields["description"] ?? ""),
    });
  }

  return parts;
}

const total = (parts: Part[]): number => parts.reduce((n, p) => n + p.bytes, 0);

test("the always-on text stays under the limit", (t) => {
  const parts = alwaysOnParts();
  for (const p of parts) t.diagnostic(`${p.bytes}\t${p.source}`);
  const sum = total(parts);
  t.diagnostic(`${sum}\ttotal (limit ${ALWAYS_ON_LIMIT})`);
  t.diagnostic(`${total(alwaysOnParts({ honourSkillOptOut: false }))}\ttotal if Cursor also listed slash-command-only skills`);
  assert.ok(
    sum <= ALWAYS_ON_LIMIT,
    `always-on text is ${sum} bytes, over the ${ALWAYS_ON_LIMIT}-byte limit:\n` +
      parts.map((p) => `  ${p.bytes}\t${p.source}`).join("\n"),
  );
});

test("frontmatter parsing counts multi-line descriptions in full", () => {
  const text = "first line of a long description\nand its second line";
  for (const [label, yaml] of [
    ["folded", "description: >\n  first line of a long description\n  and its second line"],
    ["literal", "description: |-\n  first line of a long description\n\n  and its second line"],
    ["plain", "description: first line of a long description\n  and its second line"],
  ] as const) {
    const { fields } = parseText(`---\nname: x\n${yaml}\nalwaysApply: false\n---\nbody\n`, label);
    assert.ok(bytes(fields["description"]!) >= bytes(text) - 2, `${label}: description read as ${JSON.stringify(fields["description"])}`);
    assert.equal(fields["alwaysApply"], "false", `${label}: the next key is still read`);
    assert.equal(fields["name"], "x");
  }
});

test("no rule is always applied", () => {
  // Their bodies restate what the skills and the tool descriptions say. Cursor
  // lists each rule's description and the agent asks for the rule when it fits.
  const rulesDir = join(PLUGIN_ROOT, "rules");
  for (const file of readdirSync(rulesDir).filter((f) => f.endsWith(".mdc"))) {
    const { fields } = parse(join(rulesDir, file));
    assert.equal(fields["alwaysApply"], "false", `rules/${file}: alwaysApply should be false`);
    assert.ok(fields["description"], `rules/${file}: an agent-requested rule needs a description`);
  }
});

test("every skill is a slash command only", () => {
  const skillsDir = join(PLUGIN_ROOT, "skills");
  for (const skill of readdirSync(skillsDir)) {
    const { fields } = parse(join(skillsDir, skill, "SKILL.md"));
    assert.equal(fields["disable-model-invocation"], "true", `skills/${skill}: set disable-model-invocation: true`);
  }
});

test("every agent is one a skill delegates to", () => {
  // An agent no skill hands work to only adds its description to every session.
  const skillsDir = join(PLUGIN_ROOT, "skills");
  const skillText = readdirSync(skillsDir)
    .map((s) => readFileSync(join(skillsDir, s, "SKILL.md"), "utf8"))
    .join("\n");
  for (const file of readdirSync(join(PLUGIN_ROOT, "agents")).filter((f) => f.endsWith(".md"))) {
    const name = file.replace(/\.md$/, "");
    assert.ok(new RegExp(`\\b${name}\\b`).test(skillText), `agents/${file}: no skill delegates to it`);
  }
});

test("the README records the current always-on size", () => {
  const readme = readFileSync(join(PLUGIN_ROOT, "README.md"), "utf8");
  const sum = total(alwaysOnParts()).toLocaleString("en-US");
  assert.ok(
    readme.includes(`${sum} bytes of always-on text`),
    `README.md should say "${sum} bytes of always-on text"`,
  );
  assert.ok(readme.includes(`${ALWAYS_ON_LIMIT.toLocaleString("en-US")}-byte limit`), "README.md should state the limit");
  const worst = total(alwaysOnParts({ honourSkillOptOut: false })).toLocaleString("en-US");
  assert.ok(
    readme.includes(`${worst} bytes in all`),
    `README.md should say "${worst} bytes in all" for a Cursor that lists slash-command-only skills too`,
  );
});

test("the hook-deduplication rule's description carries the instruction", () => {
  // The rule is agent-requested, so after a hook adds context the model may
  // see only this description. It has to say what to do, and name the marker
  // the hooks' context starts with so the model can tell when it applies.
  const { fields } = parse(join(PLUGIN_ROOT, "rules", "no-duplicate-hook-work.mdc"));
  const description = fields["description"] ?? "";
  assert.match(description, /`\[ix`/, "name the `[ix` marker hook context starts with");
  assert.match(description, /\breuse\b/i, "tell the model to reuse hook context");
  assert.match(description, /instead of re-running/i, "tell the model not to repeat the lookup");
});
