import assert from "node:assert/strict";
import test from "node:test";
import { createLiveStore } from "../lib/live-store.ts";
import { DEFAULT_LOOK, type Look } from "../lib/look.ts";
import { renderRail } from "../lib/panel.ts";
import { reduceSettings, renderSettings, SETTINGS_HINT, SETTINGS_ROWS, settingsAction, type SettingsState } from "../lib/settings-menu.ts";
import { visibleWidth } from "../lib/text.ts";

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const start = (look: Look = { ...DEFAULT_LOOK }): SettingsState => ({ row: 0, look });
const model = () => createLiveStore("my-app", () => 0).model();

test("S1 the rows are logo, frames, colors, accent, divider and motion, in that order (look-more S1, S2, S4)", () => {
	assert.deepEqual(SETTINGS_ROWS, ["logo", "frames", "colors", "accent", "divider", "motion"]);
	assert.equal(SETTINGS_HINT, "↑↓ choose · ←→ change · Esc close");
});

test("S1 settingsAction maps the arrows, vim keys, Enter, Esc and q; anything else is no action", () => {
	const cases: [string, string | undefined][] = [
		["\x1b[A", "up"], ["\x1bOA", "up"], ["k", "up"],
		["\x1b[B", "down"], ["\x1bOB", "down"], ["j", "down"],
		["\x1b[D", "prev"], ["\x1bOD", "prev"], ["h", "prev"],
		["\x1b[C", "next"], ["\x1bOC", "next"], ["l", "next"],
		["\r", "enter"], ["\n", "enter"],
		["\x1b", "close"], ["q", "close"],
		["x", undefined], ["", undefined], ["K", undefined],
	];
	for (const [data, action] of cases) assert.equal(settingsAction(data), action, JSON.stringify(data));
});

test("S1 up and down move between the rows and wrap; the look stays", () => {
	let step = reduceSettings(start(), "down");
	assert.equal(step.state.row, 1);
	assert.equal(step.changed, false);
	assert.equal(step.close, false);
	step = reduceSettings(step.state, "down");
	assert.equal(step.state.row, 2);
	step = reduceSettings(step.state, "down");
	assert.equal(step.state.row, 3, "accent");
	step = reduceSettings(step.state, "down");
	assert.equal(step.state.row, 4, "divider");
	step = reduceSettings(step.state, "down");
	assert.equal(step.state.row, 5, "motion");
	step = reduceSettings(step.state, "down");
	assert.equal(step.state.row, 0, "past motion wraps to logo");
	step = reduceSettings(step.state, "up");
	assert.equal(step.state.row, 5, "above logo wraps to motion");
	assert.deepEqual(step.state.look, DEFAULT_LOOK);
});

test("S1 right and left cycle the row's options and wrap; Enter cycles forward; each says the look changed", () => {
	const state = start();
	let step = reduceSettings(state, "next");
	assert.deepEqual(step.state.look, { ...DEFAULT_LOOK, logo: "text" });
	assert.equal(step.changed, true);
	assert.deepEqual(state.look, DEFAULT_LOOK, "the old state is left as it was");
	step = reduceSettings(step.state, "next");
	assert.equal(step.state.look.logo, "none");
	step = reduceSettings(step.state, "next");
	assert.equal(step.state.look.logo, "braille", "past none wraps to braille");
	step = reduceSettings(step.state, "prev");
	assert.equal(step.state.look.logo, "none", "before braille wraps to none");

	const frames = reduceSettings({ row: 1, look: { ...DEFAULT_LOOK } }, "next");
	assert.deepEqual(frames.state.look, { ...DEFAULT_LOOK, frames: "classic" });
	assert.equal(reduceSettings({ row: 1, look: { ...DEFAULT_LOOK } }, "prev").state.look.frames, "none");

	const colors = reduceSettings({ row: 2, look: { ...DEFAULT_LOOK } }, "enter");
	assert.deepEqual(colors.state.look, { ...DEFAULT_LOOK, colors: "soft" });
	assert.equal(colors.changed, true);
	assert.equal(reduceSettings(colors.state, "enter").state.look.colors, "vivid", "two colors: Enter toggles back");
	assert.equal(reduceSettings(colors.state, "next").state.row, 2, "changing keeps the row");
});

test("S1 close closes without changing anything", () => {
	const state = { row: 1, look: { logo: "text", frames: "none", colors: "soft", accent: "amber", divider: "strong", motion: "off" } as Look };
	const step = reduceSettings(state, "close");
	assert.equal(step.close, true);
	assert.equal(step.changed, false);
	assert.deepEqual(step.state, state);
});

test("S1 render: a title, the three rows with ‹ value ›, the marker on the selected row and the hint on the last row", () => {
	const lines = renderSettings({ row: 1, look: { logo: "text", frames: "classic", colors: "soft", accent: "teal", divider: "subtle", motion: "off" } }, 60, 10).map(plain);
	assert.equal(lines.length, 10);
	assert.match(lines[0], /^ Fisi Dock look/);
	const rows = lines.filter((line) => /‹ .* ›/.test(line));
	assert.equal(rows.length, 6);
	assert.match(rows[0], /^ {3}logo +‹ text › *$/);
	assert.match(rows[1], /^ › frames +‹ classic › *$/);
	assert.match(rows[2], /^ {3}colors +‹ soft › *$/);
	assert.match(rows[3], /^ {3}accent +‹ teal › *$/);
	assert.match(rows[4], /^ {3}divider +‹ subtle › *$/);
	assert.match(rows[5], /^ {3}motion +‹ off › *$/);
	assert.match(lines.at(-1)!, /^ ↑↓ choose · ←→ change · Esc close *$/);
});

test("S1 render: every line exactly the overlay width, from wide to tiny", () => {
	for (const [width, height] of [[120, 40], [60, 24], [40, 12], [24, 8], [12, 4], [5, 2], [1, 1]]) {
		const lines = renderSettings(start(), width, height, model());
		assert.equal(lines.length, height, `${width}x${height} rows`);
		for (const line of lines) assert.equal(visibleWidth(line), width, `${width}x${height}: ${JSON.stringify(plain(line))}`);
	}
	assert.deepEqual(renderSettings(start(), 0, 10), []);
	assert.deepEqual(renderSettings(start(), 60, 0), []);
});

test("S1 render: the live preview is the rail in the chosen look under the rows when the height allows", () => {
	const look: Look = { ...DEFAULT_LOOK, logo: "none", frames: "classic" };
	const tall = renderSettings({ row: 0, look }, 60, 24, model());
	const preview = renderRail(model(), 57, { maxRows: 24 - 10, ...look });
	for (const line of preview.slice(0, 24 - 10)) assert.ok(tall.some((row) => row.includes(line)), `preview row ${JSON.stringify(plain(line))}`);
	assert.ok(tall.map(plain).some((line) => line.includes("╭─ session") || line.includes("┌─ session") || line.includes("session")), "the session section shows");

	// A change shows in the preview at once.
	const faded = renderSettings({ row: 0, look: { ...look, frames: "faded" } }, 60, 24, model());
	assert.notDeepEqual(faded, tall);

	// Too short, or no model: no preview, the hint still last.
	const short = renderSettings({ row: 0, look }, 60, 11, model()).map(plain);
	assert.ok(!short.some((line) => line.includes("session")), "no preview at 11 rows");
	assert.match(short.at(-1)!, /Esc close/);
	const none = renderSettings({ row: 0, look }, 60, 24).map(plain);
	assert.ok(!none.some((line) => line.includes("session")), "no model, no preview");
	assert.equal(none.length, 24);
});

test("S1 render: the preview keeps to the dock width on a wide screen and fits a narrow one", () => {
	const wide = renderSettings(start(), 120, 30, model());
	for (const line of wide.slice(9, -1)) assert.equal(plain(line).trimEnd().length <= 1 + 57, true, plain(line));
	const narrow = renderSettings(start(), 40, 30, model());
	for (const line of narrow) assert.equal(visibleWidth(line), 40);
	assert.ok(narrow.map(plain).some((line) => line.includes("session")), "a narrow screen still previews");
});

test("look-more S1 S2 the divider row cycles medium, off, subtle, strong and the motion row on, off; both wrap", () => {
	let state: SettingsState = { row: 4, look: { ...DEFAULT_LOOK } };
	const dividers: string[] = [];
	for (let index = 0; index < 4; index++) {
		const step = reduceSettings(state, "next");
		assert.equal(step.changed, true);
		state = step.state;
		dividers.push(state.look.divider);
	}
	assert.deepEqual(dividers, ["off", "subtle", "strong", "medium"]);
	assert.equal(reduceSettings({ row: 4, look: { ...DEFAULT_LOOK } }, "prev").state.look.divider, "strong", "before medium wraps to strong");
	const off = reduceSettings({ row: 5, look: { ...DEFAULT_LOOK } }, "next");
	assert.deepEqual(off.state.look, { ...DEFAULT_LOOK, motion: "off" });
	assert.equal(off.changed, true);
	assert.equal(reduceSettings(off.state, "enter").state.look.motion, "on", "two values: Enter toggles back");
	assert.equal(reduceSettings({ row: 5, look: { ...DEFAULT_LOOK } }, "prev").state.look.motion, "off");
});

test("look-more S4 the accent row cycles pink, teal, lilac, amber, green and wraps", () => {
	let state: SettingsState = { row: 3, look: { ...DEFAULT_LOOK } };
	const accents: string[] = [];
	for (let index = 0; index < 5; index++) {
		const step = reduceSettings(state, "next");
		assert.equal(step.changed, true);
		assert.equal(step.state.row, 3, "changing keeps the row");
		state = step.state;
		accents.push(state.look.accent);
	}
	assert.deepEqual(accents, ["teal", "lilac", "amber", "green", "pink"]);
	assert.deepEqual(state.look, DEFAULT_LOOK, "only the accent moved");
	assert.equal(reduceSettings({ row: 3, look: { ...DEFAULT_LOOK } }, "prev").state.look.accent, "green", "before pink wraps to green");
	assert.equal(reduceSettings({ row: 3, look: { ...DEFAULT_LOOK } }, "enter").state.look.accent, "teal", "Enter cycles forward");
});

test("look-more S4 the menu's own pink (title, marker, arrows) and the preview follow the accent; pink is today's", async () => {
	const { accentBase, fgCode, palette } = await import("../lib/palette.ts");
	const pink = renderSettings({ row: 3, look: { ...DEFAULT_LOOK } }, 60, 30, model());
	const teal = renderSettings({ row: 3, look: { ...DEFAULT_LOOK, accent: "teal" } }, 60, 30, model());
	assert.ok(pink[0].includes(`${fgCode(palette.pink)}Fisi Dock look`), "pink title");
	assert.ok(pink[5].includes(`${fgCode(palette.pink)}›`), "pink marker");
	assert.ok(teal[0].includes(`${fgCode(accentBase("teal"))}Fisi Dock look`), "teal title");
	assert.ok(teal[5].includes(`${fgCode(accentBase("teal"))}›`) && teal[5].includes(`${fgCode(accentBase("teal"))}‹`), "teal marker and arrows");
	assert.ok(!teal.slice(0, 9).some((line) => line.includes(fgCode(palette.pink))), "no pink left in the menu");
	assert.deepEqual(teal.map(plain).slice(0, 5), pink.map(plain).slice(0, 5));
	assert.notDeepEqual(teal.slice(9, -1), pink.slice(9, -1), "the preview repaints in the accent");
});

test("look-more S1 the preview draws the chosen divider", () => {
	const tall = (divider: Look["divider"]) => renderSettings({ row: 4, look: { ...DEFAULT_LOOK, divider } }, 60, 30, model());
	assert.notDeepEqual(tall("strong"), tall("medium"));
	assert.ok(!tall("off").slice(9, -1).some((line) => plain(line)[1] === "│"), "off: no divider in the preview");
	assert.ok(tall("medium").slice(9, -1).some((line) => plain(line)[1] === "│"), "medium: the divider shows");
});
