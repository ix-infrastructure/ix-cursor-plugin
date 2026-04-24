---
name: ix-plan
description: Generate a risk-ordered implementation plan for a set of targets. Assesses blast radius per target, finds data flows between them, and produces a safe change sequence.
argument-hint: <symbol1> [symbol2...] or "description of what you want to change" [--save [path]]
---

## Argument parsing

Strip `--save` and any following path token from `$ARGUMENTS` before resolving targets.
- If `--save <path>` is present, set `SAVE_PATH` to that path.
- If `--save` is present without a path, auto-generate `ix-plan-<target-slug>.md` in cwd (target slug = the first target or first three words of the description with spaces and slashes replaced by `-`).
- If `--save` is absent, `SAVE_PATH` is empty — do not write a file.

## Pro check (optional)

Call `ix_briefing` with `{}`. If `ok` is `true`, Pro is available. Extract `data.goals`, `data.plans`, and `data.decisions` for use in Pro steps below. If it returns `ok: false`, skip all **[Pro]** labeled steps.

## Goal

Answer: *in what order should these changes be made, what will break, and what needs testing?*

## Phase 1 — Scope (always)

If `$ARGUMENTS` contains symbol names, proceed.
If `$ARGUMENTS` is a description (no identifiable symbols), first call in parallel:
- `ix_text` with `{ "pattern": "<$ARGUMENTS>", "limit": 10 }`
- `ix_locate` with `{ "symbol": "<$ARGUMENTS>" }`

Identify the 1–4 most relevant symbols and treat those as targets.

## Phase 2 — Impact per target (parallel)

For each identified target, call simultaneously:
- `ix_impact` with `{ "target": "<target>" }`
- `ix_callers` with `{ "symbol": "<target>" }` (limit 10 per token-budgets rule)

Rank targets by risk level: critical > high > medium > low.

**Fast path — all low risk:** If every target is `low` risk AND has < 3 dependents, skip Phases 3–5. Go directly to Output with verdict "SAFE — all targets low risk; no additional data-flow, shared-dependent, or project-context analysis needed."

**Delegation gate — high-complexity path:** If the fast path did not trigger, check for high complexity:

1. From Phase 2 results: does any target have `dependents > 20`?
2. If not already known, call `ix_subsystems` with `{}` (reads cached data — cheap) and check if any non-low-risk target's region has high coupling.
3. If either condition is true:
   - Spawn `ix-safe-refactor-planner` with pre-filled context:
     - **TARGETS**: the resolved symbol list from Phase 1
     - **RISK_TABLE**: the ranked table from Phase 2 (agent skips its own Steps 1–3)
     - **SUBSYSTEMS**: subsystems result from step 2
   - Stop — the agent produces the full sequenced plan.

Otherwise continue inline with Phases 3–5.

## Phase 3 — Data flow (only if 2+ targets AND at least one is medium/high/critical)

Find how the targets connect by calling `ix_trace` with `{ "symbol": "<highest-risk-target>", "to": "<second-target>" }`.

Run for the most architecturally significant pair. Skip if targets are in independent subsystems.

## Phase 4 — Shared dependents (only if high/critical targets exist; skip if all low risk)

Call `ix_depends` with `{ "symbol": "<highest-risk-target>", "depth": 2 }`.

Identify if any third symbol depends on multiple targets (shared blast radius — highest testing priority).

## Phase 5 — Project context **[Pro]**

If Pro is available:
- Check `data.plans` from the briefing result for existing plans overlapping this change.
- Check `data.goals` for active goals this change serves.

Cross-reference to avoid duplicate work. If an existing plan covers these targets, reference it. If active goals exist, note which goal this change serves.

At the end of the output, suggest the user record a plan to track execution (Pro feature).

## Output

```
# Change Plan

## Targets & Risk

| Target | Risk | Dependents | Key Callers |
|--------|------|------------|-------------|
| <A>    | high | 12         | X, Y, Z     |
| <B>    | low  | 2          | P           |

## Change Order

Edit in this sequence to minimize breakage:
1. [target] — [reason: lowest risk / most-depended-upon first]
2. ...

## Data Flow
[A → trace path → B — or "targets are independent"]

## Shared Risk
[Symbols affected by changes to multiple targets — these need testing after every change]

## Test Checkpoints
After [target A]: verify [specific callers]
After [target B]: verify [specific callers]

## Red Flags
- [any critical/high target needing extra care]
- [any cross-subsystem boundary being crossed]

## Project context **[Pro]**
- Goal this serves: [from briefing data.goals — omit if Pro unavailable]
- Existing plan to track against: [plan title, or "none — suggest creating one"]
```

Do not read source code in this skill unless a target cannot be resolved by `ix_locate`.

## Save step

**Only if `SAVE_PATH` is non-empty:**
- Write the full output to `SAVE_PATH`.
- Confirm to the user: `Saved to <SAVE_PATH>`.
- Do not write the file if `--save` was not passed.
