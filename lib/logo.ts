import { bold, fg, type Rgb } from "./palette.ts";

// The "GENTLE SHELL" wordmark in a 5-pixel-tall font, drawn with braille dots
// (S21). Each terminal cell holds two pixels stacked: the upper pixel is the top
// two dot rows, the lower pixel the bottom two, so 5 pixel rows take 3 terminal
// rows. Two sizes: artboard 08's letters for Gentle Shell fisi/custom's wider
// rail, and the compact one for the official 47-column rail.

interface LogoStyle {
	font: Record<string, string[]>;
	letterGap: number;
	wordGap: number;
}

// Artboard 08 (.px grid): 4-column letters (L is 3).
const WIDE: LogoStyle = {
	font: {
		G: [".###", "#...", "#.##", "#..#", ".###"],
		E: ["####", "#...", "###.", "#...", "####"],
		N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
		T: ["####", ".##.", ".##.", ".##.", ".##."],
		L: ["#..", "#..", "#..", "#..", "###"],
		S: [".###", "#...", ".##.", "...#", "###."],
		H: ["#..#", "#..#", "####", "#..#", "#..#"],
	},
	letterGap: 1,
	wordGap: 3,
};

// About 3 pixels per letter.
const COMPACT: LogoStyle = {
	font: {
		G: [".##", "#..", "#.#", "#.#", ".##"],
		E: ["###", "#..", "##.", "#..", "###"],
		N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
		T: ["###", ".#.", ".#.", ".#.", ".#."],
		L: ["#.", "#.", "#.", "#.", "##"],
		S: [".##", "#..", ".#.", "..#", "##."],
		H: ["#.#", "#.#", "###", "#.#", "#.#"],
	},
	letterGap: 1,
	wordGap: 2,
};

/** Gray for each pixel row, top to bottom: near white down to mid gray. */
const ROWS: Rgb[] = [230, 205, 180, 155, 130].map((level): Rgb => [level, level, level]);

const WORDS = ["GENTLE", "SHELL"];
const TEXT_MARK = "GENTLE SHELL";

/** Lit pixels, one row per pixel row. */
function pixelGrid(style: LogoStyle): boolean[][] {
	const lit: boolean[][] = ROWS.map(() => []);
	const gap = (columns: number) => {
		for (const row of lit) row.push(...Array<boolean>(columns).fill(false));
	};
	WORDS.forEach((word, wordIndex) => {
		if (wordIndex > 0) gap(style.wordGap);
		[...word].forEach((letter, letterIndex) => {
			if (letterIndex > 0) gap(style.letterGap);
			const glyph = style.font[letter];
			lit.forEach((row, y) => row.push(...[...glyph[y]].map((pixel) => pixel === "#")));
		});
	});
	return lit;
}

const BRAILLE = { upper: "⠛", lower: "⣤", both: "⣿" };

// A cell has one foreground color: the color of its upper lit pixel row.
function pixelLines(style: LogoStyle): string[] {
	const grid = pixelGrid(style);
	const lines: string[] = [];
	for (let y = 0; y < grid.length; y += 2) {
		const top = grid[y];
		const bottom = grid[y + 1] ?? [];
		const cells = top.map((upper, x) => {
			const lower = bottom[x] ?? false;
			if (upper) return fg(ROWS[y], lower ? BRAILLE.both : BRAILLE.upper);
			return lower ? fg(ROWS[y + 1], BRAILLE.lower) : " ";
		});
		lines.push(cells.join(""));
	}
	return lines;
}

const WIDE_LINES = pixelLines(WIDE);
const COMPACT_LINES = pixelLines(COMPACT);

/** Visible columns of the wide wordmark (53); fisi/custom's 55-column rail fits it with its indent. */
export const LOGO_WIDTH = pixelGrid(WIDE)[0].length;
/** Visible columns of the compact wordmark, for the official 47-column rail. */
export const COMPACT_LOGO_WIDTH = pixelGrid(COMPACT)[0].length;

/** The wordmark for `width` columns: wide braille, compact braille, plain text, then nothing. */
export function renderLogo(width: number): string[] {
	const columns = Math.max(0, Math.floor(width));
	if (columns >= LOGO_WIDTH) return WIDE_LINES;
	if (columns >= COMPACT_LOGO_WIDTH) return COMPACT_LINES;
	if (columns >= TEXT_MARK.length) return [bold(fg(ROWS[2], TEXT_MARK))];
	return [];
}
