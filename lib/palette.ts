// Design 07 palette in 24-bit color. The panel paints with its own accents
// instead of Pi theme roles so each section keeps its hue (S9).
import type { Accent, ColorMode } from "./look.ts";

export type Rgb = readonly [number, number, number];

export const BACKGROUND: Rgb = [0x16, 0x16, 0x16];

export const palette = {
	pink: [0xf2, 0xa7, 0xc9],
	/** The theme's deepPink (mdQuoteBorder): the deepest tone of Gentle Shell's petal. */
	deepPink: [0xc9, 0x77, 0x9f],
	teal: [0x5f, 0xd4, 0xe0],
	coral: [0xff, 0x9b, 0x85],
	amber: [0xe0, 0xaf, 0x68],
	lilac: [0xc3, 0xa6, 0xff],
	green: [0x8f, 0xc9, 0x8f],
	blue: [0x7b, 0x9c, 0xff],
	red: [0xff, 0x6b, 0x6b],
	/** High agent effort (S56). */
	purple: [0xb4, 0x8c, 0xff],
	/** Gentle Shell's Gentleman-Sexy theme accent and its deepPink: the wordmark's SHELL. */
	sexyPink: [0xf4, 0x38, 0x88],
	sexyDeepPink: [0xbf, 0x0f, 0x50],
	/** Gentle Shell's banner rose. */
	rose: [0xff, 0x76, 0xc3],
	text: [0xe1, 0xe1, 0xe1],
	muted: [0x6c, 0x6c, 0x6c],
	faint: [0x4a, 0x4a, 0x4a],
	/** Section frames: one neutral gray, Grok-style, same as Gentle Shell's welcome card frame; titles carry the hue. */
	frame: [0x45, 0x45, 0x45],
	highlight: [0x26, 0x26, 0x26],
} as const satisfies Record<string, Rgb>;

export const RESET = "\x1b[0m";

/** Blend `color` over the panel background, keeping `amount` of the color. */
export function dim(color: Rgb, amount = 0.4): Rgb {
	return color.map((channel, index) => Math.round(channel * amount + BACKGROUND[index] * (1 - amount))) as unknown as Rgb;
}

/** The divider's and the box frames' brightest cell, at their middle: this share of the text color over the background. */
export const FADE_PEAK = 0.35;

/** Cell `index` of a `count`-cell line's share of `peak`: all of it at the middle, easing to 0 at both ends (smoothstep). */
export function fadeAmount(index: number, count: number, peak = FADE_PEAK): number {
	const middle = 1 - Math.abs(((index + 0.5) / count) * 2 - 1);
	return peak * middle * middle * (3 - 2 * middle);
}

/** Frame glyphs `text` starting at column `start` of a `width`-wide edge, each faded by its column (sidebar-chrome); spaces stay plain. */
export function fadedEdge(text: string, start: number, width: number): string {
	return [...text].map((glyph, index) => (glyph === " " ? glyph : fg(dim(palette.text, fadeAmount(start + index, width)), glyph))).join("");
}

/** The WCAG relative luminance of `color`. */
function luminance(color: Rgb): number {
	const [r, g, b] = color.map((channel) => channel / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast of `color` on `background`, the panel background by default. */
export function contrast(color: Rgb, background: Rgb = BACKGROUND): number {
	const [light, dark] = [luminance(color), luminance(background)].sort((a, b) => b - a);
	return (light + 0.05) / (dark + 0.05);
}

/** `color` as HSL: hue in degrees, saturation and lightness from 0 to 1. */
function toHsl(color: Rgb): [number, number, number] {
	const [r, g, b] = color.map((channel) => channel / 255);
	const max = Math.max(r, g, b);
	const spread = max - Math.min(r, g, b);
	let hue = 0;
	if (spread) hue = max === r ? ((g - b) / spread) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
	hue = (hue * 60 + 360) % 360;
	const lightness = (max + max - spread) / 2;
	return [hue, spread ? spread / (1 - Math.abs(2 * lightness - 1)) : 0, lightness];
}

/** The HSL color `hue`, `saturation`, `lightness`, unrounded channels from 0 to 255. */
function hslChannels(hue: number, saturation: number, lightness: number): number[] {
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
	const m = lightness - chroma / 2;
	const sextant = Math.floor(hue / 60);
	const [r1, g1, b1] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sextant];
	return [r1, g1, b1].map((value) => (value + m) * 255);
}

const fromHsl = (hue: number, saturation: number, lightness: number): Rgb => hslChannels(hue, saturation, lightness).map(Math.round) as unknown as Rgb;

/** `color`'s hue at HSL saturation 0.9 and `lightness`. */
function withLightness(color: Rgb, lightness: number): Rgb {
	return fromHsl(toHsl(color)[0], 0.9, lightness);
}

/**
 * The vividness of the cover title #f43888 on `color`'s own hue (vivid labels S1):
 * HSL saturation 90%, lightness 59%; a hue that then reads under 4.5:1 on the
 * background gets lighter in steps of 0.01 until it does, at most 0.80.
 */
export function vivid(color: Rgb): Rgb {
	for (let step = 59; step < 80; step++) {
		const out = withLightness(color, step / 100);
		if (contrast(out) >= 4.5) return out;
	}
	return withLightness(color, 0.8);
}

/** How far the side panel's titles and counters go from their own color toward its vivid one: a little calmer than the prompt labels. */
export const PANEL_VIVIDNESS = 0.75;

/** `color` PANEL_VIVIDNESS of the way to `vivid(color)`: the side panel's titles and counters. */
export function panelVivid(color: Rgb): Rgb {
	const target = vivid(color);
	return color.map((channel, index) => Math.round(channel + (target[index] - channel) * PANEL_VIVIDNESS)) as unknown as Rgb;
}

/** A prompt label in color mode `mode` (look settings S4): vivid(color) in vivid, the default (S6); the color itself in soft, as before 0.3.0. */
export function labelAccent(color: Rgb, mode: ColorMode = "vivid"): Rgb {
	return mode === "soft" ? color : vivid(color);
}

/** A side panel title or counter in color mode `mode` (look settings S4): panelVivid(color) in vivid, the default (S6); the color itself in soft, as before 0.3.0. */
export function panelAccent(color: Rgb, mode: ColorMode = "vivid"): Rgb {
	return mode === "soft" ? color : panelVivid(color);
}

/** `color` itself when it reads `floor` on `background`; else lighter in HSL steps of 0.005, hue and saturation kept, until it does. */
export function liftContrast(color: Rgb, floor: number, background: Rgb = BACKGROUND): Rgb {
	if (contrast(color, background) >= floor) return color;
	const [hue, saturation, lightness] = toHsl(color);
	for (let step = 1; lightness + step * 0.005 < 1; step++) {
		const out = fromHsl(hue, saturation, lightness + step * 0.005);
		if (contrast(out, background) >= floor) return out;
	}
	return fromHsl(hue, saturation, 1);
}

/** `color` on `toward`'s hue: its own HSL saturation and the lightness that keeps its luminance, so it reads as bright as before. */
export function retone(color: Rgb, toward: Rgb): Rgb {
	const [hue] = toHsl(toward);
	const [, saturation] = toHsl(color);
	const target = luminance(color);
	let [low, high] = [0, 1];
	for (let step = 0; step < 40; step++) {
		const middle = (low + high) / 2;
		if (luminance(hslChannels(hue, saturation, middle) as unknown as Rgb) < target) low = middle;
		else high = middle;
	}
	return fromHsl(hue, saturation, (low + high) / 2);
}

/**
 * The accent's own tone in color mode `mode` (look-more S4): labelAccent of its palette color,
 * lifted where it would read under pink's (only lilac). Pink is labelAccent(palette.pink), today's.
 * The accent themes' pink var is this tone too (scripts/build-themes.mjs).
 */
export function accentLabel(accent: Accent = "pink", mode: ColorMode = "vivid"): Rgb {
	return liftContrast(labelAccent(palette[accent], mode), contrast(labelAccent(palette.pink, mode)));
}

/** The accent's pastel (look-more S4), where the panel paints palette.pink as itself: the highlight bar, the wave head, the menu. */
export function accentBase(accent: Accent = "pink"): Rgb {
	return accentLabel(accent, "soft");
}

/** A pink-family `color` (deepPink, the selection tint, the logo's SHELL) on the accent: retone toward accentLabel(accent, mode); pink keeps it as it is. */
export function accentTone(color: Rgb, accent: Accent = "pink", mode: ColorMode = "vivid"): Rgb {
	return accent === "pink" ? color : retone(color, accentLabel(accent, mode));
}

export const fgCode = ([r, g, b]: Rgb) => `\x1b[38;2;${r};${g};${b}m`;
export const bgCode = ([r, g, b]: Rgb) => `\x1b[48;2;${r};${g};${b}m`;

// Style closers reset only their own attribute, so a row background survives.
export const fg = (color: Rgb, text: string) => (text ? `${fgCode(color)}${text}\x1b[39m` : "");
export const bold = (text: string) => (text ? `\x1b[1m${text}\x1b[22m` : "");
