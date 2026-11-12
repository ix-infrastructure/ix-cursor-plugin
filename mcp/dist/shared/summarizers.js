// Copyright 2026 Ix Infrastructure Inc.
export function summarizeRisk(result) {
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
            return (`[ix] CRITICAL EDIT — make a change plan before editing further. ` +
                `${target} has ${dependents} dependents.${riskSummary}${hotspotText}${nextStep}`);
        case "high":
            return (`[ix] HIGH-RISK EDIT — ${target} has ${dependents} dependents.` +
                `${riskSummary}${hotspotText}${nextStep}`);
        case "medium":
            return (`[ix] NOTE — editing ${target} may affect ${dependents} dependents.` +
                `${riskSummary}${nextStep}`);
        default:
            return "";
    }
}
// Below this, locate's answer is a guess, not a definition to point the agent at.
const MIN_LOCATE_CONFIDENCE = 0.6;
const MAX_CALLERS_SHOWN = 5;
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
 * The single definition `ix locate` resolved with confidence, or null. A
 * refusal record (ambiguous target, not found, workspace not mapped — reported
 * under `error`, or `code` for ambiguity) has no single definition.
 */
export function confidentDefinition(locate) {
    if (!isRecord(locate))
        return null;
    const record = locate;
    if (record.error || record.code)
        return null;
    const target = record.resolvedTarget;
    if (!target?.name)
        return null;
    const confidence = record.confidence ?? target.confidence ?? 1;
    if (confidence < MIN_LOCATE_CONFIDENCE)
        return null;
    return { name: target.name, kind: target.kind, path: target.path };
}
/** "No answer" from `ix callers` is null, so the summary leaves callers out. */
function callerList(callers) {
    if (!isRecord(callers))
        return null;
    const record = callers;
    if (record.error || record.code || !Array.isArray(record.results))
        return null;
    const total = Math.max(record.summary?.total ?? 0, record.results.length);
    if (total === 0)
        return "no callers in the graph";
    const shown = record.results
        .slice(0, MAX_CALLERS_SHOWN)
        .map((c) => `${c.name ?? "?"}${c.path ? ` (${c.path})` : ""}`);
    const more = total > shown.length ? ` (+${total - shown.length} more)` : "";
    return `${total} caller${total === 1 ? "" : "s"}: ${shown.join(", ")}${more}`;
}
/** One line: what `pattern` resolved to, where it is defined, and who calls it. */
export function summarizeDefinition(pattern, definition, callers) {
    const renamed = definition.name === pattern ? "" : `${definition.name}, `;
    const kind = definition.kind ? `${definition.kind} ` : "";
    const where = definition.path ? ` in ${definition.path}` : "";
    const head = `[ix] '${pattern}': ${renamed}${kind}defined${where}`;
    const callerText = callerList(callers);
    return callerText ? `${head}; ${callerText}` : head;
}
//# sourceMappingURL=summarizers.js.map