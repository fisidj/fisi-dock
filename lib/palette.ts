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

/** The WCAG contrast of `color` on the panel background. */
function contrast(color: Rgb): number {
	const luminance = (rgb: Rgb) => {
		const [r, g, b] = rgb.map((channel) => channel / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	return (luminance(color) + 0.05) / (luminance(BACKGROUND) + 0.05);
}

/** `color`'s hue at HSL saturation 0.9 and `lightness`. */
function withLightness(color: Rgb, lightness: number): Rgb {
	const [r, g, b] = color.map((channel) => channel / 255);
	const max = Math.max(r, g, b);
	const spread = max - Math.min(r, g, b);
	let hue = 0;
	if (spread) hue = max === r ? ((g - b) / spread) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
	hue = (hue * 60 + 360) % 360;
	const chroma = (1 - Math.abs(2 * lightness - 1)) * 0.9;
	const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
	const m = lightness - chroma / 2;
	const sextant = Math.floor(hue / 60);
	const [r1, g1, b1] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sextant];
	return [r1, g1, b1].map((value) => Math.round((value + m) * 255)) as unknown as Rgb;
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

export const fgCode = ([r, g, b]: Rgb) => `\x1b[38;2;${r};${g};${b}m`;
export const bgCode = ([r, g, b]: Rgb) => `\x1b[48;2;${r};${g};${b}m`;

// Style closers reset only their own attribute, so a row background survives.
export const fg = (color: Rgb, text: string) => (text ? `${fgCode(color)}${text}\x1b[39m` : "");
export const bold = (text: string) => (text ? `\x1b[1m${text}\x1b[22m` : "");
