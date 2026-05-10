import type { SkillRetrieveHit } from "./types.js";

export function formatProceduralMemoryInjection(hits: SkillRetrieveHit[]): string {
  if (hits.length === 0) return "";
  const lines: string[] = [];
  lines.push("[TokenPilot Procedural Memory]");
  lines.push("Use only if relevant to the current objective. Prefer procedure and pitfalls over replaying archived details.");
  for (const hit of hits) {
    lines.push("");
    lines.push(`Skill: ${hit.skill.title}`);
    lines.push(`When useful: ${hit.skill.whenToUse.join(" | ")}`);
    lines.push(`Guidance: ${hit.skill.guidance}`);
    if (hit.skill.steps.length > 0) lines.push(`Steps: ${hit.skill.steps.join(" | ")}`);
    if (hit.skill.pitfalls.length > 0) lines.push(`Pitfalls: ${hit.skill.pitfalls.join(" | ")}`);
    if (hit.skill.constraints.length > 0) lines.push(`Constraints: ${hit.skill.constraints.join(" | ")}`);
  }
  return lines.join("\n").trim();
}
