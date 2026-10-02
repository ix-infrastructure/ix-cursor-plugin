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
