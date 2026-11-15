// Copyright 2026 Ix Infrastructure Inc.

export interface RiskResult {
  target?: string;
  riskLevel?: string;
  riskSummary?: string;
  nextStep?: string;
  dependents?: number;
  summary?: {
    directDependents?: number;
    memberLevelCallers?: number;
  };
  topImpactedMembers?: Array<{ name?: string }>;
}

export function summarizeRisk(result: RiskResult): string {
  const riskLevel = result.riskLevel ?? "unknown";
  if (riskLevel === "unknown" || riskLevel === "low") {
    return "";
  }

  const target = result.target ?? "this target";
  const directDependents = result.summary?.directDependents ?? 0;
  const memberCallers = result.summary?.memberLevelCallers ?? 0;
  const dependents = result.dependents ?? Math.max(directDependents, memberCallers);
  const riskSummary = result.riskSummary ? ` ${result.riskSummary}` : "";
  const nextStep = result.nextStep ? ` → ${result.nextStep}` : "";
  const hotspots = (result.topImpactedMembers ?? [])
    .slice(0, 3)
    .map((member) => member.name ?? "")
    .filter(Boolean);
  const hotspotText = hotspots.length > 0 ? ` Hot spots: ${hotspots.join(", ")}.` : "";

  switch (riskLevel) {
    case "critical":
      return (
        `[ix] CRITICAL EDIT — make a change plan before editing further. ` +
        `${target} has ${dependents} dependents.${riskSummary}${hotspotText}${nextStep}`
      );
    case "high":
      return (
        `[ix] HIGH-RISK EDIT — ${target} has ${dependents} dependents.` +
        `${riskSummary}${hotspotText}${nextStep}`
      );
    case "medium":
      return (
        `[ix] NOTE — editing ${target} may affect ${dependents} dependents.` +
        `${riskSummary}${nextStep}`
      );
    default:
      return "";
  }
}

// ── Symbol search: where a name is defined and who calls it ──────────────────
// Used by the Grep (pre-search) and shell-search hooks through
// shared/search-context.ts. Deliberately says nothing about text matches: the
// search the agent just ran already returned those.

/** The fields of `ix locate --format json` read here. */
interface LocateRecord {
  error?: unknown;
  code?: unknown;
  confidence?: number;
  resolvedTarget?: { name?: string; kind?: string; path?: string; confidence?: number };
}

/** The fields of `ix callers --format json` read here. */
interface CallersRecord {
  error?: unknown;
  code?: unknown;
  results?: Array<{ name?: string; kind?: string; path?: string }>;
  summary?: { total?: number };
}

export interface Definition {
  name: string;
  kind: string | undefined;
  path: string | undefined;
}

// Below this, locate's answer is a guess, not a definition to point the agent at.
const MIN_LOCATE_CONFIDENCE = 0.6;
const MAX_CALLERS_SHOWN = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The single definition `ix locate` resolved with confidence, or null. A
 * refusal record (ambiguous target, not found, workspace not mapped — reported
 * under `error`, or `code` for ambiguity) has no single definition.
 */
export function confidentDefinition(locate: unknown): Definition | null {
  if (!isRecord(locate)) return null;
  const record = locate as LocateRecord;
  if (record.error || record.code) return null;
  const target = record.resolvedTarget;
  if (!target?.name) return null;
  const confidence = record.confidence ?? target.confidence ?? 1;
  if (confidence < MIN_LOCATE_CONFIDENCE) return null;
  return { name: target.name, kind: target.kind, path: target.path };
}

/** "No answer" from `ix callers` is null, so the summary leaves callers out. */
function callerList(callers: unknown): string | null {
  if (!isRecord(callers)) return null;
  const record = callers as CallersRecord;
  if (record.error || record.code || !Array.isArray(record.results)) return null;
  const total = Math.max(record.summary?.total ?? 0, record.results.length);
  if (total === 0) return "no callers in the graph";
  const shown = record.results
    .slice(0, MAX_CALLERS_SHOWN)
    .map((c) => `${c.name ?? "?"}${c.path ? ` (${c.path})` : ""}`);
  const more = total > shown.length ? ` (+${total - shown.length} more)` : "";
  return `${total} caller${total === 1 ? "" : "s"}: ${shown.join(", ")}${more}`;
}

/** One line: what `pattern` resolved to, where it is defined, and who calls it. */
export function summarizeDefinition(pattern: string, definition: Definition, callers: unknown): string {
  const renamed = definition.name === pattern ? "" : `${definition.name}, `;
  const kind = definition.kind ? `${definition.kind} ` : "";
  const where = definition.path ? ` in ${definition.path}` : "";
  const head = `[ix] '${pattern}': ${renamed}${kind}defined${where}`;
  const callerText = callerList(callers);
  return callerText ? `${head}; ${callerText}` : head;
}
