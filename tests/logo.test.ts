import assert from "node:assert/strict";
import test from "node:test";
import { COMPACT_LOGO_WIDTH, LOGO_WIDTH, renderLogo } from "../lib/logo.ts";
import { visibleWidth } from "../lib/text.ts";

const plain = (line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const SHADOW = "95;30;60";

// Artboard rail-wordmark/04 "Tinted braille", custom rail joined: GENTLESHELL with no word gap, trailing blanks trimmed.
const APPROVED_WIDE = [
	"⣤⠛⠛⠛ ⣿⠛⠛⠛ ⣿⣤ ⣿ ⠛⣿⣿⠛ ⣿   ⣿⠛⠛⠛ ⣤⠛⠛⠛ ⣿  ⣿ ⣿⠛⠛⠛ ⣿   ⣿",
	"⣿ ⠛⣿ ⣿⠛⠛  ⣿ ⠛⣿  ⣿⣿  ⣿   ⣿⠛⠛   ⠛⠛⣤ ⣿⠛⠛⣿ ⣿⠛⠛  ⣿   ⣿",
	" ⠛⠛⠛ ⠛⠛⠛⠛ ⠛  ⠛  ⠛⠛  ⠛⠛⠛ ⠛⠛⠛⠛ ⠛⠛⠛  ⠛  ⠛ ⠛⠛⠛⠛ ⠛⠛⠛ ⠛⠛⠛",
];

const PINK = [0xf2, 0xa7, 0xc9];
const DEEP_PINK = [0xc9, 0x77, 0x9f];
const isGray = ([r, g, b]: number[]) => r === g && g === b;
/** A tone between the theme's pink and deepPink, channel by channel. */
const isPink = (color: number[]) => !isGray(color) && color.every((channel, index) => channel <= PINK[index] && channel >= DEEP_PINK[index]);

/** Foreground colors painted on `line`, as [r, g, b]. */
const colorsOf = (line: string) => [...line.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].map((match) => match.slice(1).map(Number));

/** The foreground color of every non-blank cell of `line`, by visible column. */
function cellColors(line: string): Map<number, number[]> {
	const colors = new Map<number, number[]>();
	let color: number[] = [];
	let column = 0;
	for (const part of line.split(/(\x1b\[[0-?]*[ -/]*[@-~])/)) {
		const match = part.match(/^\x1b\[38;2;(\d+);(\d+);(\d+)m$/);
		if (match) color = match.slice(1).map(Number);
		else if (!part.startsWith("\x1b")) {
			for (const char of part) {
				if (char !== " ") colors.set(column, color);
				column += 1;
			}
		}
	}
	return colors;
}

/** GENTLE gray and SHELL pink, both lighter at the top; `shellStart` is SHELL's first column. */
function assertTint(lines: string[], shellStart: number) {
	for (const line of lines) {
		for (const [column, color] of cellColors(line)) {
			if (column < shellStart) assert.ok(isGray(color), `GENTLE gray at column ${column}: ${color}`);
			else assert.ok(isPink(color), `SHELL pink at column ${column}: ${color}`);
		}
	}
	const first = (line: string, from: number, to: number) => [...cellColors(line)].find(([column]) => column >= from && column < to)![1];
	assert.ok(first(lines[0], 0, shellStart)[0] > first(lines[2], 0, shellStart)[0], "GENTLE lighter at the top");
	assert.ok(first(lines[0], shellStart, Infinity)[0] > first(lines[2], shellStart, Infinity)[0], "SHELL lighter at the top");
}

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

const columns = (rows: string[], from: number, to: number) => rows.map((row) => row.slice(from, to));

test("wide logo is the approved 51-column joined braille wordmark in 3 rows", () => {
	assert.equal(LOGO_WIDTH, 51);
	const lines = renderLogo(51);
	assert.deepEqual(lines.map((line) => plain(line).trimEnd()), APPROVED_WIDE);
	for (const line of lines) assert.equal(visibleWidth(line), 51);
	assert.deepEqual(renderLogo(53), lines, "wider rails get the same wordmark");
	assert.deepEqual(renderLogo(55), lines, "wider rails get the same wordmark");
});

test("wide logo draws the 08 letter shapes from braille dots, with one gap column between the words", () => {
	const letters = pixelsOf(renderLogo(51)).slice(0, 5);
	assert.deepEqual(columns(letters, 0, 4), [".###", "#...", "#.##", "#..#", ".###"], "G");
	assert.deepEqual(columns(letters, 5, 9), ["####", "#...", "###.", "#...", "####"], "E");
	assert.deepEqual(columns(letters, 10, 14), ["#..#", "##.#", "#.##", "#..#", "#..#"], "N");
	assert.deepEqual(columns(letters, 15, 19), ["####", ".##.", ".##.", ".##.", ".##."], "T");
	assert.deepEqual(columns(letters, 20, 23), ["#..", "#..", "#..", "#..", "###"], "L");
	assert.deepEqual(columns(letters, 24, 28), ["####", "#...", "###.", "#...", "####"], "last E of GENTLE");
	assert.deepEqual(columns(letters, 28, 29), [".", ".", ".", ".", "."], "one gap column, like between letters");
	assert.deepEqual(columns(letters, 29, 33), [".###", "#...", ".##.", "...#", "###."], "S");
	assert.deepEqual(columns(letters, 34, 38), ["#..#", "#..#", "####", "#..#", "#..#"], "H");
	assert.equal(pixelsOf(renderLogo(51))[5], ".".repeat(51), "no shadow row");
});

test("wide logo: GENTLE in a gray gradient, SHELL from pink to deep pink, no shadow or background", () => {
	const lines = renderLogo(51);
	for (const line of lines) assert.ok(colorsOf(line).length > 0);
	assertTint(lines, 29);
	assert.deepEqual(cellColors(lines[0]).get(30), PINK, "SHELL's top pixel row is the theme pink");
	const joined = lines.join("");
	assert.ok(!joined.includes(SHADOW), "no shadow color");
	assert.ok(!joined.includes("\x1b[48;"), "no background halves");
	assert.ok(!joined.includes("\x1b[0m"), "no full reset");
});

test("below 51 the compact joined logo is used: 45 columns, so the official 47-column rail centers it with one blank column each side", () => {
	assert.equal(COMPACT_LOGO_WIDTH, 45);
	for (const width of [50, 47, COMPACT_LOGO_WIDTH]) {
		const lines = renderLogo(width);
		assert.equal(lines.length, 3, `width ${width}`);
		for (const line of lines) assert.equal(visibleWidth(line), COMPACT_LOGO_WIDTH);
		assertTint(lines, 26);
		assert.ok(!lines.join("").includes(SHADOW), "no shadow");
	}
	const letters = pixelsOf(renderLogo(47)).slice(0, 5);
	const wide = pixelsOf(renderLogo(51)).slice(0, 5);
	assert.deepEqual(columns(letters, 0, 4), columns(wide, 0, 4), "G keeps the custom shape");
	assert.deepEqual(columns(letters, 5, 8), ["###", "#..", "##.", "#..", "###"], "narrow E");
	assert.deepEqual(columns(letters, 9, 13), columns(wide, 10, 14), "N keeps the custom shape");
	assert.deepEqual(columns(letters, 14, 17), ["###", ".#.", ".#.", ".#.", ".#."], "narrow T");
	assert.deepEqual(columns(letters, 18, 21), columns(wide, 20, 23), "L keeps the custom 3-column shape");
	assert.deepEqual(columns(letters, 26, 29), [".##", "#..", ".#.", "..#", "##."], "narrow S");
	assert.deepEqual(columns(letters, 30, 33), ["#.#", "#.#", "###", "#.#", "#.#"], "narrow H");
	assert.deepEqual(columns(letters, 38, 41), columns(wide, 44, 47), "next to last L keeps the custom shape");
	assert.deepEqual(columns(letters, 42, 45), columns(wide, 48, 51), "last L keeps the custom shape");
});

test("narrow widths fall back to bold GENTLESHELL text: GENTLE gray, SHELL pink", () => {
	for (const width of [COMPACT_LOGO_WIDTH - 1, 30, 20, 11]) {
		const lines = renderLogo(width);
		assert.equal(lines.length, 1, `width ${width}`);
		assert.equal(plain(lines[0]), "GENTLESHELL");
		assert.ok(lines[0].includes("\x1b[1m"), "bold");
		const colors = cellColors(lines[0]);
		for (let column = 0; column < 6; column += 1) assert.ok(isGray(colors.get(column)!), `gray at ${column}`);
		for (let column = 6; column < 11; column += 1) assert.deepEqual(colors.get(column), PINK, `pink at ${column}`);
	}
});

test("below 11 columns no logo lines remain", () => {
	for (const width of [10, 5, 1, 0]) assert.deepEqual(renderLogo(width), [], `width ${width}`);
});

test("no flower and every logo line fits at 55, 51, 47, 45, 44, 40, 30, 20, 11, 5 and 0 columns", () => {
	for (const width of [55, 51, 47, 45, 44, 40, 30, 20, 11, 5, 0]) {
		for (const line of renderLogo(width)) {
			assert.ok(!line.includes("✿"), `flower at ${width}`);
			assert.ok(visibleWidth(line) <= width, `${width}`);
		}
	}
});
