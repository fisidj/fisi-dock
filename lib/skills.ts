import type { SkillInfo, SkillScope } from "./panel-model.ts";

// The skills Pi loaded (skills-view S4): the entries of pi.getCommands() with
// source "skill", named `skill:<name>`. Not Gentle Shell's registry notice
// ("Skill registry refreshed (29 skills)"), which counts its own merged registry.

const PREFIX = "skill:";

/** The order the panel groups and counts the scopes in (S1, S2). */
export const SKILL_SCOPES: readonly SkillScope[] = ["package", "user", "project"];

const record = (value: unknown): Record<string, unknown> | undefined => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined);

/** `package` when it came with a Pi package (origin package), else `project` for scope project, else `user` (temporary included). */
function scopeOf(sourceInfo: unknown): SkillScope {
	const info = record(sourceInfo);
	if (info?.origin === "package") return "package";
	return info?.scope === "project" ? "project" : "user";
}

/** One line for the panel: control characters (newlines and escapes included) and runs of white space become one space; blank is none. */
function oneLine(text: unknown): string | undefined {
	if (typeof text !== "string") return undefined;
	const line = text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
	return line || undefined;
}

/**
 * The loaded skills in Pi's order from `commands` (pi.getCommands()); undefined
 * when it is not a list (no getCommands: no row). Entries without a usable name
 * are left out; a missing or odd sourceInfo counts as user.
 */
export function skillsFromCommands(commands: unknown): SkillInfo[] | undefined {
	if (!Array.isArray(commands)) return undefined;
	const skills: SkillInfo[] = [];
	for (const entry of commands) {
		const command = record(entry);
		if (command?.source !== "skill" || typeof command.name !== "string") continue;
		const name = command.name.startsWith(PREFIX) ? command.name.slice(PREFIX.length) : command.name;
		if (!name) continue;
		const description = oneLine(command.description);
		skills.push({ name, scope: scopeOf(command.sourceInfo), ...(description !== undefined ? { description } : {}) });
	}
	return skills;
}
