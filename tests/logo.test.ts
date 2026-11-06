import assert from "node:assert/strict";
import test from "node:test";
import { COMPACT_LOGO_WIDTH, LOGO_WIDTH, renderLogo } from "../lib/logo.ts";
import { visibleWidth } from "../lib/text.ts";

const plain = (line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const SHADOW = "95;30;60";

// The "Puntitos gris" preview approved for S21, trailing blanks trimmed.
const APPROVED_WIDE = [
	"⣤⠛⠛⠛ ⣿⠛⠛⠛ ⣿⣤ ⣿ ⠛⣿⣿⠛ ⣿   ⣿⠛⠛⠛   ⣤⠛⠛⠛ ⣿  ⣿ ⣿⠛⠛⠛ ⣿   ⣿",
	"⣿ ⠛⣿ ⣿⠛⠛  ⣿ ⠛⣿  ⣿⣿  ⣿   ⣿⠛⠛     ⠛⠛⣤ ⣿⠛⠛⣿ ⣿⠛⠛  ⣿   ⣿",
	" ⠛⠛⠛ ⠛⠛⠛⠛ ⠛  ⠛  ⠛⠛  ⠛⠛⠛ ⠛⠛⠛⠛   ⠛⠛⠛  ⠛  ⠛ ⠛⠛⠛⠛ ⠛⠛⠛ ⠛⠛⠛",
];

/** Foreground colors painted on `line`, as [r, g, b]. */
const colorsOf = (line: string) => [...line.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].map((match) => match.slice(1).map(Number));

/** Pixel rows back from the braille cells: top two dot rows, bottom two dot rows. */
function pixelsOf(lines: string[]): string[] {
	const rows: string[] = [];
	for (const line of lines) {
		const top: string[] = [];
		const bottom: string[] = [];
		for (const char of plain(line)) {
			const cell = { " ": "..", "⠛": "#.", "⣤": ".#", "⣿": "##" }[char];
			assert.ok(cell, `unexpected cell ${JSON.stringify(char)}`);
			top.push(cell[0]);
			bottom.push(cell[1]);
		}
		rows.push(top.join(""), bottom.join(""));
	}
	return rows;
}

test("wide logo is the approved 53-column braille wordmark in 3 rows", () => {
	assert.equal(LOGO_WIDTH, 53);
	const lines = renderLogo(53);
	assert.deepEqual(lines.map((line) => plain(line).trimEnd()), APPROVED_WIDE);
	for (const line of lines) assert.equal(visibleWidth(line), 53);
	assert.deepEqual(renderLogo(55), lines, "wider rails get the same wordmark");
});

test("wide logo draws the 08 letter shapes from braille dots", () => {
	const letters = pixelsOf(renderLogo(53)).slice(0, 5);
	assert.deepEqual(letters.map((row) => row.slice(0, 4)), [".###", "#...", "#.##", "#..#", ".###"], "G");
	assert.deepEqual(letters.map((row) => row.slice(5, 9)), ["####", "#...", "###.", "#...", "####"], "E");
	assert.deepEqual(letters.map((row) => row.slice(10, 14)), ["#..#", "##.#", "#.##", "#..#", "#..#"], "N");
	assert.deepEqual(letters.map((row) => row.slice(15, 19)), ["####", ".##.", ".##.", ".##.", ".##."], "T");
	assert.deepEqual(letters.map((row) => row.slice(20, 23)), ["#..", "#..", "#..", "#..", "###"], "L");
	assert.deepEqual(letters.map((row) => row.slice(31, 35)), [".###", "#...", ".##.", "...#", "###."], "S");
	assert.deepEqual(letters.map((row) => row.slice(36, 40)), ["#..#", "#..#", "####", "#..#", "#..#"], "H");
	assert.equal(pixelsOf(renderLogo(53))[5], ".".repeat(53), "no shadow row");
});

test("wide logo is a gray gradient, lighter at the top, with no shadow or background", () => {
	const lines = renderLogo(53);
	for (const line of lines) {
		const colors = colorsOf(line);
		assert.ok(colors.length > 0);
		for (const [r, g, b] of colors) assert.ok(r === g && g === b, `gray ${r};${g};${b}`);
	}
	const top = Math.min(...colorsOf(lines[0]).map(([r]) => r));
	const bottom = Math.max(...colorsOf(lines[2]).map(([r]) => r));
	assert.ok(top > bottom, `top ${top} lighter than bottom ${bottom}`);
	const joined = lines.join("");
	assert.ok(!joined.includes(SHADOW), "no shadow color");
	assert.ok(!joined.includes("\x1b[48;"), "no background halves");
	assert.ok(!joined.includes("\x1b[0m"), "no full reset");
});

test("below 53 the compact braille logo is used; it fits the official 47-column rail", () => {
	assert.ok(COMPACT_LOGO_WIDTH <= 47);
	for (const width of [52, 47, COMPACT_LOGO_WIDTH]) {
		const lines = renderLogo(width);
		assert.equal(lines.length, 3, `width ${width}`);
		for (const line of lines) assert.ok(visibleWidth(line) <= COMPACT_LOGO_WIDTH);
		for (const line of lines) for (const [r, g, b] of colorsOf(line)) assert.ok(r === g && g === b, "gray");
		assert.ok(colorsOf(lines[0])[0][0] > colorsOf(lines[2])[0][0], "lighter at the top");
		assert.ok(!lines.join("").includes(SHADOW), "no shadow");
	}
	const letters = pixelsOf(renderLogo(47)).slice(0, 5);
	assert.deepEqual(letters.map((row) => row.slice(0, 3)), [".##", "#..", "#.#", "#.#", ".##"], "compact G");
	assert.deepEqual(letters.map((row) => row.slice(4, 7)), ["###", "#..", "##.", "#..", "###"], "compact E");
});

test("narrow widths fall back to the bold gray GENTLE SHELL text", () => {
	for (const width of [COMPACT_LOGO_WIDTH - 1, 30, 20, 12]) {
		const lines = renderLogo(width);
		assert.equal(lines.length, 1, `width ${width}`);
		assert.equal(plain(lines[0]), "GENTLE SHELL");
		assert.ok(lines[0].includes("\x1b[1m"), "bold");
		const [[r, g, b]] = colorsOf(lines[0]);
		assert.ok(r === g && g === b, "gray");
	}
});

test("below 12 columns no logo lines remain", () => {
	for (const width of [11, 5, 1, 0]) assert.deepEqual(renderLogo(width), [], `width ${width}`);
});

test("no flower and every logo line fits at 55, 53, 47, 40, 30, 20, 12, 5 and 0 columns", () => {
	for (const width of [55, 53, 47, 40, 30, 20, 12, 5, 0]) {
		for (const line of renderLogo(width)) {
			assert.ok(!line.includes("✿"), `flower at ${width}`);
			assert.ok(visibleWidth(line) <= width, `${width}`);
		}
	}
});
