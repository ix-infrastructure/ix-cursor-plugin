# ix-cursor-plugin Specification

Version: 0.1.0
Plugin name: `ix-memory`
Target host: Cursor IDE plugins
Status: Design spec for V1 implementation

---

## Overview

`ix-cursor-plugin` ports the existing `ix-claude-plugin` product surface into Cursor's native plugin model while preserving Ix-first behavior:

1. Prefer graph knowledge over blind text search
2. Inject lightweight repo and session context before reasoning
3. Warn before risky edits
4. Keep the graph fresh after edits
5. Expose higher-level workflows through skills and subagents
6. Stop early to keep token and read costs low

The core migration decision is:

> In Cursor, MCP is the primary execution surface. Hooks are thin orchestration around MCP, not the main product surface.

The plugin does not reimplement Ix. It adapts Cursor-native primitives to the existing Ix CLI and backend.

---

## Goals

- Deliver the same user-visible workflows as `ix-claude-plugin`
- Preserve graph-first reasoning and low-read behavior
- Make Ix available to Cursor agents through typed MCP tools
- Recreate ambient behavior with hooks for briefing, pre-edit checks, and post-edit ingest
- Keep the implementation thin by using the existing `ix` CLI as the backend for V1
- Preserve the existing cognitive split: rules, skills, subagents, hooks, and shared model

## Non-goals

- Rewriting graph logic inside the plugin
- Achieving byte-for-byte parity with Claude-specific internals
- Optimizing for Cursor CLI in V1 before IDE parity is verified
- Shipping aggressive search blocking before false-positive rates are measured
- Adding automatic issue filing, destructive automation, or broad networked side effects

---

## Product Definition

### User-visible guarantees

V1 should preserve these guarantees:

- Same slash-level workflows as the Claude plugin
- Same graph-first reasoning policy
- Same edit safety behavior
- Same ingest freshness behavior
- Same low-token, low-read philosophy
- Same escalation path into specialized agents

### Success metric

The port is successful if this end-to-end loop works:

1. The user asks Cursor to understand a subsystem.
2. The plugin injects current repo and session context.
3. The agent uses `ix_subsystems` and `ix_explain` instead of blind grep.
4. The user edits a risky file.
5. The plugin warns before the edit.
6. The edit completes.
7. The plugin ingests the updated file automatically.
8. A follow-up question reflects the updated graph state.

---

## Architecture

### Three-layer model

```text
Ix Graph      = structured code memory (symbols, dependencies, decisions, history)
Cursor        = reasoning engine and tool caller
Plugin layer  = rules, skills, subagents, hooks, and MCP wrappers over Ix
```

### Runtime topology

```text
Cursor Agent
  -> Cursor Plugin
      -> Rules
      -> Skills
      -> Subagents
      -> Hooks
      -> MCP Server (Ix wrappers)
            -> ix CLI
            -> Ix backend
            -> Graph store
```

### Core design decisions

- Use MCP as the default surface for structured Ix access.
- Keep `ix` CLI as the V1 execution backend.
- Return structured JSON from MCP tools, not prose-first strings.
- Keep hooks lightweight, bounded, and mostly advisory.
- Start search interception in augment mode and only block on high-confidence symbol cases.
- Design V1 as IDE-first until Cursor CLI plugin parity is verified.

---

## Repository Layout

```text
ix-cursor-plugin/
├── plugin/
│   ├── manifest.json
│   ├── marketplace.json
│   └── README.md
├── mcp/
│   ├── server.ts
│   ├── tools/
│   │   ├── briefing.ts
│   │   ├── locate.ts
│   │   ├── text.ts
│   │   ├── explain.ts
│   │   ├── callers.ts
│   │   ├── callees.ts
│   │   ├── trace.ts
│   │   ├── depends.ts
│   │   ├── impact.ts
│   │   ├── subsystems.ts
│   │   ├── stats.ts
│   │   ├── rank.ts
│   │   ├── smells.ts
│   │   ├── inventory.ts
│   │   ├── decisions.ts
│   │   ├── map.ts
│   │   └── health.ts
│   └── lib/
│       ├── cli.ts
│       ├── parser.ts
│       ├── errors.ts
│       └── config.ts
├── rules/
│   ├── graph-first.mdc
│   ├── token-budgets.mdc
│   ├── docs-mode.mdc
│   ├── no-duplicate-hook-work.mdc
│   └── risk-aware-editing.mdc
├── skills/
│   ├── ix-help/
│   ├── ix-understand/
│   ├── ix-investigate/
│   ├── ix-impact/
│   ├── ix-plan/
│   ├── ix-debug/
│   ├── ix-architecture/
│   └── ix-docs/
├── subagents/
│   ├── ix-explorer.md
│   ├── ix-system-explorer.md
│   ├── ix-bug-investigator.md
│   ├── ix-safe-refactor-planner.md
│   └── ix-architecture-auditor.md
├── hooks/
│   ├── prompt-briefing.ts
│   ├── pre-search.ts
│   ├── pre-bash.ts
│   ├── pre-edit.ts
│   ├── post-edit-ingest.ts
│   └── stop-annotate.ts
└── shared/
    ├── cognitive-model.md
    ├── ledger.ts
    ├── intent-classifier.ts
    └── summarizers.ts
```

---

## Components

## 1. Plugin manifest

The plugin manifest declares plugin metadata, bundled resources, permissions, configuration, and marketplace metadata.

### Required outcomes

- Declare the plugin as `ix-memory`
- Bundle MCP server, skills, subagents, hooks, and rules
- Document local dependency expectations:
  - `ix` available on `PATH`, or a future plugin-managed binary
  - reachable Ix backend if a remote service is required
- Expose install and update guidance
- Limit permissions to the minimum needed for local graph-aware operation

### Manifest notes

Field names such as `name`, `displayName`, `version`, `description`, `author`, `homepage`, `resources`, `configuration`, `permissions`, `commands`, and `marketplace` should be treated as design guidance until Cursor's exact manifest schema is verified in implementation.

## 2. MCP server

The MCP server is the most important new component. It exposes Ix as typed tools that Cursor agents can call directly.

### V1 tool inventory

- `ix_health`
- `ix_briefing`
- `ix_subsystems`
- `ix_overview`
- `ix_stats`
- `ix_locate`
- `ix_text`
- `ix_inventory`
- `ix_explain`
- `ix_callers`
- `ix_callees`
- `ix_imports`
- `ix_imported_by`
- `ix_trace`
- `ix_depends`
- `ix_impact`
- `ix_smells`
- `ix_rank`
- `ix_decisions`
- `ix_map`
- `ix_read`
- `ix_history`
- `ix_diff`

### Tool contract

Each MCP tool should:

1. Accept typed structured input
2. Validate input before execution
3. Call `ix ... --format json`
4. Parse and normalize the result
5. Return stable JSON with `ok`, `tool`, `input`, `summary`, `data`, `evidence`, and `timing_ms`
6. Normalize failures into a consistent error shape

### Example output

```json
{
  "ok": true,
  "tool": "ix_impact",
  "input": {
    "target": "src/foo.ts",
    "depth": 2
  },
  "summary": "High-risk change area with 7 dependents",
  "data": {
    "risk_level": "high",
    "dependents": 7,
    "hotspots": ["src/bar.ts", "src/baz.ts"]
  },
  "evidence": [
    { "kind": "graph", "id": "claim_123" },
    { "kind": "symbol", "name": "FooService.update" }
  ],
  "timing_ms": 184
}
```

### V1 implementation strategy

- Build a thin wrapper layer in `mcp/tools/*.ts`
- Centralize CLI invocation, timeouts, and stderr handling in `mcp/lib/cli.ts`
- Parse JSON once and normalize in `mcp/lib/parser.ts`
- Keep graph semantics inside Ix, not the plugin

## 3. Rules

Rules are the Cursor-native home for the shared cognitive model now stored in `ix-claude-plugin/skills/shared.md`.

### `graph-first.mdc`

- Orient before diving
- Locate before explain
- Explain before read
- Prefer Ix structural tools over raw grep when the task is about code relationships
- Reuse context already injected by hooks
- Stop when the question is answered

### `token-budgets.mdc`

- Text search cap: 20
- Symbol search cap: 10
- Callers or callees cap: 15
- Dependency depth max: 2
- Code reads max: 2 by default

### `risk-aware-editing.mdc`

- Call `ix_impact` before meaningful edits
- If risk is high, generate or request a change plan before editing
- Prefer narrow edits over broad refactors without impact analysis

### `docs-mode.mdc`

- Start from `ix_subsystems`, `ix_stats`, and `ix_overview`
- Use `ix_trace` only when runtime behavior matters
- Keep code reads scarce and purposeful

### `no-duplicate-hook-work.mdc`

- Avoid redoing work the hooks already performed
- Prefer hook-provided briefing, search hints, and risk context if still fresh
- Do not call the same expensive graph query twice without a reason

## 4. Skills

The eight Claude skills map almost directly into Cursor skills.

| Claude skill | Cursor skill | Notes |
|---|---|---|
| `/ix-help` | `ix-help` | Router and menu skill |
| `/ix-understand` | `ix-understand` | Same orient and model-building flow |
| `/ix-investigate` | `ix-investigate` | Same locate, explain, trace sequencing |
| `/ix-impact` | `ix-impact` | Same risk scaling and early stop |
| `/ix-plan` | `ix-plan` | Same multi-target planning and shared risk analysis |
| `/ix-debug` | `ix-debug` | Same symptom-to-root-cause workflow |
| `/ix-architecture` | `ix-architecture` | Same graph-only audit posture |
| `/ix-docs` | `ix-docs` | Same narrative-first documentation workflow |

### Common skill structure

Each skill should define:

- Purpose
- When to use
- Tool sequence
- Stop conditions
- Token and read budget
- Expected output structure
- Escalation rules to subagents

### Example: `ix-investigate`

Expected flow:

1. Call `ix_locate`
2. Call `ix_text` only if locate is ambiguous
3. Call `ix_explain`
4. Call `ix_callers` or `ix_callees` if relationship context is needed
5. Call `ix_trace` if runtime or execution path is needed
6. Do at most one source read if graph evidence is insufficient
7. Return:
   - what it is
   - where it sits
   - how execution reaches it
   - main dependencies
   - confidence and evidence

## 5. Subagents

The existing Claude agents should port directly into Cursor subagents.

### Subagent inventory

- `ix-explorer`
- `ix-system-explorer`
- `ix-bug-investigator`
- `ix-safe-refactor-planner`
- `ix-architecture-auditor`

### Common subagent contract

Each subagent should declare:

- Scope of responsibility
- Permitted tools
- Max read budget
- Max trace depth
- Expected output schema
- Stop conditions and handoff conditions

### Example: `ix-bug-investigator`

Allowed tools:

- `ix_locate`
- `ix_text`
- `ix_explain`
- `ix_trace`
- `ix_callers`
- `ix_read` with a hard max of 2 reads

Deliverable:

- Entry point
- Candidate root causes
- Ranked evidence
- Fix hypothesis
- Validation plan

## 6. Hooks

Hooks recreate the ambient behavior of the Claude plugin while staying thinner and more bounded.

### A. Prompt briefing hook

Claude equivalent: `hooks/ix-briefing.sh`

Cursor behavior:

- Trigger before the agent handles a new prompt
- Call `ix_briefing`
- Cache the result with a 10-minute TTL
- Inject concise context:
  - goals
  - active plans
  - recent decisions
  - repo orientation
- Fail silently
- Apply a hard timeout
- Avoid prompt spam

### B. Search interception hook

Claude equivalents: `hooks/ix-intercept.sh` and `hooks/ix-bash.sh`

Cursor behavior:

- Detect symbol-like or structural search intent before raw search
- If intent is symbolic:
  - call `ix_locate`
  - call `ix_text`
- If confidence is high, block or strongly prefer Ix results
- If confidence is medium, augment native search
- If the action is glob or inventory-like, call `ix_inventory`

V1 guidance:

- Start in augment mode
- Enable blocking only for high-confidence symbol cases after validation

### C. Pre-edit hook

Claude equivalent: `hooks/ix-pre-edit.sh`

Cursor behavior:

- Trigger before edit, write, or multi-edit
- Detect file type
- Skip non-code files
- Call `ix_impact`
- Inject a warning for medium, high, or critical risk

Example warnings:

- Medium: editing this file may affect 4 dependents
- High: shared dependency path detected through specific hotspots
- Critical: generate a change plan before editing

### D. Post-edit ingest hook

Claude equivalent: `hooks/ix-ingest.sh`

Cursor behavior:

- Trigger after edit, write, multi-edit, or notebook edit
- Run `ix_map <file>` or equivalent incremental ingest
- Execute asynchronously and non-blocking
- Retry once on failure
- Rate-limit repeated hits on the same file

### E. Stop annotation hook

Claude equivalent: `hooks/ix-annotate.sh`

Cursor behavior:

- Optionally emit one-line attribution at task end
- Examples:
  - Ix surfaced the relevant symbol before raw search
  - Ix warned about edit risk due to shared dependents

V1 default:

- Off, or brief-only

### F. Debounced full-map hook

Claude equivalent: `hooks/ix-map.sh`

Cursor behavior:

- After stop, or after a burst of edits, check debounce state
- Acquire a lock
- Run full `ix_map`
- Skip when recent incremental ingest is sufficient

## 7. Shared ledger and telemetry

Retain the ledger system from the Claude plugin.

### Stored events

- Turn id
- Tool calls
- Hook decisions
- Intercept decisions
- Risk warnings emitted
- Ingest events
- Timing
- Cache hits and misses

### Ledger goals

- Support stop annotations
- Debug bad routing or noisy hooks
- Measure token and latency savings
- Enable future analytics and dashboarding

## 8. Permissions and trust model

Define the trust boundary in three layers:

1. Plugin manifest permissions
2. MCP server command allowlist
3. Hook runtime allowlist

### Allowed command surface

- `ix *`
- `git *`
- targeted shell helpers only when required
- JSON formatting helpers when needed

### Denied by default

- Arbitrary network writes
- Automatic issue creation
- Destructive shell without explicit user action
- Secret reads
- Broad traversal outside the workspace and approved config directories

Automatic issue filing should remain out of scope for the Cursor port.

---

## Behavioral Parity Matrix

| Capability | Claude plugin | Cursor target | Priority |
|---|---|---|---|
| Session briefing | Yes | Yes | P0 |
| Graph-first skills | Yes | Yes | P0 |
| Specialized subagents | Yes | Yes | P0 |
| Grep and glob interception | Yes | Yes | P1 |
| Bash grep augmentation | Yes | Partial | P2 |
| Pre-edit impact warning | Yes | Yes | P0 |
| Post-edit incremental ingest | Yes | Yes | P0 |
| Stop annotation | Yes | Yes | P2 |
| Debounced full-map refresh | Yes | Yes | P1 |
| Install-time permission model | Yes | Yes | P0 |
| Shared cognitive model | Yes | Yes, as rules | P0 |

---

## Standard Data Contracts

These contracts should be shared across tools, hooks, skills, and ledgering.

### Risk result

```json
{
  "risk_level": "low | medium | high | critical",
  "summary": "string",
  "dependents": 0,
  "hotspots": [],
  "recommended_action": "safe_to_proceed | review_callers_first | needs_change_plan"
}
```

### Search or intercept result

```json
{
  "intent": "symbol | literal | file | unknown",
  "confidence": 0.0,
  "mode": "augment | block | pass",
  "matches": [],
  "reason": "string"
}
```

### Briefing result

```json
{
  "goals": [],
  "plans": [],
  "decisions": [],
  "repo_orientation": {},
  "generated_at": "timestamp",
  "ttl_seconds": 600
}
```

### Ledger event

```json
{
  "turn_id": "string",
  "event_type": "hook | tool | intercept | ingest | annotate",
  "name": "string",
  "timing_ms": 0,
  "ok": true,
  "metadata": {}
}
```

---

## Implementation Phases

## Phase 0: discovery and packaging spike

Goal: prove the plugin loads in Cursor.

Deliverables:

- Minimal Cursor plugin manifest
- One MCP tool: `ix_health`
- One skill: `ix-help`
- One rule: `graph-first`
- Local install instructions

Exit criteria:

- Plugin appears in Cursor
- Agent can call `ix_health`

## Phase 1: MCP backbone

Goal: expose Ix as tools.

Deliverables:

- Core MCP wrappers
- Typed JSON outputs
- Consistent error model
- Local CLI backend adapter

Exit criteria:

- Agent can run `ix_locate`, `ix_explain`, `ix_impact`, `ix_trace`, and `ix_subsystems`

## Phase 2: skills and subagents

Goal: restore the higher-level product experience.

Deliverables:

- All 8 skills
- All 5 subagents
- Read and trace budgets enforced in prompts and rules
- Structured outputs

Exit criteria:

- `ix-understand`, `ix-debug`, `ix-plan`, and `ix-docs` work end to end

## Phase 3: hooks

Goal: restore ambient intelligence.

Deliverables:

- Briefing hook
- Pre-edit warning hook
- Post-edit ingest hook
- Optional search interception hook

Exit criteria:

- Editing a high-risk file produces a warning
- Writing a file triggers ingest
- New prompts get cached briefing context

## Phase 4: optimization and safety

Goal: make the plugin stable, quiet, and safe.

Deliverables:

- Cache and TTL support
- Debounce and locking for full map refresh
- Telemetry ledger
- Secret-pattern suppression
- Strict allowlist
- Configurable hook verbosity

Exit criteria:

- Hooks are not noisy
- Duplicate work is minimized
- Latency is stable

---

## Acceptance Criteria

V1 is acceptable when all of the following are true:

- Cursor can install and load the plugin successfully in IDE mode
- The MCP server exposes a stable typed tool surface over the existing `ix` CLI
- The rules reproduce the existing graph-first cognitive model
- The eight skills and five subagents are available and usable
- Pre-edit warnings and post-edit ingest work reliably
- Prompt briefing is cached and silent on failure
- Search interception defaults to safe augment behavior unless confidence is high
- The ledger records enough detail to explain tool routing and hook actions
- No destructive or networked side effects occur without explicit user intent

---

## Risks and Open Questions

- Cursor manifest schema needs exact verification during implementation.
- Cursor CLI plugin parity is not assumed; V1 should be IDE-first.
- Hook ordering and resource injection semantics may require adaptation once tested in Cursor.
- Search interception is the most likely source of false positives and should ship conservatively.
- Some Claude behaviors may map better to Cursor rules than to hooks; implementation should prefer the simpler primitive when parity is equivalent.

---

## Recommended Build Order

1. Keep the existing `ix` CLI exactly as-is.
2. Build a thin MCP wrapper over the CLI.
3. Port `skills/shared.md` into Cursor rules.
4. Port the eight skills with minimal semantic changes.
5. Port the five agents into subagents.
6. Add briefing and pre-edit hooks first.
7. Add post-edit ingest next.
8. Add search interception only after measuring false positives.
9. Add stop annotations last.

This sequence delivers usable value early while deferring the highest-risk interception logic until the plugin is already useful.
