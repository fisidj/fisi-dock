// What each user picks for Fisi Dock's look in `/fisi-dock settings` (S1): the rail
// logo, the section frames, the colors, the accent, the divider, the motion and the
// sections shown and their order. Each list is ordered for the ←→ menu,
// today's look first, so the defaults never change anything (S6).

/** The rail logo (S2): the shipped braille wordmark, the bold GENTLESHELL text row (design rail-wordmark/10), or none. */
export const LOGO_STYLES = ["braille", "text", "none"] as const;
/** Faded boxes (today), the classic flat gray box, or no box (S3). */
export const FRAME_STYLES = ["faded", "classic", "none"] as const;
/** Today's vivid tones, the soft pastels from before 0.3.0 (S4), or light, for a light terminal background (look-more S5). */
export const COLOR_MODES = ["vivid", "soft", "light"] as const;
/** Fisi Dock's own pink (today) or another accent for the theme and the panel's pink family (look-more S4). */
export const ACCENTS = ["pink", "teal", "lilac", "amber", "green"] as const;
/** The rail divider's brightness (look-more S1): today's medium, none, dimmer or brighter. */
export const DIVIDER_LEVELS = ["medium", "off", "subtle", "strong"] as const;
/** Animations on (today) or off, every animated glyph on one fixed frame (look-more S2). */
export const MOTION_MODES = ["on", "off"] as const;

/** The rail sections a user can hide or move (look-more S6), in today's order; session is always shown and first, so it is not here. */
export const SECTION_IDS = ["heads-up", "odd", "rdd", "ci", "agents", "todo", "changes"] as const;

export type LogoStyle = (typeof LOGO_STYLES)[number];
export type FrameStyle = (typeof FRAME_STYLES)[number];
export type ColorMode = (typeof COLOR_MODES)[number];
export type Accent = (typeof ACCENTS)[number];
export type DividerLevel = (typeof DIVIDER_LEVELS)[number];
export type MotionMode = (typeof MOTION_MODES)[number];
export type SectionId = (typeof SECTION_IDS)[number];

/** One rail section in the saved order (look-more S6): drawn when shown (and, as today, when it has something to show). */
export interface SectionSetting {
	id: SectionId;
	shown: boolean;
}

export interface Look {
	logo: LogoStyle;
	frames: FrameStyle;
	colors: ColorMode;
	accent: Accent;
	divider: DividerLevel;
	motion: MotionMode;
	/** Every section of SECTION_IDS once, in the order the rail draws them (look-more S6). */
	sections: SectionSetting[];
}

/** The look keys picked with ←→ in the menu: all but sections, which has its own screen (look-more S6). */
export type LookChoice = Exclude<keyof Look, "sections">;

export const LOOK_OPTIONS: { readonly [K in LookChoice]: readonly Look[K][] } = { logo: LOGO_STYLES, frames: FRAME_STYLES, colors: COLOR_MODES, accent: ACCENTS, divider: DIVIDER_LEVELS, motion: MOTION_MODES };

/** Today's sections: every one shown, in today's order (look-more S6, S7). */
export const DEFAULT_SECTIONS: readonly Readonly<SectionSetting>[] = Object.freeze(SECTION_IDS.map((id) => Object.freeze({ id, shown: true })));

export const DEFAULT_LOOK: Readonly<Look> = { logo: LOGO_STYLES[0], frames: FRAME_STYLES[0], colors: COLOR_MODES[0], accent: ACCENTS[0], divider: DIVIDER_LEVELS[0], motion: MOTION_MODES[0], sections: DEFAULT_SECTIONS as SectionSetting[] };

function pick<T extends string, F extends T | undefined>(options: readonly T[], value: unknown, fallback: F): T | F {
	return options.includes(value as T) ? (value as T) : fallback;
}

/**
 * The Pi theme for color mode `mode` and `accent` (S4, look-more S4): `Fisi-Dock` with the vivid
 * accents, `Fisi-Dock-Soft` with the pastels from before 0.3.0; another accent adds its name,
 * `Fisi-Dock-Teal`, `Fisi-Dock-Teal-Soft` (scripts/build-themes.mjs writes them). Light is one
 * theme, `Fisi-Dock-Light`, for every accent (look-more S5).
 */
export function themeNameFor(mode: ColorMode, accent: Accent = "pink"): string {
	if (mode === "light") return LIGHT_THEME;
	const name = accent === "pink" ? "Fisi-Dock" : `Fisi-Dock-${accent[0].toUpperCase()}${accent.slice(1)}`;
	return mode === "soft" ? `${name}-Soft` : name;
}

/** The one light theme (look-more S5): no accents, no soft. */
const LIGHT_THEME = "Fisi-Dock-Light";

/** Every theme Fisi Dock ships, per accent vivid then soft, pink first, then the light one: never remembered as the user's (S95). */
export const FISI_DOCK_THEMES: readonly string[] = [...ACCENTS.flatMap((accent) => (["vivid", "soft"] as const).map((mode) => themeNameFor(mode, accent))), LIGHT_THEME];

/**
 * The sections from anything (look-more S6): the saved order and the hidden ones kept;
 * an unknown id, a repeated one or a bad entry dropped; each missing id after them in
 * today's order, shown. Only `shown: false` hides. Not a list: today's. Fresh entries.
 */
export function normalizeSections(value: unknown): SectionSetting[] {
	const sections: SectionSetting[] = [];
	for (const entry of Array.isArray(value) ? value : []) {
		const raw = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
		const id = pick(SECTION_IDS, raw.id, undefined);
		if (id && !sections.some((section) => section.id === id)) sections.push({ id, shown: raw.shown !== false });
	}
	for (const id of SECTION_IDS) if (!sections.some((section) => section.id === id)) sections.push({ id, shown: true });
	return sections;
}

/** A look from anything (a saved file, say): each valid field kept, every other one the default. Never throws. */
export function normalizeLook(value: unknown): Look {
	const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	return {
		logo: pick(LOGO_STYLES, raw.logo, DEFAULT_LOOK.logo),
		frames: pick(FRAME_STYLES, raw.frames, DEFAULT_LOOK.frames),
		colors: pick(COLOR_MODES, raw.colors, DEFAULT_LOOK.colors),
		accent: pick(ACCENTS, raw.accent, DEFAULT_LOOK.accent),
		divider: pick(DIVIDER_LEVELS, raw.divider, DEFAULT_LOOK.divider),
		motion: pick(MOTION_MODES, raw.motion, DEFAULT_LOOK.motion),
		sections: normalizeSections(raw.sections),
	};
}

/**
 * A short name for `look`, `braille/faded/vivid/pink/medium/on/heads-up,odd,…`, for the memo keys
 * and digests of what it paints (S1): the sections in order, a hidden one with `!` (look-more S6).
 */
export function lookKey(look: Look): string {
	const sections = (look.sections ?? DEFAULT_SECTIONS).map((section) => `${section.shown ? "" : "!"}${section.id}`).join(",");
	return `${look.logo}/${look.frames}/${look.colors}/${look.accent}/${look.divider}/${look.motion}/${sections}`;
}
