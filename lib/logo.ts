import { bold, fg, palette, type Rgb } from "./palette.ts";

// The "GENTLESHELL" wordmark in a 5-pixel-tall font, drawn with braille dots
// (S21, design rail-wordmark/04 "Tinted braille"). Each terminal cell holds two
// pixels stacked: the upper pixel is the top two dot rows, the lower pixel the
// bottom two, so 5 pixel rows take 3 terminal rows. The words are joined and told
// apart by color: GENTLE in a gray fade, SHELL in Gentle Shell's Gentleman-Sexy pinks,
// from its accent down to its deepPink. Two sizes: artboard 08's letters for
// Gentle Shell fisi/custom's wider rail, and the compact one for the official
// 47-column rail. Narrower rails get one bold text row in the same two colors,
// its letters spaced from 21 columns (design rail-wordmark/10 "Text mark").

type Font = Record<string, string[]>;

// Artboard 08 (.px grid): 4-column letters (L is 3).
const WIDE: Font = {
	G: [".###", "#...", "#.##", "#..#", ".###"],
	E: ["####", "#...", "###.", "#...", "####"],
	N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
	T: ["####", ".##.", ".##.", ".##.", ".##."],
	L: ["#..", "#..", "#..", "#..", "###"],
	S: [".###", "#...", ".##.", "...#", "###."],
	H: ["#..#", "#..#", "####", "#..#", "#..#"],
};

// The wide G, N and L (a 2-column L reads cut off); E, T, S and H narrow, so the
// joined mark is 45 columns and the 47-column rail centers it.
const COMPACT: Font = {
	...WIDE,
	E: ["###", "#..", "##.", "#..", "###"],
	T: ["###", ".#.", ".#.", ".#.", ".#."],
	S: [".##", "#..", ".#.", "..#", "##."],
	H: ["#.#", "#.#", "###", "#.#", "#.#"],
};

/** Each word's color for each pixel row, top to bottom. */
const SHADES: Rgb[][] = [
	// GENTLE: near white down to mid gray.
	[230, 205, 180, 155, 130].map((level): Rgb => [level, level, level]),
	// SHELL: the Gentleman-Sexy accent down to its deepPink.
	[0, 1, 2, 3, 4].map((step): Rgb => palette.sexyPink.map((channel, index) => Math.round(channel + ((palette.sexyDeepPink[index] - channel) * step) / 4)) as unknown as Rgb),
];

const WORDS = ["GENTLE", "SHELL"];

/** Per pixel, the index of the word it lights, or -1 when unlit. One gap column between all letters. */
function pixelGrid(font: Font): number[][] {
	const lit: number[][] = SHADES[0].map(() => []);
	WORDS.join("").split("").forEach((letter, index) => {
		if (index > 0) for (const row of lit) row.push(-1);
		const word = index < WORDS[0].length ? 0 : 1;
		font[letter].forEach((pixels, y) => lit[y].push(...[...pixels].map((pixel) => (pixel === "#" ? word : -1))));
	});
	return lit;
}

const BRAILLE = { upper: "⠛", lower: "⣤", both: "⣿" };

// A cell has one foreground color: the color of its upper lit pixel row.
function pixelLines(font: Font): string[] {
	const grid = pixelGrid(font);
	const lines: string[] = [];
	for (let y = 0; y < grid.length; y += 2) {
		const top = grid[y];
		const bottom = grid[y + 1] ?? [];
		const cells = top.map((upper, x) => {
			const lower = bottom[x] ?? -1;
			if (upper >= 0) return fg(SHADES[upper][y], lower >= 0 ? BRAILLE.both : BRAILLE.upper);
			return lower >= 0 ? fg(SHADES[lower][y + 1], BRAILLE.lower) : " ";
		});
		lines.push(cells.join(""));
	}
	return lines;
}

const WIDE_LINES = pixelLines(WIDE);
const COMPACT_LINES = pixelLines(COMPACT);
const spaced = (word: string) => [...word].join(" ");
// Design rail-wordmark/10 "1 row, spaced": letters one column apart, so the row reads wider.
const SPACED_LINE = bold(fg(SHADES[0][1], `${spaced(WORDS[0])} `) + fg(palette.sexyPink, spaced(WORDS[1])));
const SPACED_WIDTH = spaced(WORDS.join("")).length;
const TEXT_LINE = bold(fg(SHADES[0][2], WORDS[0]) + fg(palette.sexyPink, WORDS[1]));

/** Visible columns of the wide wordmark (51); fisi/custom's 55-column rail fits it with its indent. */
export const LOGO_WIDTH = pixelGrid(WIDE)[0].length;
/** Visible columns of the compact wordmark (45), for the official 47-column rail. */
export const COMPACT_LOGO_WIDTH = pixelGrid(COMPACT)[0].length;

/** The wordmark for `width` columns: wide braille, compact braille, spaced text, joined text, then nothing. */
export function renderLogo(width: number): string[] {
	const columns = Math.max(0, Math.floor(width));
	if (columns >= LOGO_WIDTH) return WIDE_LINES;
	if (columns >= COMPACT_LOGO_WIDTH) return COMPACT_LINES;
	if (columns >= SPACED_WIDTH) return [SPACED_LINE];
	if (columns >= WORDS.join("").length) return [TEXT_LINE];
	return [];
}
