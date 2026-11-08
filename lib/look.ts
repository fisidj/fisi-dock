// What each user picks for Fisi Dock's look in `/fisi-dock settings` (S1): the rail
// logo, the section frames and the colors. Each list is ordered for the ←→ menu,
// today's look first, so the defaults never change anything (S6).

/** The rail logo options (S2). Provisional until the user picks from design/rail-wordmark. */
export const LOGO_STYLES = ["braille", "text", "none"] as const;
/** Faded boxes (today), the classic flat gray box, or no box (S3). */
export const FRAME_STYLES = ["faded", "classic", "none"] as const;
/** Today's vivid tones or the soft pastels from before 0.3.0 (S4). */
export const COLOR_MODES = ["vivid", "soft"] as const;

export type LogoStyle = (typeof LOGO_STYLES)[number];
export type FrameStyle = (typeof FRAME_STYLES)[number];
export type ColorMode = (typeof COLOR_MODES)[number];

export interface Look {
	logo: LogoStyle;
	frames: FrameStyle;
	colors: ColorMode;
}

export const LOOK_OPTIONS: { readonly [K in keyof Look]: readonly Look[K][] } = { logo: LOGO_STYLES, frames: FRAME_STYLES, colors: COLOR_MODES };

export const DEFAULT_LOOK: Readonly<Look> = { logo: LOGO_STYLES[0], frames: FRAME_STYLES[0], colors: COLOR_MODES[0] };

function pick<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
	return options.includes(value as T) ? (value as T) : fallback;
}

/** A look from anything (a saved file, say): each valid field kept, every other one the default. Never throws. */
export function normalizeLook(value: unknown): Look {
	const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	return {
		logo: pick(LOGO_STYLES, raw.logo, DEFAULT_LOOK.logo),
		frames: pick(FRAME_STYLES, raw.frames, DEFAULT_LOOK.frames),
		colors: pick(COLOR_MODES, raw.colors, DEFAULT_LOOK.colors),
	};
}
