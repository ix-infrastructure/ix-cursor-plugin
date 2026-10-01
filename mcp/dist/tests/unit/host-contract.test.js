// Copyright 2026 Ix Infrastructure Inc.
// The plugin's registrations against Cursor's documented plugin and hook
// contract: https://cursor.com/docs/reference/plugins, https://cursor.com/docs/hooks,
// https://cursor.com/docs/subagents.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { OUTPUT_FIELDS, PLUGIN_ROOT, TOOL_MATCHERS, assertOutputFields, hookEntries, modelVisibleText, scriptName, } from "../helpers/cursor-hooks.js";
function frontmatter(path) {
    const raw = readFileSync(path, "utf8");
    const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
    assert.ok(match, `${path} has no YAML frontmatter`);
    const fields = {};
    for (const line of match[1].split("\n")) {
        const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
        if (kv)
            fields[kv[1]] = kv[2];
    }
    return fields;
}
test("every hook is registered on a documented event, with a documented matcher", () => {
    const entries = hookEntries();
    assert.ok(entries.length > 0);
    for (const entry of entries) {
        assert.ok(entry.event in OUTPUT_FIELDS, `undocumented hook event '${entry.event}'`);
        if (entry.matcher !== undefined) {
            assert.ok(["preToolUse", "postToolUse", "postToolUseFailure"].includes(entry.event), `matcher on ${entry.event} is not a tool-name matcher`);
            assert.ok(TOOL_MATCHERS.includes(entry.matcher), `undocumented tool matcher '${entry.matcher}'`);
        }
    }
});
test("hook commands are rooted at ${CURSOR_PLUGIN_ROOT} and name a hook that exists", () => {
    // Cursor's own plugins address hook scripts this way (cursor/plugins
    // advisor/hooks/hooks.json); a relative path depends on the hook cwd.
    for (const entry of hookEntries()) {
        assert.match(entry.command, /^node "\$\{CURSOR_PLUGIN_ROOT\}\/mcp\/dist\/hooks\/[a-z-]+\.js"$/);
        const name = scriptName(entry.command);
        assert.ok(name && existsSync(resolve(PLUGIN_ROOT, "mcp/hooks", `${name}.ts`)), `no source for ${entry.command}`);
    }
});
test("only side-effect hooks sit on stop, none on beforeSubmitPrompt, and the briefing is on sessionStart", () => {
    // beforeSubmitPrompt output is continue/user_message; stop output is a
    // followup_message that starts another turn. The plugin uses neither for text.
    const byEvent = new Map();
    for (const entry of hookEntries()) {
        byEvent.set(entry.event, [...(byEvent.get(entry.event) ?? []), scriptName(entry.command) ?? "?"]);
    }
    assert.equal(byEvent.get("beforeSubmitPrompt"), undefined);
    assert.deepEqual(byEvent.get("stop"), ["debounced-map"]);
    assert.deepEqual(byEvent.get("sessionStart"), ["prompt-briefing"]);
});
test("the schema table rejects the outputs this plugin used to send", () => {
    // prompt-briefing on beforeSubmitPrompt, stop-annotate on stop.
    assert.throws(() => assertOutputFields("beforeSubmitPrompt", { continue: true, additional_context: "x" }));
    assert.throws(() => assertOutputFields("stop", { agent_message: "x" }));
    // pre-edit / pre-search augment / pre-bash: an allowed tool's agent_message.
    assert.equal(modelVisibleText("preToolUse", { permission: "allow", agent_message: "x" }), "");
    assert.equal(modelVisibleText("sessionStart", { additional_context: "x" }), "x");
    assert.equal(modelVisibleText("postToolUse", { additional_context: "x" }), "x");
    assert.equal(modelVisibleText("preToolUse", { permission: "deny", agent_message: "x" }), "x");
});
test("the manifest points Cursor at the agents directory", () => {
    // https://cursor.com/docs/reference/plugins: agents are discovered from
    // `agents/` or the manifest's `agents` path; a manifest path replaces the
    // default folder.
    const manifest = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, ".cursor-plugin/plugin.json"), "utf8"));
    assert.equal(manifest.agents, "./agents/");
    assert.ok(existsSync(resolve(PLUGIN_ROOT, "agents")));
    assert.ok(!existsSync(resolve(PLUGIN_ROOT, "subagents")), "subagents/ is not a Cursor plugin component");
});
test("every agent has the documented frontmatter and nothing else", () => {
    // https://cursor.com/docs/subagents "Configuration fields".
    const documented = ["name", "description", "model", "readonly", "is_background"];
    const dir = resolve(PLUGIN_ROOT, "agents");
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    assert.ok(files.length > 0);
    for (const file of files) {
        const fields = frontmatter(join(dir, file));
        assert.equal(fields["name"], file.replace(/\.md$/, ""), `${file}: name must match the file`);
        assert.match(fields["name"] ?? "", /^[a-z0-9]+(-[a-z0-9]+)*$/, `${file}: name must be kebab-case`);
        assert.ok(fields["description"], `${file}: description is required`);
        for (const key of Object.keys(fields)) {
            assert.ok(documented.includes(key), `${file}: '${key}' is not a Cursor subagent field`);
        }
    }
});
test("every subagent a skill hands off to exists, under its bare name", () => {
    // Cursor's own plugin skills name a plugin agent by its bare name
    // (cursor/plugins advisor/skills/advisor/SKILL.md: subagent_type: "advisor-subagent").
    const agents = new Set(readdirSync(resolve(PLUGIN_ROOT, "agents")).map((f) => f.replace(/\.md$/, "")));
    const skillsDir = resolve(PLUGIN_ROOT, "skills");
    let refs = 0;
    for (const skill of readdirSync(skillsDir)) {
        const body = readFileSync(join(skillsDir, skill, "SKILL.md"), "utf8");
        for (const m of body.matchAll(/subagent_type:\s*"([^"]+)"/g)) {
            refs++;
            assert.ok(agents.has(m[1]), `skills/${skill}: subagent_type "${m[1]}" is not an agent in agents/`);
        }
    }
    assert.ok(refs > 0);
});
//# sourceMappingURL=host-contract.test.js.map