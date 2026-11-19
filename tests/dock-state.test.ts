import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dockStatePath, readDockEnabled, readDockLook, readDockTheme, readDockThemeApplied, writeDockEnabled, writeDockLook } from "../lib/dock-state.ts";
import { DEFAULT_LOOK, DEFAULT_SECTIONS } from "../lib/look.ts";

test("S95 the state file lives under Pi's agent dir: PI_CODING_AGENT_DIR, else ~/.pi/agent", () => {
	assert.equal(dockStatePath({ PI_CODING_AGENT_DIR: join("x", "agent") }, "home"), join("x", "agent", "fisi-dock", "state.json"));
	assert.equal(dockStatePath({}, "home"), join("home", ".pi", "agent", "fisi-dock", "state.json"));
	assert.equal(dockStatePath({ PI_CODING_AGENT_DIR: "" }, "home"), join("home", ".pi", "agent", "fisi-dock", "state.json"));
});

test("S95 a missing, unreadable or malformed state file means on; only `enabled: false` means off", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "state.json");
	assert.equal(readDockEnabled(path), true, "missing");
	for (const [content, enabled] of [["not json", true], ["null", true], ["[]", true], ['{"enabled":"no"}', true], ['{"enabled":true}', true], ['{"enabled":false}', false]] as const) {
		writeFileSync(path, content);
		assert.equal(readDockEnabled(path), enabled, content);
	}
	mkdirSync(join(dir, "folder.json"));
	assert.equal(readDockEnabled(join(dir, "folder.json")), true, "unreadable (a folder)");
});

test("S95 writing creates the folder and saves { enabled }; a failed write says false", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "agent", "fisi-dock", "state.json");
	assert.equal(writeDockEnabled(path, false), true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: false });
	assert.equal(readDockEnabled(path), false);
	assert.equal(writeDockEnabled(path, true), true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true });
	writeFileSync(join(dir, "file"), "");
	assert.equal(writeDockEnabled(join(dir, "file", "state.json"), false), false, "a file where the folder should be");
});

test("S7 the state file also keeps the theme to restore at off; a missing, empty or non-string theme is none", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "agent", "fisi-dock", "state.json");
	assert.equal(readDockTheme(path), undefined, "missing file");
	assert.equal(writeDockEnabled(path, true, "dark"), true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true, theme: "dark" });
	assert.equal(readDockTheme(path), "dark");
	assert.equal(readDockEnabled(path), true);
	assert.equal(writeDockEnabled(path, false, "dark"), true);
	assert.equal(readDockEnabled(path), false, "the theme does not change what enabled means");
	for (const content of ["not json", "null", '{"enabled":false}', '{"theme":""}', '{"theme":3}', '{"theme":["dark"]}']) {
		writeFileSync(path, content);
		assert.equal(readDockTheme(path), undefined, content);
	}
	assert.equal(writeDockEnabled(path, false), true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: false }, "no theme, no key");
});

test("T9 the state file says whether the first-start theme step is done: only `themeApplied: true`; it is written only when true", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "agent", "fisi-dock", "state.json");
	assert.equal(readDockThemeApplied(path), false, "missing file");
	assert.equal(writeDockEnabled(path, true, "dark", true), true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true, theme: "dark", themeApplied: true });
	assert.equal(readDockThemeApplied(path), true);
	assert.equal(readDockTheme(path), "dark");
	assert.equal(readDockEnabled(path), true);
	assert.equal(writeDockEnabled(path, false, undefined, true), true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: false, themeApplied: true }, "no theme, no key");
	assert.equal(readDockEnabled(path), false, "the step does not change what enabled means");
	assert.equal(writeDockEnabled(path, true, "dark", false), true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true, theme: "dark" }, "not done, no key");
	for (const content of ["not json", "null", "[]", '{"enabled":true}', '{"themeApplied":"yes"}', '{"themeApplied":1}', '{"themeApplied":false}']) {
		writeFileSync(path, content);
		assert.equal(readDockThemeApplied(path), false, content);
	}
	writeFileSync(path, '{"themeApplied":true}');
	assert.equal(readDockThemeApplied(path), true);
});

test("S6 a missing, unreadable or malformed state file, or a bad look in it, reads as the default look", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "state.json");
	assert.deepEqual(readDockLook(path), DEFAULT_LOOK, "missing");
	for (const content of ["not json", "null", "[]", '{"enabled":false}', '{"look":"soft"}', '{"look":null}', '{"look":["text"]}']) {
		writeFileSync(path, content);
		assert.deepEqual(readDockLook(path), DEFAULT_LOOK, content);
	}
	writeFileSync(path, '{"look":{"frames":"none","colors":"loud"}}');
	assert.deepEqual(readDockLook(path), { ...DEFAULT_LOOK, frames: "none" }, "per-field fallback");
	mkdirSync(join(dir, "folder.json"));
	assert.deepEqual(readDockLook(join(dir, "folder.json")), DEFAULT_LOOK, "unreadable (a folder)");
});

test("S5 writing the look creates the folder, saves it under `look` and reads back; a failed write says false", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "agent", "fisi-dock", "state.json");
	const look = { logo: "text", frames: "classic", colors: "soft", accent: "pink", divider: "medium", motion: "on", sections: DEFAULT_SECTIONS } as const;
	assert.equal(writeDockLook(path, look), true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { look });
	assert.deepEqual(readDockLook(path), look);
	assert.equal(readDockEnabled(path), true, "the look does not change what enabled means");
	writeFileSync(path, "not json");
	assert.equal(writeDockLook(path, look), true, "a corrupt file is replaced");
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { look });
	writeFileSync(join(dir, "file"), "");
	assert.equal(writeDockLook(join(dir, "file", "state.json"), look), false, "a file where the folder should be");
});

test("S5 /fisi-dock on|off and the theme memory keep the look", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "state.json");
	const look = { logo: "none", frames: "none", colors: "soft", accent: "pink", divider: "medium", motion: "on", sections: DEFAULT_SECTIONS } as const;
	assert.equal(writeDockLook(path, look), true);
	assert.equal(writeDockEnabled(path, false), true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { look, enabled: false });
	assert.equal(writeDockEnabled(path, true, "dark", true), true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { look, enabled: true, theme: "dark", themeApplied: true });
	assert.deepEqual(readDockLook(path), look);
	assert.equal(writeDockEnabled(path, true), true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { look, enabled: true }, "dropping the theme keeps the look");
});

test("S5 writing the look keeps enabled, the theme and themeApplied", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "state.json");
	assert.equal(writeDockEnabled(path, false, "dark", true), true);
	assert.equal(writeDockLook(path, { ...DEFAULT_LOOK, logo: "text", colors: "soft" }), true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: false, theme: "dark", themeApplied: true, look: { ...DEFAULT_LOOK, logo: "text", colors: "soft" } });
	assert.equal(readDockEnabled(path), false);
	assert.equal(readDockTheme(path), "dark");
	assert.equal(readDockThemeApplied(path), true);
	assert.equal(writeDockLook(path, DEFAULT_LOOK), true);
	assert.deepEqual(readDockLook(path), DEFAULT_LOOK);
	assert.equal(readDockTheme(path), "dark");
});

test("S5 writeDockEnabled over a corrupt or non-object file still saves only its own fields", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "state.json");
	for (const content of ["not json", "null", "[1]", '"look"']) {
		writeFileSync(path, content);
		assert.equal(writeDockEnabled(path, false, "dark"), true, content);
		assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: false, theme: "dark" }, content);
	}
});

test("look-more S1 S2 the divider and motion are saved with the look and read back; a look saved before them reads them as the default", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "state.json");
	for (const divider of ["off", "subtle", "medium", "strong"] as const) {
		for (const motion of ["on", "off"] as const) {
			const look = { ...DEFAULT_LOOK, divider, motion };
			assert.equal(writeDockLook(path, look), true);
			assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).look, look, `${divider} ${motion} saved`);
			assert.deepEqual(readDockLook(path), look, `${divider} ${motion} read back`);
		}
	}
	writeFileSync(path, '{"enabled":true,"look":{"logo":"text","frames":"none","colors":"soft"}}');
	assert.deepEqual(readDockLook(path), { logo: "text", frames: "none", colors: "soft", accent: "pink", divider: "medium", motion: "on", sections: DEFAULT_SECTIONS }, "an old state.json without them");
	writeFileSync(path, '{"look":{"divider":"loud","motion":"slow"}}');
	assert.deepEqual(readDockLook(path), DEFAULT_LOOK, "bad values fall back");
	assert.equal(writeDockEnabled(path, false), true);
	assert.equal(writeDockLook(path, { ...DEFAULT_LOOK, divider: "strong", motion: "off" }), true);
	assert.equal(writeDockEnabled(path, true, "dark", true), true);
	assert.deepEqual(readDockLook(path), { ...DEFAULT_LOOK, divider: "strong", motion: "off" }, "on|off keep them");
});

test("look-more S6 the sections' order and the hidden ones are saved with the look and read back; on|off keep them; an old state.json reads today's", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "state.json");
	const sections = [{ id: "todo", shown: true }, { id: "odd", shown: true }, { id: "heads-up", shown: false }, { id: "rdd", shown: false }, { id: "ci", shown: true }, { id: "agents", shown: true }, { id: "sessions", shown: true }, { id: "changes", shown: false }] as const;
	const look = { ...DEFAULT_LOOK, sections: sections.map((section) => ({ ...section })) };
	assert.equal(writeDockEnabled(path, true, "dark", true), true);
	assert.equal(writeDockLook(path, look), true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true, theme: "dark", themeApplied: true, look }, "saved under look, the rest kept");
	assert.deepEqual(readDockLook(path), look);
	assert.equal(writeDockEnabled(path, false), true);
	assert.deepEqual(readDockLook(path).sections, look.sections, "off keeps them");
	writeFileSync(path, '{"look":{"sections":[{"id":"ci","shown":false},{"id":"nope","shown":true},{"id":"ci","shown":true}]}}');
	assert.deepEqual(readDockLook(path).sections.map((section) => `${section.shown ? "" : "!"}${section.id}`), ["!ci", "heads-up", "odd", "rdd", "agents", "sessions", "todo", "changes"], "normalized on read");
	// A look saved before sessions existed: it comes right after agents, in the saved order of the rest.
	const old = ["todo", "odd", "heads-up", "rdd", "ci", "agents", "changes"].map((id) => ({ id, shown: id !== "heads-up" }));
	writeFileSync(path, JSON.stringify({ look: { sections: old } }));
	assert.deepEqual(readDockLook(path).sections.map((section) => `${section.shown ? "" : "!"}${section.id}`), ["todo", "odd", "!heads-up", "rdd", "ci", "agents", "sessions", "changes"], "sessions after agents, the rest as saved");
	writeFileSync(path, '{"enabled":true,"look":{"logo":"text"}}');
	assert.deepEqual(readDockLook(path), { ...DEFAULT_LOOK, logo: "text" }, "an old state.json without sections");
	assert.deepEqual(readDockLook(path).sections, DEFAULT_SECTIONS);
});

test("coderabbit S5 the state file is replaced whole: no temporary file stays, and a failed replace keeps what was there", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "state.json");
	assert.equal(writeDockEnabled(path, false, "dark"), true);
	assert.equal(writeDockLook(path, DEFAULT_LOOK), true);
	assert.deepEqual(readdirSync(dir), ["state.json"], "only the state file after successful writes");
	assert.equal(readDockEnabled(path), false);
	assert.equal(readDockTheme(path), "dark");

	// A folder where the state file should be cannot be replaced by a file.
	const blocked = join(dir, "blocked.json");
	mkdirSync(blocked);
	writeFileSync(join(blocked, "keep"), "kept");
	assert.equal(writeDockEnabled(blocked, true), false);
	assert.equal(readFileSync(join(blocked, "keep"), "utf8"), "kept");
	assert.deepEqual(readdirSync(dir).toSorted(), ["blocked.json", "state.json"], "the temporary file is removed after a failed replace");
});

test("review R4 a leftover temporary file from the same process and millisecond neither fails the save nor is removed", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "state.json");
	const at = 1_700_000_000_000;
	t.mock.method(Date, "now", () => at);
	const stray = `${path}.${process.pid}.${at.toString(36)}.tmp`;
	writeFileSync(stray, "another write");
	assert.equal(writeDockEnabled(path, false, "dark"), true, "the save goes through");
	assert.equal(readDockTheme(path), "dark");
	assert.equal(readFileSync(stray, "utf8"), "another write", "a file this write did not make stays");
	assert.deepEqual(readdirSync(dir).toSorted(), [stray.slice(dir.length + 1), "state.json"].toSorted());
});

test("review R1 a symlinked state file keeps its link: the target is replaced, with its mode", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const target = join(dir, "dotfiles-state.json");
	const path = join(dir, "state.json");
	writeFileSync(target, JSON.stringify({ enabled: true, extra: 1 }));
	try {
		symlinkSync(target, path, "file");
	} catch {
		return t.skip("symlinks cannot be made here");
	}
	if (process.platform !== "win32") chmodSync(target, 0o600);
	assert.equal(writeDockEnabled(path, false, "dark"), true);
	assert.equal(lstatSync(path).isSymbolicLink(), true, "the link stays a link");
	assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { enabled: false, extra: 1, theme: "dark" }, "the linked file holds the save");
	if (process.platform !== "win32") assert.equal(statSync(target).mode & 0o777, 0o600, "the target's mode is kept");
	assert.deepEqual(readdirSync(dir).toSorted(), ["dotfiles-state.json", "state.json"], "no temporary file stays");
});

test("coderabbit PR6 a state file linking to a missing file keeps its link: the save lands at the link's target", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const target = join(dir, "dotfiles-state.json");
	const path = join(dir, "state.json");
	try {
		symlinkSync(target, path, "file");
	} catch {
		return t.skip("symlinks cannot be made here");
	}
	assert.equal(writeDockEnabled(path, false, "dark"), true);
	assert.equal(lstatSync(path).isSymbolicLink(), true, "the link stays a link");
	assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { enabled: false, theme: "dark" });
	assert.equal(readDockTheme(path), "dark", "read back through the link");
});

test("coderabbit PR6 a relative link to a missing file in a linked folder resolves from the real folder, not the alias", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const real = join(dir, "real", "dock");
	mkdirSync(real, { recursive: true });
	const alias = join(dir, "alias");
	const unrelated = join(dir, "saved.json");
	writeFileSync(unrelated, "unrelated");
	try {
		symlinkSync(real, alias, "dir");
		symlinkSync(join("..", "saved.json"), join(real, "state.json"), "file");
	} catch {
		return t.skip("symlinks cannot be made here");
	}
	const path = join(alias, "state.json");
	assert.equal(writeDockEnabled(path, false, "dark"), true);
	assert.equal(lstatSync(join(real, "state.json")).isSymbolicLink(), true, "the link stays a link");
	assert.deepEqual(JSON.parse(readFileSync(join(dir, "real", "saved.json"), "utf8")), { enabled: false, theme: "dark" }, "saved at the link's real destination");
	assert.equal(readFileSync(unrelated, "utf8"), "unrelated", "the file at the alias-relative path is untouched");
	assert.equal(readDockTheme(path), "dark");
});

test("coderabbit PR6 S37 a chain of links to a missing file is followed to its end: every link stays, the save lands at the last target", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const target = join(dir, "dotfiles-state.json");
	const link2 = join(dir, "link2.json");
	const path = join(dir, "state.json");
	try {
		symlinkSync(target, link2, "file");
		symlinkSync(link2, path, "file");
	} catch {
		return t.skip("symlinks cannot be made here");
	}
	assert.equal(writeDockEnabled(path, false, "dark"), true);
	assert.equal(lstatSync(path).isSymbolicLink(), true, "the first link stays a link");
	assert.equal(lstatSync(link2).isSymbolicLink(), true, "the second link stays a link");
	assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { enabled: false, theme: "dark" }, "saved at the end of the chain");
	assert.equal(readDockTheme(path), "dark", "read back through both links");
	assert.deepEqual(readdirSync(dir).toSorted(), ["dotfiles-state.json", "link2.json", "state.json"], "no temporary file stays");
});

test("coderabbit PR6 S37 each relative link in a chain counts from the real folder of the link that holds it", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const real = join(dir, "real", "dock");
	const second = join(dir, "real", "second");
	mkdirSync(real, { recursive: true });
	mkdirSync(second, { recursive: true });
	const alias = join(dir, "alias");
	const unrelated = join(dir, "final.json");
	writeFileSync(unrelated, "unrelated");
	try {
		symlinkSync(real, alias, "dir");
		// real/dock/state.json -> ../second/hop.json, and real/second/hop.json -> ../final.json (real/final.json).
		symlinkSync(join("..", "second", "hop.json"), join(real, "state.json"), "file");
		symlinkSync(join("..", "final.json"), join(second, "hop.json"), "file");
	} catch {
		return t.skip("symlinks cannot be made here");
	}
	const path = join(alias, "state.json");
	assert.equal(writeDockEnabled(path, false, "dark"), true);
	assert.equal(lstatSync(join(real, "state.json")).isSymbolicLink(), true, "the first link stays a link");
	assert.equal(lstatSync(join(second, "hop.json")).isSymbolicLink(), true, "the second link stays a link");
	assert.deepEqual(JSON.parse(readFileSync(join(dir, "real", "final.json"), "utf8")), { enabled: false, theme: "dark" }, "saved where the second link points");
	assert.equal(readFileSync(unrelated, "utf8"), "unrelated", "the file one folder up from the alias is untouched");
	assert.equal(readDockTheme(path), "dark");
});

test("coderabbit PR6 S37 a chain of links that loops fails the save and replaces nothing", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "state.json");
	const other = join(dir, "other.json");
	try {
		symlinkSync(other, path, "file");
		symlinkSync(path, other, "file");
	} catch {
		return t.skip("symlinks cannot be made here");
	}
	assert.equal(writeDockEnabled(path, false, "dark"), false, "a loop of two links");
	assert.equal(writeDockLook(path, DEFAULT_LOOK), false, "the look is refused too");
	assert.equal(lstatSync(path).isSymbolicLink(), true, "the link is still a link, not replaced by a file");
	assert.equal(lstatSync(other).isSymbolicLink(), true, "the other link is still a link");
	assert.deepEqual(readdirSync(dir).toSorted(), ["other.json", "state.json"], "no file was made");
	assert.equal(readDockEnabled(path), true, "reads as the default");
	const self = join(dir, "self.json");
	try {
		symlinkSync(self, self, "file");
	} catch {
		return t.skip("symlinks cannot be made here");
	}
	assert.equal(writeDockEnabled(self, false), false, "a link to itself");
	assert.equal(lstatSync(self).isSymbolicLink(), true, "it is still a link");
});

test("coderabbit PR6 S37 a chain longer than the depth cap fails the save and replaces nothing", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const names = Array.from({ length: 30 }, (_, index) => join(dir, `link${index}.json`));
	try {
		for (const [index, name] of names.entries()) symlinkSync(index === names.length - 1 ? join(dir, "end.json") : names[index + 1], name, "file");
	} catch {
		return t.skip("symlinks cannot be made here");
	}
	assert.equal(writeDockEnabled(names[0], false), false);
	assert.deepEqual(readdirSync(dir).toSorted(), names.map((name) => name.slice(dir.length + 1)).toSorted(), "no file was made, no link replaced");
	assert.equal(lstatSync(names[0]).isSymbolicLink(), true);
});

test("coderabbit PR6 S38 a foreign file at the temporary name makes the save fail and is left alone", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "state.json");
	assert.equal(writeDockEnabled(path, true, "dark"), true);
	const before = readFileSync(path, "utf8");
	// The temporary name is `<path>.<pid>.<ms>.<counter>.tmp`. With the clock fixed, every name this write
	// can pick (the counter only grows with each write in this process) is taken by a foreign file, so
	// the exclusive create fails whichever counter it reaches.
	const at = 1_700_000_000_000;
	t.mock.method(Date, "now", () => at);
	const strays: string[] = [];
	for (let counter = 1; counter <= 400; counter++) {
		const stray = `${path}.${process.pid}.${at.toString(36)}.${counter.toString(36)}.tmp`;
		writeFileSync(stray, `foreign ${counter}`);
		strays.push(stray);
	}
	assert.equal(writeDockEnabled(path, false), false, "the exclusive create failed, so the save says false");
	assert.equal(readFileSync(path, "utf8"), before, "the previous file is whole");
	for (const [index, stray] of strays.entries()) assert.equal(readFileSync(stray, "utf8"), `foreign ${index + 1}`, `a foreign file stays: ${stray}`);
	assert.equal(readdirSync(dir).length, strays.length + 1, "nothing else appeared");
});
