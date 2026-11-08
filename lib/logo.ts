import type { Accent, LogoStyle } from "./look.ts";
import { accentTone, bold, fg, palette, type Rgb } from "./palette.ts";

// The "GENTLESHELL" wordmark in a 5-pixel-tall font, drawn with braille dots
// (S21, design rail-wordmark/04 "Tinted braille"). Each terminal cell holds two
// pixels stacked: the upper pixel is the top two dot rows, the lower pixel the
// bottom two, so 5 pixel rows take 3 terminal rows. The words are joined and told
// apart by color: GENTLE in a gray fade, SHELL in Gentle Shell's Gentleman-Sexy pinks,
// from its accent down to its deepPink. Two sizes: artboard 08's letters for
// Gentle Shell fisi/custom's wider rail, and the compact one for the official
// 47-column rail. Narrower rails get one bold text row in the same two colors,
// its letters spaced from 21 columns (design rail-wordmark/10 "Text mark").
// The look settings (S2) pick this braille logo, the joined text row alone, or none;
// another accent (look-more S4) moves SHELL's pinks to its hue, each as bright as before.

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

/** Each word's color for each pixel row, top to bottom, with SHELL on `accent`. */
function shades(accent: Accent): Rgb[][] {
	const [top, bottom] = [accentTone(palette.sexyPink, accent), accentTone(palette.sexyDeepPink, accent)];
	return [
		// GENTLE: near white down to mid gray.
		[230, 205, 180, 155, 130].map((level): Rgb => [level, level, level]),
		// SHELL: the Gentleman-Sexy accent down to its deepPink.
		[0, 1, 2, 3, 4].map((step): Rgb => top.map((channel, index) => Math.round(channel + ((bottom[index] - channel) * step) / 4)) as unknown as Rgb),
	];
}

const WORDS = ["GENTLE", "SHELL"];

/** Per pixel, the index of the word it lights, or -1 when unlit. One gap column between all letters. */
function pixelGrid(font: Font): number[][] {
	const lit: number[][] = [0, 1, 2, 3, 4].map(() => []);
	WORDS.join("").split("").forEach((letter, index) => {
		if (index > 0) for (const row of lit) row.push(-1);
		const word = index < WORDS[0].length ? 0 : 1;
		font[letter].forEach((pixels, y) => lit[y].push(...[...pixels].map((pixel) => (pixel === "#" ? word : -1))));
	});
	return lit;
}

const BRAILLE = { upper: "⠛", lower: "⣤", both: "⣿" };

// A cell has one foreground color: the color of its upper lit pixel row.
function pixelLines(font: Font, tones: Rgb[][]): string[] {
	const grid = pixelGrid(font);
	const lines: string[] = [];
	for (let y = 0; y < grid.length; y += 2) {
		const top = grid[y];
		const bottom = grid[y + 1] ?? [];
		const cells = top.map((upper, x) => {
			const lower = bottom[x] ?? -1;
			if (upper >= 0) return fg(tones[upper][y], lower >= 0 ? BRAILLE.both : BRAILLE.upper);
			return lower >= 0 ? fg(tones[lower][y + 1], BRAILLE.lower) : " ";
		});
		lines.push(cells.join(""));
	}
	return lines;
}

const spaced = (word: string) => [...word].join(" ");
const SPACED_WIDTH = spaced(WORDS.join("")).length;

interface Marks {
	wide: string[];
	compact: string[];
	/** Design rail-wordmark/10 "1 row, spaced": letters one column apart, so the row reads wider. */
	spaced: string;
	text: string;
}

const MARKS = new Map<Accent, Marks>();

/** Every size of the wordmark with SHELL on `accent`, drawn once per accent. */
function marks(accent: Accent): Marks {
	let drawn = MARKS.get(accent);
	if (!drawn) {
		const tones = shades(accent);
		const shell = accentTone(palette.sexyPink, accent);
		drawn = {
			wide: pixelLines(WIDE, tones),
			compact: pixelLines(COMPACT, tones),
			spaced: bold(fg(tones[0][1], `${spaced(WORDS[0])} `) + fg(shell, spaced(WORDS[1]))),
			text: bold(fg(tones[0][2], WORDS[0]) + fg(shell, WORDS[1])),
		};
		MARKS.set(accent, drawn);
	}
	return drawn;
}

/** Visible columns of the wide wordmark (51); fisi/custom's 55-column rail fits it with its indent. */
export const LOGO_WIDTH = pixelGrid(WIDE)[0].length;
/** Visible columns of the compact wordmark (45), for the official 47-column rail. */
export const COMPACT_LOGO_WIDTH = pixelGrid(COMPACT)[0].length;

/**
 * The wordmark for `width` columns in logo style `style` (look settings S2).
 * braille (the default, S6): wide braille, compact braille, spaced text, joined text, then nothing.
 * text: the joined text row wherever it fits, else what braille draws there. none: nothing.
 * SHELL in `accent` (look-more S4); pink, the default, is Gentle Shell's Gentleman-Sexy pinks.
 */
export function renderLogo(width: number, style: LogoStyle = "braille", accent: Accent = "pink"): string[] {
	const columns = Math.max(0, Math.floor(width));
	if (style === "none") return [];
	const mark = marks(accent);
	if (style === "text" && columns >= WORDS.join("").length) return [mark.text];
	if (columns >= LOGO_WIDTH) return mark.wide;
	if (columns >= COMPACT_LOGO_WIDTH) return mark.compact;
	if (columns >= SPACED_WIDTH) return [mark.spaced];
	if (columns >= WORDS.join("").length) return [mark.text];
	return [];
}
