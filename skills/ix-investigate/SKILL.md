---
name: ix-investigate
description: Deep dive into a symbol, feature, or bug. Graph-first, minimal code reads, early stopping when sufficient evidence found.
argument-hint: <symbol, function name, or "how does X work?"> [--save [path]]
---

## Argument parsing

Strip `--save` and any following path token from `$ARGUMENTS` before resolving the target.
- If `--save <path>` is present, set `SAVE_PATH` to that path.
- If `--save` is present without a path, auto-generate `ix-investigate-<target-slug>.md` in cwd (target slug = the target with spaces and slashes replaced by `-`).
- If `--save` is absent, `SAVE_PATH` is empty — do not write a file.

## Pro check (optional)

Call `ix_briefing` with `{}`. If `ok` is `true`, Pro is available. Extract `data.decisions` and `data.plans` for use in Pro steps below. If it returns `ok: false`, skip all **[Pro]** labeled steps.

## Goal

Answer: *what is this, how does it connect, and what's the execution path?* Stop as soon as those three questions can be answered accurately.

## Phase 1 — Locate (always)

Call `ix_locate` with `{ "symbol": "<target from $ARGUMENTS>" }`.

If multiple matches: use the `resolution_mode` and `diagnostics` fields to refine. Do not proceed until the entity is unambiguous.

If `ix_locate` returns no match: call `ix_text` with `{ "pattern": "<target>", "limit": 10 }`.

## Phase 2 — Explain (always)

Call `ix_explain` with `{ "symbol": "<resolved-symbol>" }`.

Extract: `role.role`, `importance.level`, `facts.callerCount`, `facts.calleeCount`.

If the resolved entity is a **class or module**, also call `ix_overview` with `{ "target": "<resolved-symbol>" }`. This reveals internal structure (members, sub-components) without reading source.

**Orphan check:** If `facts.callerCount === 0` AND `facts.calleeCount === 0` in the `ix_explain` result:
- Report: "Symbol is a graph orphan — no detected dependencies. Either the graph needs a refresh (`ix_map`) or the file has no parseable import/call relationships."
- Suggest calling `ix_map` with `{ "file": "<path>" }` as first step.
- Stop here — skip Phases 3–5 unless the user specifically asks for source-level inspection.

**Evaluate:** Is the explanation sufficient to answer the question?

**Stop if:** explain gave clear role, purpose, and connection summary → skip to Output.

## Phase 3 — Connections (run only if caller/callee detail needed)

Run only the directions you need — not both by default:

- If "who uses this" matters: call `ix_callers` with `{ "symbol": "<symbol>" }` (limit: 15 per token-budgets rule)
- If "what does this do internally" matters: call `ix_callees` with `{ "symbol": "<symbol>" }` (limit: 15)

**Stop if:** you now know who uses it and what it depends on.

## Phase 4 — Trace (run only if execution flow is unclear)

Call `ix_trace` with `{ "symbol": "<symbol>" }`.

One trace only. Focus on the direction most relevant to the question (upstream = who calls it; downstream = what it calls).

**Stop if:** execution path is now clear.

## Phase 5 — Code read (last resort only)

Only if the above steps leave a specific implementation question unanswered:

Call `ix_read` with `{ "symbol": "<symbol>" }`.

Read **the symbol only** — never the full file. If the symbol is a class, read the specific method suspected.

**Hard limit:** One `ix_read` call maximum. If still unclear after reading, surface the ambiguity to the user rather than reading more.

## Phase 6 — Design context **[Pro]**

If Pro is available and `data.decisions` from the briefing is non-empty, call `ix_decisions` with `{ "path": "<resolved-symbol>" }` to check for decisions affecting this symbol.

Include any relevant decisions in the output under **Design context**.

## Output

```
## [Symbol] — Investigation

**What it is:** [kind, file, subsystem — from graph]
**Role:** [orchestrator / boundary / helper / utility / etc.]

**Execution flow:**
[downstream: what it calls → what those call, 2 levels max]
[upstream: who calls it, top 5]

**Key connections:**
- Depends on: [top 3 callees]
- Used by: [top 3 callers with their subsystem]

**Design context:** [Pro only — relevant recorded decisions, or omit section if none]

**Evidence quality:** [strong / partial / uncertain] — [one-line reason]

**Next step:**
- [most useful follow-up based on findings]
```

If confidence < 0.7 in ix output, label those claims as `[uncertain]` and recommend calling `ix_map` to refresh.

## Save step

**Only if `SAVE_PATH` is non-empty:**
- Write the full output to `SAVE_PATH`.
- Confirm to the user: `Saved to <SAVE_PATH>`.
- Do not write the file if `--save` was not passed.
