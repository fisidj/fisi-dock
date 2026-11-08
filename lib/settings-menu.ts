// `/fisi-dock settings` (look settings S1): an overlay like /dock with one row per
// look key, the value changed with ←→, and under them the rail in the chosen
// look as a live preview. The last row, sections, opens a second screen in the
// same overlay to show, hide and move the rail sections (look-more S6). The
// render and the key reducer are pure; the extension saves and applies each change.
import { DEFAULT_SECTIONS, type Look, type LookChoice, LOOK_OPTIONS, type SectionSetting } from "./look.ts";
import { accentBase, bold, fg, paint, palette } from "./palette.ts";
import { DOCK_WIDTH, renderRail } from "./panel.ts";
import type { PanelModel } from "./panel-model.ts";
import { padEnd, truncateToWidth } from "./text.ts";

/** The menu rows, top to bottom; the last one, sections, opens its own screen (look-more S6). */
export const SETTINGS_ROWS = ["logo", "frames", "colors", "accent", "divider", "motion", "sections"] as const satisfies readonly (keyof Look)[];

export const SETTINGS_HINT = "↑↓ choose · ←→ change · Esc close";
/** The sections screen's hint (look-more S6). */
export const SECTIONS_HINT = "space show · shift+↑↓ move · Esc back";

export interface SettingsState {
	/** The selected row, an index into SETTINGS_ROWS. */
	row: number;
	look: Look;
	/** The main rows (the default) or the sections screen (look-more S6). */
	screen?: "main" | "sections";
	/** The selected section on the sections screen, an index into look.sections. */
	item?: number;
}

export type SettingsAction = "up" | "down" | "prev" | "next" | "enter" | "close" | "toggle" | "moveUp" | "moveDown";

export interface SettingsStep {
	state: SettingsState;
	/** The look differs from the one before the key. */
	changed: boolean;
	/** The key closes the menu. */
	close: boolean;
}

const KEYS: Record<string, SettingsAction> = {
	"\x1b[A": "up",
	"\x1bOA": "up",
	k: "up",
	"\x1b[B": "down",
	"\x1bOB": "down",
	j: "down",
	"\x1b[D": "prev",
	"\x1bOD": "prev",
	h: "prev",
	"\x1b[C": "next",
	"\x1bOC": "next",
	l: "next",
	"\r": "enter",
	"\n": "enter",
	"\x1b": "close",
	q: "close",
	" ": "toggle",
	"\x1b[1;2A": "moveUp",
	"\x1b[a": "moveUp",
	K: "moveUp",
	"\x1b[1;2B": "moveDown",
	"\x1b[b": "moveDown",
	J: "moveDown",
};

/**
 * The action for raw terminal input `data`: arrows, the vim keys h/j/k/l, Enter, Esc and q;
 * space, Shift+↑↓ (xterm and rxvt) and K/J for the sections screen (look-more S6); undefined for anything else.
 */
export function settingsAction(data: string): SettingsAction | undefined {
	return Object.hasOwn(KEYS, data) ? KEYS[data] : undefined;
}

const wrap = (value: number, count: number) => ((value % count) + count) % count;

/** The sections of `look`, today's when it has none (a look from before look-more S6). */
const sectionsOf = (look: Look): readonly SectionSetting[] => look.sections ?? DEFAULT_SECTIONS;

/**
 * The sections screen after `action` (look-more S6): up/down move the cursor and wrap; toggle shows or
 * hides the selected section; moveUp/moveDown move it one place, the cursor with it, and stop at the
 * ends; close and prev go back to the main rows. Enter and next do nothing.
 */
function reduceSections(state: SettingsState, action: SettingsAction): SettingsStep {
	const sections = sectionsOf(state.look);
	const item = wrap(state.item ?? 0, sections.length);
	const same = { state, changed: false, close: false };
	if (action === "close" || action === "prev") return { state: { ...state, screen: "main" }, changed: false, close: false };
	if (action === "up" || action === "down") return { state: { ...state, item: wrap(item + (action === "up" ? -1 : 1), sections.length) }, changed: false, close: false };
	if (action === "toggle") {
		const next = sections.map((section, index) => (index === item ? { ...section, shown: !section.shown } : { ...section }));
		return { state: { ...state, item, look: { ...state.look, sections: next } }, changed: true, close: false };
	}
	if (action !== "moveUp" && action !== "moveDown") return same;
	const to = item + (action === "moveUp" ? -1 : 1);
	if (to < 0 || to >= sections.length) return same;
	const next = sections.map((section) => ({ ...section }));
	[next[item], next[to]] = [next[to], next[item]];
	return { state: { ...state, item: to, look: { ...state.look, sections: next } }, changed: true, close: false };
}

/**
 * The menu after `action`: up/down move between rows, prev/next (and Enter, forward) cycle the row's
 * options; both wrap. On the sections row Enter and next open the sections screen (look-more S6).
 */
export function reduceSettings(state: SettingsState, action: SettingsAction): SettingsStep {
	if (state.screen === "sections") return reduceSections(state, action);
	if (action === "close") return { state, changed: false, close: true };
	if (action === "up" || action === "down") return { state: { ...state, row: wrap(state.row + (action === "up" ? -1 : 1), SETTINGS_ROWS.length) }, changed: false, close: false };
	if (action === "toggle" || action === "moveUp" || action === "moveDown") return { state, changed: false, close: false };
	const row = SETTINGS_ROWS[wrap(state.row, SETTINGS_ROWS.length)];
	if (row === "sections") return action === "prev" ? { state, changed: false, close: false } : { state: { ...state, screen: "sections", item: 0 }, changed: false, close: false };
	const key: LookChoice = row;
	const options = LOOK_OPTIONS[key] as readonly string[];
	const value = options[wrap(options.indexOf(state.look[key]) + (action === "prev" ? -1 : 1), options.length)];
	const look = { ...state.look, [key]: value } as Look;
	return { state: { ...state, look }, changed: look[key] !== state.look[key], close: false };
}

/** Columns of the label before each `‹ value ›`. */
const LABEL_WIDTH = 8;
/** Rows above the preview: the title, a blank, the rows (or the sections, look-more S6) and a blank. */
const HEAD_ROWS = 2 + Math.max(SETTINGS_ROWS.length, DEFAULT_SECTIONS.length) + 1;
/** Fewer preview rows than this leaves the preview out. */
const PREVIEW_MIN_ROWS = 4;
/** The preview is the rail as Gentle Shell fisi/custom draws it: the divider, a blank and the dock-width panel. */
const PREVIEW_WIDTH = DOCK_WIDTH + 2;
/** Narrower than this, the preview is left out. */
const PREVIEW_MIN_WIDTH = 20;

function settingsRow(state: SettingsState, index: number): string {
	const key = SETTINGS_ROWS[index];
	const selected = wrap(state.row, SETTINGS_ROWS.length) === index;
	const label = padEnd(key, LABEL_WIDTH);
	const pink = accentBase(state.look.accent);
	const arrow = (glyph: string) => fg(selected ? pink : palette.faint, glyph);
	const head = ` ${selected ? fg(pink, "›") : " "} ${selected ? bold(fg(palette.text, label)) : fg(palette.muted, label)}`;
	if (key === "sections") {
		// How many are shown, under the values above, and a › that opens the screen (look-more S6).
		const sections = sectionsOf(state.look);
		return `${head}  ${fg(palette.text, `${sections.filter((section) => section.shown).length} of ${sections.length}`)} ${arrow("›")}`;
	}
	return `${head}${arrow("‹")} ${fg(palette.text, state.look[key])} ${arrow("›")}`;
}

/** Row `index` of the sections screen (look-more S6): the cursor, `[x]` or `[ ]` and the section. */
function sectionRow(state: SettingsState, index: number): string {
	const sections = sectionsOf(state.look);
	const section = sections[index];
	const selected = wrap(state.item ?? 0, sections.length) === index;
	const pink = accentBase(state.look.accent);
	const box = section.shown ? fg(selected ? pink : palette.text, "[x]") : fg(palette.faint, "[ ]");
	return ` ${selected ? fg(pink, "›") : " "} ${box} ${selected ? bold(fg(palette.text, section.id)) : fg(palette.muted, section.id)}`;
}

/**
 * The settings overlay at `width` x `height`: exactly `height` rows of exactly
 * `width` columns. The title, the rows (the selected one marked `›`), then,
 * with `model` and the room for it, the rail in the chosen look, and the hint
 * on the last row. A screen too short for all of it keeps the rows and the hint. Light colors
 * paint the menu for a light background, like the preview (look-more S5). The sections screen
 * lists the sections in place of the rows, with its own title and hint (look-more S6).
 */
export function renderSettings(state: SettingsState, width: number, height: number, model?: PanelModel): string[] {
	const columns = Math.max(0, Math.floor(width));
	const rows = Math.max(0, Math.floor(height));
	if (columns === 0 || rows === 0) return [];
	const own = (line: string) => paint(line, state.look.colors);
	const onSections = state.screen === "sections";
	const items = onSections ? sectionsOf(state.look).map((_, index) => own(sectionRow(state, index))) : SETTINGS_ROWS.map((_, index) => own(settingsRow(state, index)));
	const hint = own(` ${fg(palette.muted, onSections ? SECTIONS_HINT : SETTINGS_HINT)}`);
	const title = own(` ${bold(fg(accentBase(state.look.accent), "Fisi Dock look"))}${onSections ? ` ${fg(palette.faint, "›")} ${bold(fg(palette.text, "sections"))}` : ""}`);
	let lines: string[];
	if (rows < HEAD_ROWS + 1) {
		lines = [...items.slice(0, rows - 1), ...Array<string>(Math.max(0, rows - 1 - items.length)).fill(""), hint].slice(-rows);
	} else {
		const room = rows - HEAD_ROWS - 1;
		const previewWidth = Math.min(PREVIEW_WIDTH, columns - 2);
		const preview = model && room >= PREVIEW_MIN_ROWS && previewWidth >= PREVIEW_MIN_WIDTH ? renderRail(model, previewWidth, { maxRows: room, ...state.look }).slice(0, room).map((line) => ` ${line}`) : [];
		lines = [title, "", ...items, ...Array<string>(HEAD_ROWS - 3 - items.length).fill(""), "", ...preview, ...Array<string>(room - preview.length).fill(""), hint];
	}
	return lines.map((line) => padEnd(truncateToWidth(line, columns), columns));
}
