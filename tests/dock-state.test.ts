import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dockStatePath, readDockEnabled, readDockTheme, readDockThemeApplied, writeDockEnabled } from "../lib/dock-state.ts";

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
