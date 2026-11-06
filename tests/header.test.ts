import assert from "node:assert/strict";
import test from "node:test";
import { headerPath, renderHeaderLine, renderNarrowHeader } from "../lib/header.ts";
import { fgCode, palette } from "../lib/palette.ts";
import type { PanelModel } from "../lib/panel-model.ts";
import { visibleWidth } from "../lib/text.ts";

const plain = (lines: string[]) => lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
const LONG = "E:\\DEV\\projects\\some-deep-folder\\another-level\\my-sample-app-clean";

test("header shows the plain path after one column of padding", () => {
	assert.deepEqual(plain(renderHeaderLine("E:\\DEV\\projects\\my-app", 120)), [" E:\\DEV\\projects\\my-app"]);
});

test("header paints the path in the muted grey", () => {
	const [line] = renderHeaderLine("E:\\DEV\\project", 60);
	assert.ok(line.includes(fgCode(palette.muted)));
	assert.ok(line.includes("38;2;108;108;108"));
});

test("header is never wider than the given width", () => {
	for (const width of [120, 60, 30, 10, 1, 0]) {
		for (const line of renderHeaderLine(LONG, width)) {
			assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
		}
	}
});

test("width 0 gives no line", () => {
	assert.deepEqual(renderHeaderLine(LONG, 0), []);
});

test("a long path keeps its start and last folder with … in the middle", () => {
	const [line] = plain(renderHeaderLine(LONG, 40));
	assert.equal(visibleWidth(line), 40);
	assert.ok(line.startsWith(" E:\\DEV"), line);
	assert.ok(line.endsWith("\\my-sample-app-clean"), line);
	assert.equal(line.split("…").length, 2, line);
});

test("forward slashes split folders too", () => {
	const [line] = plain(renderHeaderLine("/home/fisi/projects/deep/nested/fisi-dock", 25));
	assert.equal(visibleWidth(line), 25);
	assert.ok(line.startsWith(" /home"), line);
	assert.ok(line.endsWith("…/fisi-dock"), line);
});

test("a last folder wider than the room keeps its tail", () => {
	const [line] = plain(renderHeaderLine(LONG, 10));
	assert.equal(line, " …pp-clean");
	assert.deepEqual(plain(renderHeaderLine(LONG, 1)), ["…"]);
});

test("empty path gives no line", () => {
	assert.deepEqual(renderHeaderLine("", 120), []);
});

test("headerPath shortens the home directory like Gentle Shell's header", () => {
	assert.equal(headerPath("C:\\Users\\dev\\code\\app", "C:\\Users\\dev"), "~\\code\\app");
	assert.equal(headerPath("E:\\DEV\\app", "C:\\Users\\dev"), "E:\\DEV\\app");
	assert.equal(headerPath("E:\\DEV\\app", undefined), "E:\\DEV\\app");
	assert.equal(headerPath("", "C:\\Users\\dev"), "");
});

// --- narrow top row (S33) -------------------------------------------------------

const narrow: PanelModel = {
	session: {
		project: "Año Nuevo Demo Project",
		branch: "main",
		contextPercent: 40,
		tokensUsed: 400_000,
		tokensMax: 1_000_000,
		mcp: [
			{ name: "engram", state: "connected" },
			{ name: "context7", state: "failing" },
			{ name: "rea", state: "unknown" },
		],
	},
	footer: { cost: 0.0123, rdd: "on" },
};

test("narrow top row: project · branch, context meter with %, cost and MCP dots (S33)", () => {
	assert.deepEqual(plain(renderNarrowHeader(narrow, 64)).slice(0, 1), [" Año Nuevo Demo Project · main  ▰▰▱▱ 40%  $0.012  ●●●"]);
	assert.deepEqual(plain(renderNarrowHeader(narrow, 53)).slice(0, 1), [" Año Nuevo Demo Project · main  ▰▰▱▱ 40%  $0.012  ●●●"]);
});

test("narrow top row colors: bold project, green branch, teal meter, muted cost, dots by state (S33, S9)", () => {
	const [line] = renderNarrowHeader(narrow, 64);
	assert.ok(line.includes(`\x1b[1m${fgCode(palette.text)}Año Nuevo Demo Project`), "bold project");
	assert.ok(line.includes(`${fgCode(palette.green)}main`), "green branch");
	assert.ok(line.includes(`${fgCode(palette.teal)}▰▰`), "teal meter below 60%");
	assert.ok(line.includes(`${fgCode(palette.muted)}$0.012`), "muted cost");
	assert.ok(line.includes(`${fgCode(palette.green)}●${"\x1b[39m"}${fgCode(palette.red)}●${"\x1b[39m"}${fgCode(palette.faint)}●`), "green, red, muted dots in order");
	const amber = renderNarrowHeader({ ...narrow, session: { ...narrow.session, contextPercent: 70 } }, 64)[0];
	assert.ok(amber.includes(`${fgCode(palette.amber)}▰`), "amber from 60%");
	const red = renderNarrowHeader({ ...narrow, session: { ...narrow.session, contextPercent: 90 } }, 64)[0];
	assert.ok(red.includes(`${fgCode(palette.red)}▰`), "red from 85%");
});

test("narrow top row drops segments from the right and ellipsizes the project last (S33)", () => {
	assert.deepEqual(plain(renderNarrowHeader(narrow, 50)).slice(0, 1), [" Año Nuevo Demo Project · main  ▰▰▱▱ 40%  $0.012"]);
	assert.deepEqual(plain(renderNarrowHeader(narrow, 40)).slice(0, 1), [" Año Nuevo Demo Project · main  ▰▰▱▱ 40%"]);
	assert.deepEqual(plain(renderNarrowHeader(narrow, 30)).slice(0, 1), [" Año Nuevo Demo Project · main"]);
	assert.deepEqual(plain(renderNarrowHeader(narrow, 20)).slice(0, 1), [" Año Nuevo Demo Pro…"]);
	for (const width of [64, 53, 40, 20, 5, 1]) for (const line of renderNarrowHeader(narrow, width)) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
	assert.deepEqual(renderNarrowHeader(narrow, 0), []);
});

test("narrow top row leaves out what it does not know and never shows model, profile or review (S33, S8)", () => {
	assert.deepEqual(plain(renderNarrowHeader({ session: { project: "app" } }, 64)).slice(0, 1), [" app"]);
	assert.deepEqual(plain(renderNarrowHeader({ session: { project: "app" }, footer: { cost: 0 } }, 64)).slice(0, 1), [" app  $0.000"]);
	assert.deepEqual(plain(renderNarrowHeader({ session: { project: "app", contextPercent: 0 } }, 64)).slice(0, 1), [" app  ▱▱▱▱ 0%"]);
	const [line] = plain(renderNarrowHeader(narrow, 200));
	for (const banned of ["claude", "RDD", "review", "opus", "engram", "context"]) assert.ok(!line.includes(banned), banned);
});

test("narrow top row with cost 0 and tokens: tokens and the ≈ estimate instead of $0.000 (S37)", () => {
	const usage = { ...narrow, footer: { cost: 0, tokens: 12_400_000, estimate: 38.4, rdd: "on" as const } };
	assert.deepEqual(plain(renderNarrowHeader(usage, 64)).slice(0, 1), [" Año Nuevo Demo Project · main  ▰▰▱▱ 40%  12.4M tok · ≈$38  ●●●"]);
	assert.ok(renderNarrowHeader(usage, 64)[0].includes(`${fgCode(palette.muted)}12.4M tok · ≈$38`), "muted like the cost");
	// Same drop order: MCP dots, then this segment, then the meter, then the branch.
	assert.deepEqual(plain(renderNarrowHeader(usage, 60)).slice(0, 1), [" Año Nuevo Demo Project · main  ▰▰▱▱ 40%  12.4M tok · ≈$38"]);
	assert.deepEqual(plain(renderNarrowHeader(usage, 53)).slice(0, 1), [" Año Nuevo Demo Project · main  ▰▰▱▱ 40%"]);
	assert.deepEqual(plain(renderNarrowHeader(usage, 40)).slice(0, 1), [" Año Nuevo Demo Project · main  ▰▰▱▱ 40%"]);
	assert.deepEqual(plain(renderNarrowHeader(usage, 20)).slice(0, 1), [" Año Nuevo Demo Pro…"]);
	for (const width of [64, 53, 40, 20]) for (const line of renderNarrowHeader(usage, width)) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
	const tokensOnly = { session: { project: "app" }, footer: { cost: 0, tokens: 53_500 } };
	assert.deepEqual(plain(renderNarrowHeader(tokensOnly, 64)).slice(0, 1), [" app  53.5k tok"], "no price: tokens only");
	const paid = { session: { project: "app" }, footer: { cost: 0.0123, tokens: 53_500, estimate: 4 } };
	assert.deepEqual(plain(renderNarrowHeader(paid, 64)).slice(0, 1), [" app  $0.012"], "a real cost wins");
});

test("the narrow header ends with a full-width gray rule so the conversation below reads apart (S36)", () => {
	const model = { session: { project: "Año Nuevo Demo Project", branch: "main", contextPercent: 40 } };
	for (const width of [64, 53, 40, 20]) {
		const lines = renderNarrowHeader(model, width);
		assert.equal(lines.length, 2, `${width}: header row and rule`);
		assert.equal(plain([lines[1]])[0], "─".repeat(width), `${width}: rule spans the width`);
		assert.ok(lines[1].includes("\x1b[38;2;69;69;69m"), "rule in the panel frame gray");
	}
	assert.deepEqual(renderNarrowHeader(model, 0), []);
});
