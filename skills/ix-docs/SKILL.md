---
name: ix-docs
description: Generate narrative-first, importance-weighted documentation for a repo, system, or subsystem with a selective reference layer. Use --full for deeper module/class/method coverage.
argument-hint: <target> [--full] [--style narrative|reference|hybrid] [--split] [--single-doc] [--out <path>] [--save [path]]
---

## Goal

Produce documentation that helps a new engineer understand the system quickly and gives an LLM strong architectural context without drowning it in low-value detail.

Write like real engineering documentation for a framework or subsystem:
- teach the system
- explain how it works
- show where the important parts live
- surface risks and fragile boundaries
- point the reader to the next files or symbols to inspect

Never write a raw report dump.

---

## Core model

Every `ix-docs` run produces **two layers**:

1. **Narrative layer** (always first) — human-readable explanation, onboarding-focused, architecture, flow, usage, risks, navigation guidance
2. **Reference layer** (always present, but selective) — compressed summaries of important modules, classes, and services; short, structured, high-signal entries; no code dumping

**Mode behavior**
- `ix-docs <target>`: narrative-heavy by default, with a minimal selective reference appendix
- `ix-docs <target> --full`: deeper coverage for important components, still importance-weighted

**Style behavior**
- `--style narrative` (default): prose-first narrative sections; reference layer stays compact
- `--style reference`: tighter, docs-site style structure; narrative stays brief but is not removed
- `--style hybrid`: full narrative plus fuller selective reference; best match for `--full`

---

## Flags

| Fragment | Variable | Default |
|---|---|---|
| first non-flag token | `TARGET` | required |
| `--full` | `FULL=true` | false |
| `--style narrative\|reference\|hybrid` | `STYLE` | `narrative` |
| `--split` | `SPLIT=true` | false |
| `--single-doc` | `SINGLE=true` | false |
| `--out <path>` | `OUT_PATH` | auto-detect |
| `--save [path]` | alias for `--out` when `--out` is absent; if both are given, `--out` wins | — |

**Parsing**
Scan `$ARGUMENTS` left to right:
- The first token that does not begin with `--` is `TARGET`
- `--style` and `--out` consume the next token as their value (also accept `--style=value` form)
- All other flags are boolean toggles
- If `TARGET` is missing, stop and ask the user to supply a target before continuing

**Output rules**
- `--single-doc` forces one Markdown file
- `--split` produces a directory with `index.md` plus per-system or per-subsystem docs
- if neither is set and `FULL=true` on a repo with more than 10 subsystems, auto-enable `SPLIT=true`
- `--single-doc` overrides auto-splitting

**Output path auto-detection**
1. `docs/` exists at workspace root → `docs/<target-name>.md` or `docs/<target-name>/`
2. `doc/` exists → `doc/<target-name>.md` or `doc/<target-name>/`
3. otherwise → `<target-name>.md` or `<target-name>/` at workspace root

If `FULL=true`, tell the user the planned mode, output path, and whether splitting was auto-enabled before generating the docs.

---

## Non-negotiable rules

1. **Graph first** — start with `ix_subsystems`, `ix_overview`, `ix_rank`, `ix_explain`; use `ix_read` only after graph data leaves an important behavior unclear
2. **Importance-weighted expansion** — expand detail by centrality, risk, coupling, orchestration role, and user focus; never treat all modules equally
3. **Selective low-level detail** — default mode: module and class summaries only for important parts; full mode: method summaries only for key classes or services
4. **No raw dumps** — never output raw JSON, never paste tool logs, never dump full inventories
5. **No redundancy** — group repeated patterns; if several modules have the same role, summarize the pattern once
6. **Code reads are rare** — default mode: at most 2 `ix_read` calls total; full mode: at most 5 `ix_read` calls total; symbol-level only

---

## Coverage policy

Use the following ranking factors to decide what gets expanded:
1. **Centrality**: `ix_rank` results, caller count, dependent count
2. **Risk**: `ix_impact`
3. **Coupling**: cross-system or cross-subsystem relationships
4. **Orchestration role**: coordinators, entry points, workflow managers from `ix_explain`
5. **User focus**: the exact target and its immediate neighborhood

### Always include
- top-level architecture
- all major subsystems in scope
- the most important modules or services

### Sometimes include
- important files
- key classes or services
- notable boundary functions or entry points

### Only in `--full`
- selective method summaries for the most important classes or services
- expanded per-subsystem module coverage

### Never
- exhaustive inventories
- equal treatment for every module
- long method lists

### Expansion budgets

**Default mode**
- repo or large system: cover all major subsystems, expand the top 3–5 most important ones, reference 5–8 key components total
- subsystem or module: expand the target fully, reference the top 5–8 entities in scope

**Full mode**
- repo or large system: cover all major systems, expand the top 5–8 by importance
- subsystem or module: expand the top 8–12 entities, add method summaries for the top 3–5 classes or services only

---

## Command strategy

Do not call every tool mechanically. Reuse earlier results and stop when additional depth would not materially improve the documentation.

### Phase 1 — Scope

**Stop early:** If `TARGET` is an unambiguous symbol or small component and scope is clear from `ix_stats` alone, skip the remaining Phase 1 calls and proceed to Phase 2.

Always start by calling in parallel:
- `ix_stats` with `{}`
- `ix_subsystems` with `{}`
- `ix_briefing` with `{}`

**Pro check:** If `ix_briefing` returns `ok: true`, Pro is available. Extract `data.goals`, `data.decisions` for use in **[Pro]** steps. If it returns `ok: false`, skip all Pro-labeled steps.

If `TARGET` is not obviously the whole repo, call `ix_locate` with `{ "symbol": "<TARGET>" }`.

Resolve whether the target is: repo / top-level system / subsystem / module or file / class, service, or symbol. If ambiguous, resolve before proceeding.

### Parallel agent dispatch (large / full-mode runs)

**Trigger:** `FULL=true` AND the target is a repo or top-level system with **more than 5 subsystems**.

**Phase 1 reuse:** If subsystem and rank data is already present in context from a prior `/ix-understand` run in this session, skip those Phase 1 calls and use the cached data directly.

**Step 1 — Per-system agents:** From the Phase 1 rank results, select the top systems by importance (cap at 5). For each, spawn one `ix-system-explorer` agent:

> Task template: *"Build a complete architectural mental model of `$SYSTEM` within `$TARGET`. Focus on: (1) internal module structure and responsibilities, (2) the most important and most-coupled components, (3) main execution flows within this subsystem, (4) outbound dependencies and shared interfaces with other subsystems. Return structured findings with: a one-paragraph subsystem summary, top 5 important modules with roles, key internal flows, and coupling risks."*

**Step 2 — Cross-cutting agent:** Immediately after spawning the per-system agents, spawn one additional `ix-system-explorer` agent:

> Task: *"In the `$TARGET` codebase, identify only what crosses subsystem boundaries: (1) shared types, base classes, and utilities used across multiple subsystems, (2) cross-system execution flows and handoff points, (3) infrastructure or platform services that multiple systems depend on, (4) god-modules or highly-central components visible from the dependency graph. Do NOT explore individual subsystems in depth — focus exclusively on cross-cutting structure. Return structured findings."*

**Do not wait** for agents before starting Phase 2. Continue running Phase 2 calls while agents work.

**Step 3 — Synthesis:** Merge agent findings with Phase 2/3 graph results. Per-system outputs → per-system narrative sections. Cross-cutting output → Dependencies & Relationships section. If an agent contradicts graph data, prefer the graph. If an agent fails, continue without it and note the gap.

**Skip this dispatch entirely** if: `FULL=false`; target is a subsystem, module, or symbol; or the repo has 5 or fewer subsystems.

### Phase 2 — Architecture

**Stop when:** you have identified the top 3–5 important components and the subsystem structure is clear.

Call in parallel (as relevant):
- `ix_overview` with `{ "target": "<TARGET>" }` (skip if TARGET is the whole repo)
- `ix_rank` with `{ "by": "dependents", "kind": "class", "top": 10 }`
- `ix_rank` with `{ "by": "callers", "kind": "function", "top": 10 }`

For module or file targets, also call:
- `ix_imports` with `{ "symbol": "<TARGET>" }`

Full mode: raise rank `top` to 20; inspect the most important systems first, never alphabetically.

### Phase 3 — Behavior

**Stop when:** the main execution flow is understood. Skip `ix_trace` if `ix_explain` results are sufficient.

Call `ix_explain` with `{ "symbol": "<TARGET>" }`.

Also call `ix_explain` for the most important orchestrators, services, or entry points identified in Phase 2.

Behavior budget:
- default mode: explain the top 3–5 important entities
- full mode: for each important subsystem, explain the top 5 classes or services and the top 3 functions or entry points

Optional: call `ix_trace` with `{ "symbol": "<entry-point>" }` only if the main execution flow is still unclear after `ix_explain`. Do not narrate every edge in a trace.

### Phase 4 — Relationships

**Stop when:** for symbol-level or small single-module targets, skip this phase entirely.

**Repo-level guard:** If TARGET is the whole repo, skip `ix_callers`, `ix_callees`, and `ix_depends` on the repo itself — these are not meaningful at repo scope. Instead run them for the top 3–5 boundary components identified in Phase 2.

Call as relevant:
- `ix_callers` with `{ "symbol": "<TARGET>" }` (limit 15)
- `ix_callees` with `{ "symbol": "<TARGET>" }` (limit 15)
- `ix_depends` with `{ "symbol": "<TARGET>", "depth": 2 }`

For large result sets: group callers by subsystem, summarize repeated patterns, never list more than 15 similar names individually.

### Phase 5 — Risk

**Repo-level gate:** If TARGET is the whole repo, skip `ix_impact` on the repo itself. Instead run it for the top 3–5 high-centrality entities from Phase 2.

Otherwise call `ix_impact` with `{ "target": "<TARGET>" }`.

Full mode: also run `ix_impact` for the top 2–5 high-centrality entities.

### Phase 6 — Health

**Stop when:** for symbol-level or single-module targets, skip this phase.

Call `ix_smells` with `{}`. Filter by path prefix after retrieval if the target is a subsystem or module.

**[Pro]** If Pro is available and `data.decisions` is non-empty, incorporate relevant architectural decisions in the risk and complexity section.

Prioritize: god modules, highly coupled regions, orphaned components, subsystems with weak boundaries. Group health issues by subsystem, not as a flat dump.

### Phase 7 — Optional reads

**Stop when:** you reach the read budget. Never exceed it — omit or note gaps instead.

Only read code when graph data is insufficient for an important behavior.

Allowed use cases:
- orchestrators with unclear control flow
- critical entry points on the main execution path
- high-risk components whose role is still ambiguous after `ix_explain`

Call `ix_read` with `{ "symbol": "<symbol>" }`. Extract only the behavior needed to clarify the docs — do not summarize implementation line-by-line.

---

## Writing rules by style

### `--style narrative`
- lead with prose; each narrative section should explain how to think about the system
- reference layer stays compressed

### `--style reference`
- keep the narrative layer first, but tighten it to short paragraphs
- use more headings, bullets, and compact summaries
- reference layer more prominent than in narrative mode

### `--style hybrid`
- full narrative layer plus fuller reference layer
- best option for `--full`, onboarding docs, and handoff docs

---

## Output structure

```markdown
# [Target] — Documentation

> Generated: [date]
> Scope: [repo | system | subsystem | module | symbol]
> Mode: [standard | full]
> Style: [narrative | reference | hybrid]
> Evidence quality: [strong | partial | weak]
> Coverage: [what was expanded vs summarized]

## Part 1 — Narrative

### 1. Overview
- what the system is, what it does, why it exists
- **[Pro]** active project goals this system serves (from briefing data.goals), if available

### 2. Architecture
- systems → subsystems → modules
- boundaries and responsibilities
- high-level structure

### 3. How It Works
- main execution flows
- request or data lifecycle
- orchestration paths

### 4. Key Components
- the most important modules, classes, or services
- why they matter

### 5. Dependencies & Relationships
- major dependencies
- cross-system interactions
- important coupling points

### 6. Risk & Complexity
- high-risk areas
- fragile components
- change sensitivity

### 7. How to Work With This Repo
- where to start
- how to navigate
- common workflows
- what to modify carefully

### 8. Where to Go Deeper
- next files, modules, or symbols to inspect
- suggested exploration paths

## Part 2 — Selective Reference

### Module Summary
For each major module: purpose, responsibilities, dependencies, key contained components

### Class / Service Summary
For each important class or service: role, what it manages, where it is used

### Method Summary
Only in `--full`, and only for key classes or services: method name, 1–2 line role summary
```

---

## Split output

Use split output when `--split` is passed or `FULL=true` on a large repo.

```
<OUT_DIR>/
  index.md
  <system-1>.md
  <system-2>.md
  ...
  <lower-ranked-system>-stub.md
```

`index.md` should contain: overall overview, top-level architecture, most important cross-system flows, navigation guidance, links to per-system docs.

Per-system docs: full narrative structure plus selective reference for that system.

Stubs for lower-ranked systems: one-paragraph overview, top 3 components, one risk note, instruction to rerun `/ix-docs <system> --full` for deeper coverage.

---

## Post-write confirmation

After writing the file or files, confirm:

```
Documentation written.

Mode:   [standard | full]
Style:  [narrative | reference | hybrid]
Output: [path or directory]
Scope:  [repo/system/subsystem/module/symbol]
Coverage: [systems/subsystems/components expanded]

Summary: [2–3 sentences on the system and the most important architectural fact]

[If split:]
Files written: [index + key system docs + stubs]
```
