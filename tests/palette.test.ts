import assert from "node:assert/strict";
import test from "node:test";
import { dim, fadeAmount, fadedEdge, fg, palette, panelVivid, tone, vivid, type Rgb } from "../lib/palette.ts";

const rgb = (hex: string): Rgb => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as unknown as Rgb;

// S1: each color keeps its hue and takes the cover title's vividness (#f43888: S 90%, L 59%),
// lighter only where that reads under 4.5:1 on #161616.
test("vivid keeps the hue and takes saturation 90%, lightness 59% or lighter up to 4.5:1 (S1)", () => {
	const examples: [string, string][] = [
		["#e0af68", "#f5a838"], // amber
		["#c3a6ff", "#9464f7"], // lilac
		["#ff9b85", "#f55a38"], // coral
		["#5fd4e0", "#38e3f5"], // teal
		["#f2a7c9", "#f5388e"], // pink
		["#c9779f", "#f53894"], // deepPink
		["#8fc98f", "#38f538"], // green
		["#7b9cff", "#4c76f6"], // blue: lighter until it reads 4.5:1
		["#ff6b6b", "#f53838"], // red
		["#b48cff", "#945ff7"], // purple
		["#ff76c3", "#f538a2"], // rose
	];
	for (const [pastel, expected] of examples) assert.deepEqual([...vivid(rgb(pastel))], [...rgb(expected)], `${pastel} -> ${expected}`);
});

// "aora lo veo en la barra lateral podemos bajar la intensidad un poco?": the side panel's
// titles and counters take 75% of the way from their own color to its vivid one.
test("panelVivid goes 75% of the way from a color to its vivid one", () => {
	const examples: [string, string][] = [
		["#e0af68", "#f0aa44"], // amber
		["#c3a6ff", "#a075f9"], // lilac
		["#ff9b85", "#f86a4b"], // coral
		["#5fd4e0", "#42dff0"], // teal
		["#f2a7c9", "#f4549d"], // pink
		["#8fc98f", "#4eea4e"], // green
		["#7b9cff", "#5880f8"], // blue
		["#ff6b6b", "#f84545"], // red
		["#ff76c3", "#f848aa"], // rose
	];
	for (const [pastel, expected] of examples) assert.deepEqual([...panelVivid(rgb(pastel))], [...rgb(expected)], `${pastel} -> ${expected}`);
});

// Look settings S4, S6: the soft mode paints the plain palette colors, as before 0.3.0; vivid (the default) is today's.
test("S4 labelAccent and panelAccent: vivid and panelVivid by default and in vivid, the color itself in soft", async () => {
	const { labelAccent, panelAccent, palette } = await import("../lib/palette.ts");
	for (const color of [palette.pink, palette.red, palette.blue, palette.coral, palette.rose]) {
		assert.deepEqual([...labelAccent(color)], [...vivid(color)], "default: vivid");
		assert.deepEqual([...labelAccent(color, "vivid")], [...vivid(color)]);
		assert.deepEqual([...labelAccent(color, "soft")], [...color], "soft: the pastel");
		assert.deepEqual([...panelAccent(color)], [...panelVivid(color)], "default: panelVivid");
		assert.deepEqual([...panelAccent(color, "vivid")], [...panelVivid(color)]);
		assert.deepEqual([...panelAccent(color, "soft")], [...color], "soft: the pastel");
	}
});

// --- look-more S4: accents ------------------------------------------------------------

const ACCENT_NAMES = ["pink", "teal", "lilac", "amber", "green"] as const;
const hueOf = (color: Rgb) => {
	const [r, g, b] = color.map((channel) => channel / 255);
	const max = Math.max(r, g, b);
	const spread = max - Math.min(r, g, b);
	const hue = max === r ? ((g - b) / spread) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
	return (hue * 60 + 360) % 360;
};
const hueGap = (a: Rgb, b: Rgb) => Math.min(Math.abs(hueOf(a) - hueOf(b)), 360 - Math.abs(hueOf(a) - hueOf(b)));
const luminance = (color: Rgb) => {
	const [r, g, b] = color.map((channel) => channel / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

test("look-more S4 contrast is the WCAG ratio on the panel background, or on the one given", async () => {
	const { BACKGROUND, contrast } = await import("../lib/palette.ts");
	assert.equal(contrast(BACKGROUND), 1);
	assert.equal(Math.round(contrast([255, 255, 255], [0, 0, 0]) * 100) / 100, 21);
	assert.equal(Math.round(contrast(rgb("#f2a7c9")) * 100) / 100, 9.61, "the soft pink");
	assert.equal(Math.round(contrast(rgb("#f5388e")) * 100) / 100, 5.03, "the vivid pink");
});

test("look-more S4 S7 the pink accent is today's, byte for byte: accentBase is palette.pink, accentLabel is labelAccent(pink), accentTone leaves a color as it is", async () => {
	const { accentBase, accentLabel, accentTone, labelAccent, palette } = await import("../lib/palette.ts");
	assert.deepEqual([...accentBase()], [...palette.pink]);
	assert.deepEqual([...accentBase("pink")], [...palette.pink]);
	for (const mode of ["vivid", "soft"] as const) assert.deepEqual([...accentLabel("pink", mode)], [...labelAccent(palette.pink, mode)], mode);
	assert.deepEqual([...accentLabel()], [...vivid(palette.pink)], "vivid by default");
	for (const color of [palette.deepPink, palette.sexyPink, palette.sexyDeepPink, rgb("#2a2228")]) {
		assert.deepEqual([...accentTone(color)], [...color]);
		assert.deepEqual([...accentTone(color, "pink", "soft")], [...color]);
	}
});

test("look-more S4 each accent's own tone: its palette color (vivid in vivid), on its own hue, never under pink's contrast; one that reads less gets lighter to reach it", async () => {
	const { accentBase, accentLabel, contrast, labelAccent, palette } = await import("../lib/palette.ts");
	for (const mode of ["vivid", "soft"] as const) {
		const floor = contrast(accentLabel("pink", mode));
		for (const accent of ACCENT_NAMES) {
			const tone = accentLabel(accent, mode);
			assert.ok(contrast(tone) >= floor, `${accent} ${mode}: ${contrast(tone)} >= ${floor}`);
			assert.ok(hueGap(tone, palette[accent]) < 2, `${accent} ${mode} keeps its hue`);
			const own = labelAccent(palette[accent], mode);
			if (contrast(own) < floor) {
				assert.ok(luminance(tone) > luminance(own), `${accent} ${mode} lifted`);
				assert.ok(contrast(tone) < floor + 0.15, `${accent} ${mode}: just enough`);
			} else assert.deepEqual([...tone], [...own], `${accent} ${mode}: already reads as well as pink`);
		}
	}
	// Which ones lift: lilac in both modes; amber and green read under the soft pink's 9.61.
	const lifted = (mode: "vivid" | "soft") => ACCENT_NAMES.filter((accent) => contrast(labelAccent(palette[accent], mode)) < contrast(accentLabel("pink", mode)));
	assert.deepEqual(lifted("vivid"), ["lilac"]);
	assert.deepEqual(lifted("soft"), ["lilac", "amber", "green"]);
	for (const accent of ACCENT_NAMES) assert.deepEqual([...accentBase(accent)], [...accentLabel(accent, "soft")], `${accent}: the base is the soft tone`);
});

test("look-more S4 accentTone moves a pink-family color to the accent's hue, keeping how bright it reads", async () => {
	const { accentLabel, accentTone, palette } = await import("../lib/palette.ts");
	for (const mode of ["vivid", "soft"] as const) {
		for (const accent of ACCENT_NAMES.slice(1)) {
			for (const color of [palette.deepPink, vivid(palette.deepPink), palette.sexyPink, palette.sexyDeepPink, rgb("#2a2228")]) {
				const tone = accentTone(color, accent, mode);
				assert.ok(hueGap(tone, accentLabel(accent, mode)) < 6, `${accent} ${mode} ${color}: hue`);
				assert.ok(Math.abs(luminance(tone) - luminance(color)) < 0.006, `${accent} ${mode} ${color}: luminance ${luminance(tone)} ~ ${luminance(color)}`);
			}
		}
	}
});

test("a faded edge colors each glyph by its column of the edge's width, spaces plain, the same on every draw", () => {
	const cell = (column: number, width: number, glyph: string, mode?: "light") => fg(tone(dim(palette.text, fadeAmount(column, width)), mode), glyph);
	for (const mode of [undefined, "light"] as const) {
		for (let draw = 0; draw < 2; draw++) {
			assert.equal(fadedEdge("╭─ ─╮", 0, 10, mode), cell(0, 10, "╭", mode) + cell(1, 10, "─", mode) + " " + cell(3, 10, "─", mode) + cell(4, 10, "╮", mode), `from the first column, draw ${draw}`);
			assert.equal(fadedEdge("─╮", 8, 10, mode), cell(8, 10, "─", mode) + cell(9, 10, "╮", mode), `the edge's last columns, draw ${draw}`);
			assert.equal(fadedEdge("──", 9, 10, mode), cell(9, 10, "─", mode) + cell(10, 10, "─", mode), `a glyph past the width, draw ${draw}`);
			assert.equal(fadedEdge("─", 0, 0, mode), cell(0, 0, "─", mode), `a zero-width edge, draw ${draw}`);
		}
	}
	assert.notEqual(fadedEdge("─", 2, 10), fadedEdge("─", 2, 20), "another width, another fade");
	assert.notEqual(fadedEdge("─", 2, 10), fadedEdge("─", 2, 10, "light"), "light fades toward the light background");
	assert.equal(fadedEdge("", 0, 10), "");
});

test("vivid gives the same color on every call, and a channel past 255 is not taken for another color", () => {
	const first = vivid([95, 212, 224]);
	assert.deepEqual(vivid([95, 212, 224]), first);
	assert.deepEqual(vivid([95, 212, 224]), first);
	// Packed into 24 bits, [200, 40, 376] and [200, 41, 120] are the same number; their hues are far apart.
	const pink = vivid([200, 41, 120]);
	const outside = vivid([200, 40, 376]);
	assert.notDeepEqual(outside, pink);
	assert.deepEqual(vivid([200, 41, 120]), pink);
	assert.deepEqual(vivid([200, 40, 376]), outside);
});
