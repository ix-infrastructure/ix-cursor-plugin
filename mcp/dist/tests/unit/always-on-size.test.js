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
function parse(path) {
    const raw = readFileSync(path, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
    assert.ok(match, `${path} has no YAML frontmatter`);
    const fields = {};
    for (const line of match[1].split(/\r?\n/)) {
        const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
        if (kv)
            fields[kv[1]] = kv[2].trim();
    }
    return { fields, body: raw.slice(match[0].length) };
}
const bytes = (s) => Buffer.byteLength(s, "utf8");
function alwaysOnParts() {
    const parts = [];
    const rulesDir = join(PLUGIN_ROOT, "rules");
    for (const file of readdirSync(rulesDir).filter((f) => f.endsWith(".mdc")).sort()) {
        const { fields, body } = parse(join(rulesDir, file));
        if (fields["alwaysApply"] === "true")
            parts.push({ source: `rules/${file} (body)`, bytes: bytes(body) });
        else
            parts.push({ source: `rules/${file} (description)`, bytes: bytes(fields["description"] ?? "") });
    }
    const skillsDir = join(PLUGIN_ROOT, "skills");
    for (const skill of readdirSync(skillsDir).sort()) {
        const { fields } = parse(join(skillsDir, skill, "SKILL.md"));
        if (fields["disable-model-invocation"] === "true")
            continue;
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
const total = (parts) => parts.reduce((n, p) => n + p.bytes, 0);
test("the always-on text stays under the limit", (t) => {
    const parts = alwaysOnParts();
    for (const p of parts)
        t.diagnostic(`${p.bytes}\t${p.source}`);
    const sum = total(parts);
    t.diagnostic(`${sum}\ttotal (limit ${ALWAYS_ON_LIMIT})`);
    assert.ok(sum <= ALWAYS_ON_LIMIT, `always-on text is ${sum} bytes, over the ${ALWAYS_ON_LIMIT}-byte limit:\n` +
        parts.map((p) => `  ${p.bytes}\t${p.source}`).join("\n"));
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
    assert.ok(readme.includes(`${sum} bytes of always-on text`), `README.md should say "${sum} bytes of always-on text"`);
    assert.ok(readme.includes(`${ALWAYS_ON_LIMIT.toLocaleString("en-US")}-byte limit`), "README.md should state the limit");
});
//# sourceMappingURL=always-on-size.test.js.map