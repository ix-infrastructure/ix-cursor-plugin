---
name: ix-impact
description: Change risk analysis — blast radius, affected systems, and what to test. Depth scales with risk level; low-risk targets stop early.
argument-hint: <symbol or file path to assess change risk for> [--save [path]]
---

## Argument parsing

Strip `--save` and any following path token from `$ARGUMENTS` before resolving the target.
- If `--save <path>` is present, set `SAVE_PATH` to that path.
- If `--save` is present without a path, auto-generate `ix-impact-<target-slug>.md` in cwd (target slug = the target with spaces and slashes replaced by `-`).
- If `--save` is absent, `SAVE_PATH` is empty — do not write a file.

## Pro check (optional)

If the `ix_briefing` tool is not available in this session, skip every **[Pro]** step below: `ix mcp` lists it only when Ix Pro is installed, so do not call it to find out. If it is available, call it with `{}` and keep the active plans it reports for the **[Pro]** steps.

## Goal

Answer: *what breaks if this changes, and is it safe to proceed?* Stop as early as the risk level allows.

## Phase 1 — Risk score (always)

Call both in parallel:
- `ix_impact` with `{ "target": "<target from $ARGUMENTS>" }`
- `ix_explain` with `{ "symbol": "<target from $ARGUMENTS>" }`

**God-module check:** If the `ix_explain` result reports more than 20 callees and fewer than 2 callers:
> ⚠ This symbol has high callee count and low caller count — it reaches out to many dependents but has few callers. Standard blast-radius metrics may understate risk. Check callers of its key dependencies, not just direct dependents.

This caveat applies regardless of the `ix_impact` risk classification.

**Immediately classify using the `risk=` record and the reach count that `ix_impact` reports.** The reach count depends on the target kind: a leaf target (function, method) prints `counts callers= callees=`, so use `callers=`; a container (file, class, module) prints `dependents=`, so use that. Below, "dependents" means whichever of the two applies:

| Risk level | Action |
|---|---|
| `low` and fewer than 3 dependents | **STOP** — safe to proceed. Report and suggest verification targets. |
| `medium` OR 3–10 dependents | Go to Phase 2 |
| `high` or `critical` OR more than 10 dependents | Go to Phase 2 + 3 |

## Phase 2 — Callers and dependents (medium/high/critical)

Call both in parallel:
- `ix_callers` with `{ "symbol": "<target>" }` (limit 15 per token-budgets rule)
- `ix_depends` with `{ "symbol": "<target>", "depth": 2 }`

Extract: direct callers by name and subsystem, and the number of transitive dependents `ix_depends` reports.

**Stop here if risk is `medium`:** report callers, suggest verification, done.

## Phase 3 — Import chain and subsystem spread (high/critical only)

Call `ix_imported_by` with `{ "symbol": "<target>" }`.

Cross-reference callers + dependents + importers to identify:
- Which subsystems are in the blast radius
- Whether the change crosses an architectural boundary
- Any tests that cover the affected paths

## Output

```
## Impact: [target]

**Risk level:** <critical | high | medium | low>
**Verdict:** <SAFE TO PROCEED | REVIEW CALLERS FIRST | NEEDS CHANGE PLAN>

**Blast radius:**
- Direct dependents: N
- Transitive (depth 2): M
- Subsystems affected: [list — only if phase 3 ran]

**Key callers:** [top 5, with subsystem label]

**At-risk behaviors:** [the at-risk behavior `ix_impact` describes, if any]

**Recommended action:**
- low: proceed, verify [specific callers]
- medium: test [caller list] after change
- high/critical: run `/ix-plan <target>` before editing

**Known bugs in blast radius:** [Pro only — list open bugs touching callers/dependents, or omit section if none/Pro unavailable]
```

## Phase 4 — Known bugs in blast radius **[Pro]**

If Pro is available and an active plan from the briefing references this target area, cross-reference open plans against the direct callers and dependents identified in Phase 2. Any active plan touching the blast radius escalates the risk verdict — flag it explicitly in the output.

Never read source code in this skill. Risk analysis is purely graph-based.

## Save step

**Only if `SAVE_PATH` is non-empty:**
- Write the full output to `SAVE_PATH`.
- Confirm to the user: `Saved to <SAVE_PATH>`.
- Do not write the file if `--save` was not passed.
