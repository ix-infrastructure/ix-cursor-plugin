// Copyright 2026 Ix Infrastructure Inc.
// The one summary the Grep and shell-search hooks add after a symbol search:
// where the name is defined and who calls it, and nothing without a single
// confident definition.
import assert from "node:assert/strict";
import test from "node:test";
import { isSymbolSearch } from "../../shared/search-context.js";
import { confidentDefinition, summarizeDefinition } from "../../shared/summarizers.js";
const resolved = {
    resolvedTarget: { id: "e1", kind: "class", name: "SessionManager", path: "src/session/manager.ts" },
    hasMapData: true,
    diagnostics: [],
};
test("a resolved target is the definition", () => {
    assert.deepEqual(confidentDefinition(resolved), {
        name: "SessionManager",
        kind: "class",
        path: "src/session/manager.ts",
    });
});
test("no single confident definition means no definition", () => {
    const candidates = [
        { id: "e1", name: "SessionManager", kind: "class", path: "a.ts" },
        { id: "e2", name: "SessionManager", kind: "interface", path: "b.ts" },
    ];
    for (const [name, record] of [
        ["ambiguous (under code)", { code: "ambiguous_target", message: "x", candidates }],
        ["unresolved", { error: "unresolved_target", message: "x" }],
        ["not mapped", { error: "workspace_not_mapped", message: "x" }],
        ["error beside a target", { ...resolved, error: "stale" }],
        ["candidates only", { candidates }],
        ["low confidence", { ...resolved, confidence: 0.5 }],
        ["low target confidence", { resolvedTarget: { ...resolved.resolvedTarget, confidence: 0.2 } }],
        ["empty", {}],
        ["array", [resolved]],
        ["null", null],
    ]) {
        assert.equal(confidentDefinition(record), null, name);
    }
    assert.ok(confidentDefinition({ ...resolved, confidence: 0.6 }), "0.6 is confident");
});
test("the summary names the definition and its callers", () => {
    const def = confidentDefinition(resolved);
    const callers = (n, total) => ({
        results: Array.from({ length: n }, (_, i) => ({ name: `f${i}`, kind: "function", path: `src/f${i}.ts` })),
        ...(total === undefined ? {} : { summary: { total } }),
    });
    assert.equal(summarizeDefinition("SessionManager", def, callers(1)), "[ix] 'SessionManager': class defined in src/session/manager.ts; 1 caller: f0 (src/f0.ts)");
    assert.equal(summarizeDefinition("SessionManager", def, callers(7, 7)), "[ix] 'SessionManager': class defined in src/session/manager.ts; 7 callers: " +
        "f0 (src/f0.ts), f1 (src/f1.ts), f2 (src/f2.ts), f3 (src/f3.ts), f4 (src/f4.ts) (+2 more)");
    // summary.total counts callers the results list does not carry.
    assert.match(summarizeDefinition("SessionManager", def, callers(2, 9)), /9 callers: f0 \(src\/f0\.ts\), f1 \(src\/f1\.ts\) \(\+7 more\)$/);
    assert.equal(summarizeDefinition("SessionManager", def, { results: [], summary: { total: 0 } }), "[ix] 'SessionManager': class defined in src/session/manager.ts; no callers in the graph");
    // A pattern that resolved to another name says which.
    assert.equal(summarizeDefinition("sessionmanager", def, null), "[ix] 'sessionmanager': SessionManager, class defined in src/session/manager.ts");
});
test("a callers refusal or unreadable answer leaves callers out, never reports zero", () => {
    const def = confidentDefinition(resolved);
    const head = "[ix] 'SessionManager': class defined in src/session/manager.ts";
    for (const callers of [
        null,
        "not json",
        { error: "workspace_not_mapped", message: "x" },
        { code: "ambiguous_target", candidates: [] },
        { summary: { total: 3 } },
    ]) {
        assert.equal(summarizeDefinition("SessionManager", def, callers), head, JSON.stringify(callers));
    }
});
test("only symbol-like patterns reach ix", () => {
    assert.equal(isSymbolSearch("SessionManager"), true);
    assert.equal(isSymbolSearch("resolveWidgetConfig"), true);
    for (const pattern of ["ab", "Session.*Manager", "foo(bar)", "\\bSession", "./src/a.ts", "--help"]) {
        assert.equal(isSymbolSearch(pattern), false, pattern);
    }
    // A credential is never forwarded to ix.
    assert.equal(isSymbolSearch("ghp_" + "a".repeat(36)), false);
});
//# sourceMappingURL=search-summary.test.js.map