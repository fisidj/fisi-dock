import assert from "node:assert/strict";
import test from "node:test";
import { createLiveStore } from "../lib/live-store.ts";
import { DEFAULT_LOOK, DEFAULT_SECTIONS, type Look } from "../lib/look.ts";
import { renderRail } from "../lib/panel.ts";
import { reduceSettings, renderSettings, SECTIONS_HINT, SETTINGS_HINT, SETTINGS_ROWS, settingsAction, type SettingsState } from "../lib/settings-menu.ts";
import { visibleWidth } from "../lib/text.ts";

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const start = (look: Look = { ...DEFAULT_LOOK }): SettingsState => ({ row: 0, look });
const model = () => createLiveStore("my-app", () => 0).model();

test("S1 the rows are logo, frames, colors, accent, divider, motion and sections, in that order (look-more S1, S2, S4, S6)", () => {
	assert.deepEqual(SETTINGS_ROWS, ["logo", "frames", "colors", "accent", "divider", "motion", "sections"]);
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
		["x", undefined], ["", undefined], ["L", undefined], ["[1;5A", undefined],
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
	assert.equal(step.state.row, 6, "sections, the last row (look-more S6)");
	step = reduceSettings(step.state, "down");
	assert.equal(step.state.row, 0, "past sections wraps to logo");
	step = reduceSettings(step.state, "up");
	assert.equal(step.state.row, 6, "above logo wraps to sections");
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
	const light = reduceSettings(colors.state, "enter");
	assert.equal(light.state.look.colors, "light", "look-more S5: Enter goes on to light");
	assert.equal(reduceSettings(light.state, "enter").state.look.colors, "vivid", "past light wraps to vivid");
	assert.equal(reduceSettings({ row: 2, look: { ...DEFAULT_LOOK } }, "prev").state.look.colors, "light", "before vivid wraps to light");
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
	const lines = renderSettings({ row: 1, look: { logo: "text", frames: "classic", colors: "soft", accent: "teal", divider: "subtle", motion: "off" } }, 60, 11).map(plain);
	assert.equal(lines.length, 11);
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
	const preview = renderRail(model(), 57, { maxRows: 24 - 11, ...look });
	for (const line of preview.slice(0, 24 - 11)) assert.ok(tall.some((row) => row.includes(line)), `preview row ${JSON.stringify(plain(line))}`);
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

// --- look-more S6: the sections screen ---------------------------------------------

const SECTIONS_ROW = 6;
const onSections = (look: Look = { ...DEFAULT_LOOK, sections: DEFAULT_SECTIONS.map((section) => ({ ...section })) }, item = 0): SettingsState => ({ row: SECTIONS_ROW, look, screen: "sections", item });
const order = (state: SettingsState) => state.look.sections.map((section) => `${section.shown ? "" : "!"}${section.id}`).join(" ");

test("look-more S6 settingsAction: space shows or hides, Shift+↑↓ (xterm and rxvt) and K/J move the section", () => {
	const cases: [string, string][] = [[" ", "toggle"], ["\x1b[1;2A", "moveUp"], ["\x1b[a", "moveUp"], ["K", "moveUp"], ["\x1b[1;2B", "moveDown"], ["\x1b[b", "moveDown"], ["J", "moveDown"]];
	for (const [data, action] of cases) assert.equal(settingsAction(data), action, JSON.stringify(data));
	assert.equal(SECTIONS_HINT, "space show · shift+↑↓ move · Esc back");
});

test("look-more S6 Enter or → on the sections row opens the sections screen at the first section; ← and the section keys do nothing there", () => {
	for (const action of ["enter", "next"] as const) {
		const step = reduceSettings({ row: SECTIONS_ROW, look: { ...DEFAULT_LOOK } }, action);
		assert.equal(step.state.screen, "sections", action);
		assert.equal(step.state.item, 0, action);
		assert.equal(step.state.row, SECTIONS_ROW);
		assert.equal(step.changed, false);
		assert.equal(step.close, false);
		assert.deepEqual(step.state.look, DEFAULT_LOOK);
	}
	for (const action of ["prev", "toggle", "moveUp", "moveDown"] as const) {
		const step = reduceSettings({ row: SECTIONS_ROW, look: { ...DEFAULT_LOOK } }, action);
		assert.equal(step.changed, false, action);
		assert.notEqual(step.state.screen, "sections", action);
		assert.deepEqual(step.state.look, DEFAULT_LOOK, action);
	}
	for (const action of ["toggle", "moveUp", "moveDown"] as const) assert.deepEqual(reduceSettings({ row: 0, look: { ...DEFAULT_LOOK } }, action).state, { row: 0, look: DEFAULT_LOOK }, `${action} on a ←→ row`);
	assert.equal(reduceSettings({ row: SECTIONS_ROW, look: { ...DEFAULT_LOOK } }, "close").close, true, "Esc on the main rows still closes");
});

test("look-more S6 on the sections screen ↑↓ move the cursor and wrap; space toggles the selected one and says the look changed", () => {
	let step = reduceSettings(onSections(), "up");
	assert.equal(step.state.item, 6, "above heads-up wraps to changes");
	assert.equal(step.changed, false);
	step = reduceSettings(step.state, "down");
	assert.equal(step.state.item, 0, "past changes wraps to heads-up");
	step = reduceSettings(reduceSettings(step.state, "down").state, "toggle");
	assert.equal(step.changed, true);
	assert.equal(order(step.state), "heads-up !odd rdd ci agents todo changes");
	assert.equal(step.state.item, 1);
	assert.equal(step.state.screen, "sections");
	step = reduceSettings(step.state, "toggle");
	assert.equal(order(step.state), "heads-up odd rdd ci agents todo changes", "space again shows it");
	const before = onSections();
	reduceSettings(before, "toggle");
	assert.equal(order(before), "heads-up odd rdd ci agents todo changes", "the old state is left as it was");
});

test("look-more S6 Shift+↑↓ move the selected section one place, the cursor with it; at the ends they stop (no wrap) and change nothing", () => {
	let step = reduceSettings(onSections(undefined, 5), "moveUp");
	assert.equal(order(step.state), "heads-up odd rdd ci todo agents changes");
	assert.equal(step.state.item, 4, "the cursor follows todo");
	assert.equal(step.changed, true);
	for (let index = 0; index < 3; index++) step = reduceSettings(step.state, "moveUp");
	assert.equal(order(step.state), "heads-up todo odd rdd ci agents changes", "todo above ODD");
	assert.equal(step.state.item, 1);
	step = reduceSettings(step.state, "moveUp");
	assert.equal(order(step.state), "todo heads-up odd rdd ci agents changes");
	assert.equal(step.state.item, 0);
	const top = reduceSettings(step.state, "moveUp");
	assert.equal(top.changed, false, "the first stays first");
	assert.equal(order(top.state), "todo heads-up odd rdd ci agents changes");
	assert.equal(top.state.item, 0);
	step = reduceSettings(onSections(undefined, 5), "moveDown");
	assert.equal(order(step.state), "heads-up odd rdd ci agents changes todo");
	assert.equal(step.state.item, 6);
	const bottom = reduceSettings(step.state, "moveDown");
	assert.equal(bottom.changed, false, "the last stays last");
	assert.equal(bottom.state.item, 6);
	const hidden = reduceSettings(reduceSettings(onSections(undefined, 2), "toggle").state, "moveDown");
	assert.equal(order(hidden.state), "heads-up odd ci !rdd agents todo changes", "a hidden section moves too");
});

test("look-more S6 Esc, q and ← go back to the main rows on the sections row, the look kept; Enter and → do nothing there", () => {
	const moved = reduceSettings(onSections(undefined, 6), "moveUp").state;
	for (const action of ["close", "prev"] as const) {
		const step = reduceSettings(moved, action);
		assert.equal(step.close, false, action);
		assert.equal(step.changed, false, action);
		assert.equal(step.state.screen, "main", action);
		assert.equal(step.state.row, SECTIONS_ROW, action);
		assert.equal(order(step.state), order(moved), action);
		assert.equal(reduceSettings(step.state, "close").close, true, `${action} then Esc closes`);
	}
	assert.equal(settingsAction("q"), "close");
	for (const action of ["enter", "next"] as const) {
		const step = reduceSettings(moved, action);
		assert.equal(step.changed, false, action);
		assert.deepEqual(step.state, moved, action);
	}
});

test("look-more S6 render: the sections row shows how many are shown, `7 of 7`, `5 of 7`, with a › to open it", () => {
	const lines = renderSettings({ row: SECTIONS_ROW, look: { ...DEFAULT_LOOK } }, 60, 24, model()).map(plain);
	assert.equal(lines[8], " › sections  7 of 7 ›".padEnd(60));
	const five = { ...DEFAULT_LOOK, sections: DEFAULT_SECTIONS.map((section) => ({ ...section, shown: section.id !== "ci" && section.id !== "rdd" })) };
	assert.equal(renderSettings({ row: 0, look: five }, 60, 24, model()).map(plain)[8], "   sections  5 of 7 ›".padEnd(60));
	assert.match(lines.at(-1)!, /^ ↑↓ choose · ←→ change · Esc close *$/);
	assert.equal(renderSettings({ row: 0, look: { logo: "text", frames: "none", colors: "soft", accent: "teal", divider: "off", motion: "off" } as Look }, 60, 24).map(plain)[8], "   sections  7 of 7 ›".padEnd(60), "a look without sections counts today's");
});

test("look-more S6 render: the sections screen lists every section in order with [x] or [ ], the cursor marked, its hint last, the preview in that order", () => {
	const moved = reduceSettings(onSections(undefined, 5), "moveUp").state;
	const hidden = reduceSettings({ ...moved, item: 6 }, "toggle").state;
	const raw = renderSettings(hidden, 60, 24, model());
	const lines = raw.map(plain);
	assert.equal(lines.length, 24);
	assert.equal(lines[0], " Fisi Dock look › sections".padEnd(60));
	assert.equal(lines[1], "".padEnd(60));
	assert.deepEqual(lines.slice(2, 9), ["   [x] heads-up", "   [x] odd", "   [x] rdd", "   [x] ci", "   [x] todo", "   [x] agents", " › [ ] changes"].map((line) => line.padEnd(60)));
	assert.equal(lines[9], "".padEnd(60));
	assert.equal(lines.at(-1), " space show · shift+↑↓ move · Esc back".padEnd(60));
	const preview = renderRail(model(), 57, { maxRows: 24 - 11, ...hidden.look });
	assert.deepEqual(raw.slice(10, -1).map(plain), preview.slice(0, 13).map((line) => ` ${plain(line)}`.padEnd(60)), "the preview is the rail in that look");
	const noTodo = { ...hidden, look: { ...hidden.look, sections: hidden.look.sections.map((section) => ({ ...section, shown: section.id !== "todo" })) } };
	const tall = (state: SettingsState) => renderSettings(state, 60, 40, model()).map(plain);
	assert.equal(tall(noTodo)[6], "   [ ] todo".padEnd(60));
	assert.ok(tall(hidden).slice(10, -1).some((line) => line.includes("todo")), "the shown todo in the preview");
	assert.ok(!tall(noTodo).slice(10, -1).some((line) => line.includes("todo")), "a hidden todo leaves the preview");
	for (const [width, height] of [[120, 40], [60, 24], [40, 12], [24, 8], [12, 4], [5, 2], [1, 1]]) {
		const shown = renderSettings(hidden, width, height, model());
		assert.equal(shown.length, height, `${width}x${height} rows`);
		for (const line of shown) assert.equal(visibleWidth(line), width, `${width}x${height}: ${JSON.stringify(plain(line))}`);
	}
	assert.match(plain(renderSettings(hidden, 60, 4, model()).at(-1)!), /^ space show · shift\+↑↓ move · Esc back *$/, "a short screen keeps the hint");
	console.log(`--- the sections screen, 60x24\n${lines.join("\n")}`);
});
