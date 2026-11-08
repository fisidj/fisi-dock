// What each user picks for Fisi Dock's look in `/fisi-dock settings` (S1): the rail
// logo, the section frames, the colors, the divider and the motion. Each list is ordered for the ←→ menu,
// today's look first, so the defaults never change anything (S6).

/** The rail logo (S2): the shipped braille wordmark, the bold GENTLESHELL text row (design rail-wordmark/10), or none. */
export const LOGO_STYLES = ["braille", "text", "none"] as const;
/** Faded boxes (today), the classic flat gray box, or no box (S3). */
export const FRAME_STYLES = ["faded", "classic", "none"] as const;
/** Today's vivid tones or the soft pastels from before 0.3.0 (S4). */
export const COLOR_MODES = ["vivid", "soft"] as const;
/** The rail divider's brightness (look-more S1): today's medium, none, dimmer or brighter. */
export const DIVIDER_LEVELS = ["medium", "off", "subtle", "strong"] as const;
/** Animations on (today) or off, every animated glyph on one fixed frame (look-more S2). */
export const MOTION_MODES = ["on", "off"] as const;

export type LogoStyle = (typeof LOGO_STYLES)[number];
export type FrameStyle = (typeof FRAME_STYLES)[number];
export type ColorMode = (typeof COLOR_MODES)[number];
export type DividerLevel = (typeof DIVIDER_LEVELS)[number];
export type MotionMode = (typeof MOTION_MODES)[number];

export interface Look {
	logo: LogoStyle;
	frames: FrameStyle;
	colors: ColorMode;
	divider: DividerLevel;
	motion: MotionMode;
}

export const LOOK_OPTIONS: { readonly [K in keyof Look]: readonly Look[K][] } = { logo: LOGO_STYLES, frames: FRAME_STYLES, colors: COLOR_MODES, divider: DIVIDER_LEVELS, motion: MOTION_MODES };

export const DEFAULT_LOOK: Readonly<Look> = { logo: LOGO_STYLES[0], frames: FRAME_STYLES[0], colors: COLOR_MODES[0], divider: DIVIDER_LEVELS[0], motion: MOTION_MODES[0] };

function pick<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
	return options.includes(value as T) ? (value as T) : fallback;
}

/** The Pi theme for color mode `mode` (S4): `Fisi-Dock` with the vivid accents, `Fisi-Dock-Soft` with the pastels from before 0.3.0. */
export function themeNameFor(mode: ColorMode): "Fisi-Dock" | "Fisi-Dock-Soft" {
	return mode === "soft" ? "Fisi-Dock-Soft" : "Fisi-Dock";
}

/** A look from anything (a saved file, say): each valid field kept, every other one the default. Never throws. */
export function normalizeLook(value: unknown): Look {
	const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	return {
		logo: pick(LOGO_STYLES, raw.logo, DEFAULT_LOOK.logo),
		frames: pick(FRAME_STYLES, raw.frames, DEFAULT_LOOK.frames),
		colors: pick(COLOR_MODES, raw.colors, DEFAULT_LOOK.colors),
		divider: pick(DIVIDER_LEVELS, raw.divider, DEFAULT_LOOK.divider),
		motion: pick(MOTION_MODES, raw.motion, DEFAULT_LOOK.motion),
	};
}

/** A short name for `look`, `braille/faded/vivid/medium/on`, for the memo keys and digests of what it paints (S1). */
export function lookKey(look: Look): string {
	return `${look.logo}/${look.frames}/${look.colors}/${look.divider}/${look.motion}`;
}
