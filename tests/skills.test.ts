import assert from "node:assert/strict";
import test from "node:test";
import { skillsFromCommands } from "../lib/skills.ts";

// Pi's pi.getCommands() entries (SlashCommandInfo): skills are source "skill", named `skill:<name>` (S4).
const command = (name: string, source: string, sourceInfo: Record<string, unknown> = { path: "/x", source: "local", scope: "user", origin: "top-level" }, description?: string) => ({
	name,
	source,
	sourceInfo,
	...(description !== undefined ? { description } : {}),
});

test("skills are the getCommands entries with source skill, in Pi's order, without the skill: prefix, with their descriptions (S4)", () => {
	const skills = skillsFromCommands([
		command("dock", "extension"),
		command("skill:gentle-design", "skill", { path: "/p", source: "npm:gentle-pi", scope: "user", origin: "package" }, "Design a screen as HTML artboards."),
		command("review", "prompt"),
		command("skill:go-testing", "skill", { path: "/u", source: "local", scope: "user", origin: "top-level" }, "Go tests."),
	]);
	assert.deepEqual(skills, [
		{ name: "gentle-design", scope: "package", description: "Design a screen as HTML artboards." },
		{ name: "go-testing", scope: "user", description: "Go tests." },
	]);
});

test("scope: package for origin package whatever its scope, project for scope project, user for user, temporary or anything else (S4)", () => {
	const scopeOf = (sourceInfo: Record<string, unknown> | undefined) => skillsFromCommands([{ name: "skill:a", source: "skill", sourceInfo }])?.[0]?.scope;
	assert.equal(scopeOf({ scope: "project", origin: "package" }), "package");
	assert.equal(scopeOf({ scope: "user", origin: "package" }), "package");
	assert.equal(scopeOf({ scope: "project", origin: "top-level" }), "project");
	assert.equal(scopeOf({ scope: "user", origin: "top-level" }), "user");
	assert.equal(scopeOf({ scope: "temporary", origin: "top-level" }), "user");
	assert.equal(scopeOf({}), "user");
	assert.equal(scopeOf(undefined), "user");
});

test("an unreadable command list (no getCommands, not an array): undefined, so no row; an empty one: [] (S1)", () => {
	assert.equal(skillsFromCommands(undefined), undefined);
	assert.equal(skillsFromCommands("nope"), undefined);
	assert.equal(skillsFromCommands({ length: 1 }), undefined);
	assert.deepEqual(skillsFromCommands([]), []);
	assert.deepEqual(skillsFromCommands([command("dock", "extension"), command("review", "prompt")]), []);
});

test("odd entries are tolerated: non-objects, missing or non-string names are left out; a name without the prefix stays; a non-string description is dropped", () => {
	const skills = skillsFromCommands([null, 3, "skill:x", { source: "skill" }, { name: 7, source: "skill" }, { name: "skill:", source: "skill" }, { name: "plain", source: "skill", description: 5 }, { name: "skill:ok", source: "skill", sourceInfo: "bad" }]);
	assert.deepEqual(skills, [
		{ name: "plain", scope: "user" },
		{ name: "ok", scope: "user" },
	]);
});

test("a description is one line for the panel: newlines, tabs and control characters become one space; a blank one is dropped", () => {
	const skills = skillsFromCommands([
		{ name: "skill:a", source: "skill", description: "  Design a screen.\n\tThen \x1b[31mship\x07 it.  " },
		{ name: "skill:b", source: "skill", description: " \n " },
	]);
	assert.deepEqual(skills, [
		{ name: "a", scope: "user", description: "Design a screen. Then [31mship it." },
		{ name: "b", scope: "user" },
	]);
});
