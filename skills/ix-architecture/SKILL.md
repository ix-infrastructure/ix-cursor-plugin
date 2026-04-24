---
name: ix-architecture
description: Analyze system design — structure, coupling, code smells, and high-risk hotspots. Purely graph-based, no code reads.
argument-hint: [path or subsystem name — empty for whole repo] [--save [path]]
---

## Argument parsing

Strip `--save` and any following path token from `$ARGUMENTS` before processing the scope.
- If `--save <path>` is present, set `SAVE_PATH` to that path.
- If `--save` is present without a path, auto-generate `ix-architecture-<scope-slug>.md` in cwd (scope slug = `$ARGUMENTS` with spaces and slashes replaced by `-`, or `repo` if arguments are empty).
- If `--save` is absent, `SAVE_PATH` is empty — do not write a file.

## Health gate

Call `ix_health` with `{}`. If `ok` is `false`, stop: *"ix graph unavailable — ensure the ix server is running."*

Then call `ix_subsystems` with `{}`. If the result contains no subsystems, stop: *"No graph data yet — call `ix_map` to build the graph first."*

## Pro check

Call `ix_briefing` with `{}`. If `ok` is `true`, Pro is available. Extract `data.decisions` for use below. Skip all **[Pro]** steps if it returns `ok: false`.

---

## Phase 1 — Subsystem structure

Call `ix_subsystems` with `{}`.

Filter results to `$ARGUMENTS` scope if provided (match on subsystem name or path prefix). Store the full result as `SUBSYSTEMS`.

**Early-stop gate:** Examine each region's metrics. If ALL of the following are true across every region:
- `cohesion > 0.7`
- `coupling < 0.4`
- `confidence >= 0.6`

→ Report *"System appears structurally healthy — no significant coupling, cohesion, or boundary issues detected."* List subsystems with their metrics and stop. Do not proceed to Phase 2.

---

## Phase 2 — Smell analysis

Call `ix_smells` with `{}` (filter to scope path if `$ARGUMENTS` was provided).

Store as `SMELLS`.

**Health gate — choose one path:**

**Inline path** (all must be true):
- Smell count < 3
- No `god-module` smell present

→ Synthesize the report inline using `SUBSYSTEMS` + `SMELLS`. Proceed to Phase 3 only if needed. Skip delegation.

**Delegate path** (any is true):
- Smell count ≥ 3
- A `god-module` smell is present

→ Spawn the **ix-architecture-auditor** agent. Pass `SUBSYSTEMS` and `SMELLS` directly in the agent prompt so it can skip its own Steps 1–4. Include the scope from `$ARGUMENTS`. Relay the agent's complete output to the user, then skip to the **[Pro] Cross-reference decisions** step.

---

## Phase 3 — Hotspot ranking (inline path only)

Run only if at least one of the following is true:
- A `god-module` smell exists in `SMELLS`
- Any region in `SUBSYSTEMS` shows high coupling

Call `ix_rank` with `{ "by": "dependents", "kind": "class", "top": 10 }`.

Identify top-ranked components that overlap with smell findings or high-coupling regions. Include these as hotspots in the inline report.

If neither condition is met, skip `ix_rank` entirely.

---

## Inline report format

When taking the inline path, produce:

**Summary** — one sentence verdict on overall health.

**Subsystem overview** — table of regions with cohesion, coupling, and confidence scores.

**Smells** — list each smell with affected symbol and severity.

**Hotspots** — (if Phase 3 ran) top-ranked components that coincide with smells or high-coupling regions.

**Recommended action** — one concrete next step.

---

## [Pro] Cross-reference decisions

If Pro is available, after the report (inline or delegated) is complete, check `data.decisions` from the briefing.

Append a **Recorded Decisions** section cross-referencing relevant design decisions against the findings — especially decisions that affect god-modules, high-coupling regions, or identified hotspots.

## Save step

**Only if `SAVE_PATH` is non-empty:**
- Write the full output to `SAVE_PATH`.
- Confirm to the user: `Saved to <SAVE_PATH>`.
- Do not write the file if `--save` was not passed.
