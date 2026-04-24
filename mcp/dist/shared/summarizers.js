function buildSummary(notes) {
    if (notes.length === 0) {
        return "";
    }
    const [first, ...rest] = notes;
    if (rest.length === 0) {
        return `Ix ${first}`;
    }
    return `Ix ${first} It also ${rest.join(" It also ")}`;
}
function fallbackSummary(events) {
    const searchEvents = events.filter((event) => event.ctx_chars > 0 && ["Grep", "Glob", "Bash"].includes(event.tool));
    const editEvents = events.filter((event) => event.ctx_chars > 0 && ["Edit", "Write", "MultiEdit"].includes(event.tool));
    const briefingEvents = events.filter((event) => event.ctx_chars > 0 && event.tool === "Briefing");
    const riskEvent = events.find((event) => event.ctx_chars > 0 && event.risk);
    if (riskEvent?.risk) {
        return `Ix warned about ${riskEvent.risk}-risk edit impact before modification.`;
    }
    if (searchEvents.length > 0) {
        return "Ix surfaced a relevant symbol before search.";
    }
    if (editEvents.length > 0) {
        return "Ix flagged edit blast radius before modification.";
    }
    if (briefingEvents.length > 0) {
        return "Ix injected session context.";
    }
    return "";
}
export function summarizeTurn(events) {
    const activeEvents = events.filter((event) => event.ctx_chars > 0);
    if (activeEvents.length < 2) {
        return "";
    }
    const notes = [...new Set(activeEvents
            .map((event) => event.note)
            .filter((note) => typeof note === "string" && note.length > 0)
            .slice(0, 3))];
    return buildSummary(notes) || fallbackSummary(activeEvents);
}
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
            return (`[ix] CRITICAL EDIT — generate a change plan before editing. ` +
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
//# sourceMappingURL=summarizers.js.map