# Ix — Shared Cognitive Model

*Canonical reference for Cursor + Ix. All skills and rules reference this model.*

---

## What Ix Is

Ix is a graph-backed reasoning system for codebases. It builds a persistent structural graph from your repo — tracking symbols, call chains, imports, dependencies, and file relationships — and exposes that graph through MCP tools.

The agent uses Ix as **memory**. Instead of reading files to figure out what code does, the agent queries the graph for structural facts (what calls this, what does this depend on, what is the blast radius of this edit) and then reasons over the results. The graph provides structure; the agent provides understanding.

The key difference: Ix answers structural questions in milliseconds without reading source. File reads (`ix_read`) are a last resort when implementation detail is genuinely needed.

**Default posture:** when a question is primarily structural, prefer Ix tools first. Reach for native file search or source reads only when Ix cannot answer the question confidently or precisely enough.

---

## Tool Taxonomy

Tools grouped by intent — use the cheapest group that answers the question.

| Group | Tools | Use when |
|---|---|---|
| **orient** | `ix_subsystems`, `ix_overview`, `ix_stats` | Starting a new task, getting your bearings |
| **locate** | `ix_locate`, `ix_text`, `ix_inventory` | Finding where something lives |
| **explain** | `ix_explain` | Understanding what a symbol does and how it connects |
| **connections** | `ix_callers`, `ix_callees`, `ix_imported_by`, `ix_imports` | Who calls/uses this, what does this call/import |
| **inspect** | `ix_read` | Reading a symbol's source when structure alone is insufficient |
| **flow/risk** | `ix_trace`, `ix_depends`, `ix_impact` | Understanding call chains, dependency trees, blast radius |
| **history** | `ix_history`, `ix_diff` | Churn signals, what changed across revisions |
| **knowledge** | `ix_decisions`, `ix_briefing` | Architecture decisions, project context |
| **quality** | `ix_smells`, `ix_rank` | Code quality signals, hotspot ranking |
| **maintenance** | `ix_map` | Refreshing the graph after large changes |

**`ix_locate` vs `ix_text`:** `ix_locate` does symbol resolution (fast, use when the symbol name is known). `ix_text` is full-text search (use when the name is fuzzy or you're not sure what you're looking for).

**Required parameters:**
- `ix_rank` always requires `by`, `kind`, and `top`
- `ix_inventory` requires `kind`

---

## Pro Tools

Pro features require an Ix Pro backend. Detect availability by calling `ix_briefing` — if `ok` is `true`, Pro is active.

| Tier | Tools |
|---|---|
| **Standard** | `ix_subsystems`, `ix_overview`, `ix_locate`, `ix_text`, `ix_explain`, `ix_read`, `ix_trace`, `ix_callers`, `ix_callees`, `ix_imports`, `ix_imported_by`, `ix_depends`, `ix_impact`, `ix_inventory`, `ix_smells`, `ix_rank`, `ix_stats`, `ix_map`, `ix_history`, `ix_diff`, `ix_health` |
| **Pro only** | `ix_briefing`, `ix_decisions` |

`ix_briefing` result shape: `{ ok, data: { goals, plans, decisions, repo_orientation } }` — one call provides full project context for all Pro-aware steps.

---

## Routing Table

| What you want to do | Start with |
|---|---|
| Understand how a subsystem works | `/ix-understand <subsystem>` |
| Deep dive into a specific symbol | `/ix-investigate <symbol>` |
| Check risk before editing a file | `/ix-impact <file>` |
| Plan a multi-file refactor | `/ix-plan <target1> <target2> ...` |
| Debug unexpected behavior | `/ix-debug <symptom>` |
| Audit design health / smells | `/ix-architecture [scope]` |
| Write onboarding or reference docs | `/ix-docs <target>` |
| Find where a symbol is defined | `ix_locate` with `{ "symbol": "X" }` |
| Fuzzy symbol search | `ix_text` with `{ "pattern": "X", "limit": 10 }` |
| Find callers of a function | `ix_callers` with `{ "symbol": "X" }` (limit 15) |
| Find what a function calls | `ix_callees` with `{ "symbol": "X" }` (limit 15) |
| Find what imports a module | `ix_imported_by` with `{ "symbol": "X" }` |
| Check what a file contains | `ix_overview` with `{ "target": "X" }` |
| Not sure which to use | `/ix-help <task description>` |

---

## When to Use Each Layer

**Raw MCP tools** — use directly for single-step structural lookups: "where is X defined?", "what calls X?", "what does X import?". Cheaper than invoking a skill.

**Skills** (`/ix-understand`, `/ix-investigate`, etc.) — use when the task has multiple phases or requires synthesis. Skills sequence queries, stop early, and produce structured output. Always prefer a skill over a chain of manual tool calls.

**Rules** (`graph-first.mdc`, `token-budgets.mdc`, etc.) — injected automatically at all times. Do not duplicate rule logic in skill prompts.

**Agents** (`ix-system-explorer`, `ix-bug-investigator`, etc.) — delegate only for large, delegatable work: full architecture exploration, autonomous bug investigation, large refactor planning. Too expensive for routine questions. Skills call agents automatically when depth warrants it.

---

## Graph-First Decision Rules

1. **Orient before diving.** Call `ix_subsystems` or `ix_overview` first to understand the shape before querying individual symbols.
2. **Locate before explaining.** Use `ix_locate` to confirm a symbol exists and get its canonical name before calling `ix_explain`.
3. **Explain before reading.** `ix_explain` gives role, connections, and callers from the graph. Only call `ix_read` when you need implementation detail the graph does not provide.
4. **Prefer ix over native search for structure.** If the question is "where is this defined", "what calls this", "what does this depend on", or "what will this edit affect", use Ix tools before native file search.
5. **Do not duplicate hook-injected context.** If a hook already surfaced a relevant answer or context, use it rather than re-running the same query.
6. **Stop when the question is answered.** Do not run the next phase if the current one was sufficient.
7. **Label your evidence.** Distinguish graph-backed facts from inferences. Use [graph] and [inferred] labels.
8. **Max depth 2 for depends/trace.** Always cap `ix_depends` and `ix_trace` at depth 2. Deeper traversals fan out quickly and exceed token budgets.

---

## Fallback Behavior

**When ix tools return errors:**
Exit the Ix query path gracefully. Do not surface raw error JSON. Fall back to native tools and note that the ix query failed.

**When graph confidence is low (< 0.6):**
Treat structural results as approximate — useful for orientation but not authoritative. Add: `⚠ Graph confidence low — treat structural data as approximate`. Do not block native tool use on low-confidence results.

**When results are empty:**
Do not assume the symbol does not exist. The graph may not cover it. Fall back to `ix_text` for a text search, then to native search if that also returns nothing.

**When the graph may be stale:**
If recent edits have not been mapped, call `ix_map` with `{ "file": "<changed-file>" }` before relying on structural data for that file. Staleness is most likely after bulk file changes.

---

## Token Budget

| Operation | Cap | Reason |
|---|---|---|
| Text search | `limit: 20` | Prevents huge result sets |
| Symbol rank | `top: 10–15` | Test fixtures inflate counts; exclude test paths when possible |
| Callers / callees | limit 15 | Default is wasteful; 15 covers most cases |
| Dependency tree | `depth: 2` max | `ix_depends` depth 3+ can explode on connected nodes |
| Traces | depth 2 max; one per investigation | `ix_trace` without depth cap fans out widely |
| Code reads | Symbol-level only, max 2 per task (default) | Source reads are expensive — exhaust graph first |

---

## Skills in This Plugin

| Skill | Purpose |
|---|---|
| `/ix-understand` | Mental model of a system or subsystem |
| `/ix-investigate` | Deep dive into a specific symbol |
| `/ix-impact` | Blast radius before an edit |
| `/ix-plan` | Risk-ordered plan for multi-file changes |
| `/ix-debug` | Root cause analysis from a symptom |
| `/ix-architecture` | Design health audit |
| `/ix-docs` | Narrative-first documentation from graph |
| `/ix-help` | Route to the right skill or tool |
