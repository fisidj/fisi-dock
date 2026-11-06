// Design 07 palette in 24-bit color. The panel paints with its own accents
// instead of Pi theme roles so each section keeps its hue (S9).

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

export const fgCode = ([r, g, b]: Rgb) => `\x1b[38;2;${r};${g};${b}m`;
export const bgCode = ([r, g, b]: Rgb) => `\x1b[48;2;${r};${g};${b}m`;

// Style closers reset only their own attribute, so a row background survives.
export const fg = (color: Rgb, text: string) => (text ? `${fgCode(color)}${text}\x1b[39m` : "");
export const bold = (text: string) => (text ? `\x1b[1m${text}\x1b[22m` : "");
