---
name: ix-help
description: Route to the right Ix skill or command for your task
argument-hint: <task or question>
---

Goal: route only. Do not perform the task. Always return an exact invocation the user can copy-paste.

If `$ARGUMENTS` is empty, return this menu:

| Skill | Use when |
|---|---|
| `/ix-understand <target>` | You want an architectural mental model of a subsystem |
| `/ix-investigate <symbol>` | You want a deep dive on one symbol or feature |
| `/ix-impact <target>` | You want blast radius before editing a file or symbol |
| `/ix-plan <targets...>` | You need a risk-ordered plan for a multi-file change |
| `/ix-debug <symptom>` | You need root-cause analysis for a bug or failure |
| `/ix-architecture [scope]` | You want a design health audit (smells, coupling, hotspots) |
| `/ix-docs <target>` | You need onboarding or reference documentation |

For simple one-step lookups, use raw MCP tools directly:
- Where is X defined (exact name) → `ix_locate` with `{ symbol: "X" }`
- Who calls X → `ix_callers` with `{ symbol: "X", limit: 15 }`
- What does X call → `ix_callees` with `{ symbol: "X", limit: 15 }`
- What imports X → `ix_imported_by` with `{ symbol: "X" }`
- Full-text search → `ix_text` with `{ pattern: "X", limit: 20 }`
- File/symbol listing → `ix_inventory` with `{ kind: "file", path: "..." }`

---

If `$ARGUMENTS` is non-empty, classify the request and recommend exactly one starting point:

- Architecture, onboarding, "how does X work", subsystem understanding → `/ix-understand <target>`
- Symbol deep dive, "what does X do", feature internals → `/ix-investigate <target>`
- Pre-edit risk, blast radius, "what breaks if I change X" → `/ix-impact <target>`
- Multi-file change, refactor, migration, implementation sequence → `/ix-plan <targets>`
- Bug, failure, regression, unexpected behavior → `/ix-debug <symptom>`
- Design quality, complexity, coupling, smells → `/ix-architecture <scope>`
- Documentation, onboarding guide, reference docs → `/ix-docs <target>`
- Single structural lookup (locate, callers, callees, imports) → use the matching MCP tool directly

Output format:
```
Best start: <one sentence>
Run: <exact skill invocation or tool call>
Why: <one short sentence>
```

If the request is ambiguous, make the safest routing choice and state what target placeholder to replace.
