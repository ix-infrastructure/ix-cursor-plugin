import assert from "node:assert/strict";
import test from "node:test";
import { gte, isLlmErrorLine, ixSupportsLlm, MIN_LLM_VERSION, parseSemver, redactLlmText, resetLlmSupportCache, } from "../../lib/llm.js";
import { isTextResult, parseIxJson, wrapOk, wrapText } from "../../lib/parser.js";
test("parseSemver extracts major.minor.patch and tolerates suffixes", () => {
    assert.deepEqual(parseSemver("0.7.0"), [0, 7, 0]);
    assert.deepEqual(parseSemver("1.2.3-beta.4"), [1, 2, 3]);
    assert.deepEqual(parseSemver("v0.6.1"), [0, 6, 1]);
    assert.equal(parseSemver("not-a-version"), null);
    assert.deepEqual(parseSemver("0.0.0-test"), [0, 0, 0]);
});
test("gte implements semver ordering", () => {
    assert.equal(gte([0, 7, 0], MIN_LLM_VERSION), true);
    assert.equal(gte([0, 7, 1], [0, 7, 0]), true);
    assert.equal(gte([1, 0, 0], [0, 7, 0]), true);
    assert.equal(gte([0, 7, 0], [0, 7, 0]), true);
    assert.equal(gte([0, 6, 9], [0, 7, 0]), false);
    assert.equal(gte([0, 0, 0], [0, 7, 0]), false);
});
// ── Security gate: the llm text path must redact every secret the JSON path
// would have redacted per-field. We exercise both paths on the same secrets.
const SECRETS = [
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    "AKIAIOSFODNN7EXAMPLE",
    "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
    "api_key=supersecretvalue1234567890",
    "AIzaSyA1234567890abcdefghijklmnopqrstuv",
];
test("redactLlmText removes every secret pattern", () => {
    for (const secret of SECRETS) {
        const line = `caller name=handleLogin token="${secret}" path=src/auth.ts`;
        const redacted = redactLlmText(line);
        assert.ok(!redacted.includes(secret), `llm path leaked secret: ${secret}`);
        assert.ok(redacted.includes("[REDACTED]"), `llm path did not redact: ${secret}`);
    }
});
test("llm text redaction matches the JSON path field-for-field", () => {
    for (const secret of SECRETS) {
        // JSON path: parseIxJson runs sanitizeParsedValue over each parsed value.
        const jsonField = parseIxJson(JSON.stringify({ token: secret }));
        // llm path: redactLlmText runs over the flat text blob.
        const llmField = redactLlmText(`token=${secret}`);
        assert.ok(!JSON.stringify(jsonField).includes(secret), `JSON path leaked: ${secret}`);
        assert.ok(!llmField.includes(secret), `llm path leaked: ${secret}`);
        // Both reduce the secret to the same [REDACTED] sentinel.
        assert.equal(jsonField.token, "[REDACTED]");
        assert.ok(llmField.includes("[REDACTED]"));
    }
});
test("redaction leaves non-secret text untouched", () => {
    const benign = "region id=cli kind=subsystem label=\"Cli / Client\" files=87 health=0.62";
    assert.equal(redactLlmText(benign), benign);
});
test("wrapText / isTextResult discriminate correctly", () => {
    const textResult = wrapText("ix_stats", {}, "nodes total=98979", 12);
    assert.equal(isTextResult(textResult), true);
    assert.equal(textResult.format, "llm");
    assert.equal(textResult.text, "nodes total=98979");
    const okResult = wrapOk("ix_stats", {}, { total: 1 }, "ok");
    assert.equal(isTextResult(okResult), false);
});
test("isLlmErrorLine detects ix error responses (which ship on stdout w/ exit 0)", () => {
    // Real error lines captured from a live backend.
    assert.equal(isLlmErrorLine('error code=unresolved_target message="No entity resolved for \\"x\\"."'), true);
    assert.equal(isLlmErrorLine('error code=ambiguous_target message="Ambiguous symbol \\"runIx\\"." candidates=1:runIx,2:runIx'), true);
    assert.equal(isLlmErrorLine("  error code=backend_error message=\"fetch failed\""), true);
    // Real success headers must NOT be misread as errors.
    for (const header of [
        "nodes total=2221 function=304 file=115",
        "subsystems count=2",
        "inventory kind=function total=50",
        "callers target=foo count=3",
        "impact target=verify_token kind=function risk=high",
        "region id=cli kind=subsystem label=Client",
    ]) {
        assert.equal(isLlmErrorLine(header), false, `false positive on: ${header}`);
    }
});
test("ixSupportsLlm honors the IX_DISABLE_LLM_FORMAT kill switch", async () => {
    const prev = process.env["IX_DISABLE_LLM_FORMAT"];
    process.env["IX_DISABLE_LLM_FORMAT"] = "1";
    resetLlmSupportCache();
    try {
        assert.equal(await ixSupportsLlm(), false);
    }
    finally {
        if (prev === undefined)
            delete process.env["IX_DISABLE_LLM_FORMAT"];
        else
            process.env["IX_DISABLE_LLM_FORMAT"] = prev;
        resetLlmSupportCache();
    }
});
//# sourceMappingURL=llm.test.js.map