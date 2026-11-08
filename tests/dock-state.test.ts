import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dockStatePath, readDockEnabled, readDockLook, readDockTheme, readDockThemeApplied, writeDockEnabled, writeDockLook } from "../lib/dock-state.ts";
import { DEFAULT_LOOK } from "../lib/look.ts";

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
	assert.deepEqual(readDockLook(path), { logo: "braille", frames: "none", colors: "vivid" }, "per-field fallback");
	mkdirSync(join(dir, "folder.json"));
	assert.deepEqual(readDockLook(join(dir, "folder.json")), DEFAULT_LOOK, "unreadable (a folder)");
});

test("S5 writing the look creates the folder, saves it under `look` and reads back; a failed write says false", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-state-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "agent", "fisi-dock", "state.json");
	const look = { logo: "text", frames: "classic", colors: "soft" } as const;
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
	const look = { logo: "none", frames: "none", colors: "soft" } as const;
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
	assert.equal(writeDockLook(path, { logo: "text", frames: "faded", colors: "soft" }), true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: false, theme: "dark", themeApplied: true, look: { logo: "text", frames: "faded", colors: "soft" } });
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
