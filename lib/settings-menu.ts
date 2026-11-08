// `/fisi-dock settings` (look settings S1): an overlay like /dock with one row per
// look key, the value changed with ←→, and under them the rail in the chosen
// look as a live preview. The render and the key reducer are pure; the
// extension saves and applies each change.
import { type Look, LOOK_OPTIONS } from "./look.ts";
import { bold, fg, palette } from "./palette.ts";
import { DOCK_WIDTH, renderRail } from "./panel.ts";
import type { PanelModel } from "./panel-model.ts";
import { padEnd, truncateToWidth } from "./text.ts";

/** The menu rows, top to bottom. */
export const SETTINGS_ROWS = ["logo", "frames", "colors", "divider", "motion"] as const satisfies readonly (keyof Look)[];

export const SETTINGS_HINT = "↑↓ choose · ←→ change · Esc close";

export interface SettingsState {
	/** The selected row, an index into SETTINGS_ROWS. */
	row: number;
	look: Look;
}

export type SettingsAction = "up" | "down" | "prev" | "next" | "enter" | "close";

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
};

/** The action for raw terminal input `data`: arrows, the vim keys h/j/k/l, Enter, Esc and q; undefined for anything else. */
export function settingsAction(data: string): SettingsAction | undefined {
	return Object.hasOwn(KEYS, data) ? KEYS[data] : undefined;
}

const wrap = (value: number, count: number) => ((value % count) + count) % count;

/** The menu after `action`: up/down move between rows, prev/next (and Enter, forward) cycle the row's options; both wrap. */
export function reduceSettings(state: SettingsState, action: SettingsAction): SettingsStep {
	if (action === "close") return { state, changed: false, close: true };
	if (action === "up" || action === "down") return { state: { ...state, row: wrap(state.row + (action === "up" ? -1 : 1), SETTINGS_ROWS.length) }, changed: false, close: false };
	const key = SETTINGS_ROWS[wrap(state.row, SETTINGS_ROWS.length)];
	const options = LOOK_OPTIONS[key] as readonly string[];
	const value = options[wrap(options.indexOf(state.look[key]) + (action === "prev" ? -1 : 1), options.length)];
	const look = { ...state.look, [key]: value } as Look;
	return { state: { ...state, look }, changed: look[key] !== state.look[key], close: false };
}

/** Columns of the label before each `‹ value ›`. */
const LABEL_WIDTH = 8;
/** Rows above the preview: the title, a blank, the rows and a blank. */
const HEAD_ROWS = 2 + SETTINGS_ROWS.length + 1;
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
	const arrow = (glyph: string) => fg(selected ? palette.pink : palette.faint, glyph);
	return ` ${selected ? fg(palette.pink, "›") : " "} ${selected ? bold(fg(palette.text, label)) : fg(palette.muted, label)}${arrow("‹")} ${fg(palette.text, state.look[key])} ${arrow("›")}`;
}

/**
 * The settings overlay at `width` x `height`: exactly `height` rows of exactly
 * `width` columns. The title, the rows (the selected one marked `›`), then,
 * with `model` and the room for it, the rail in the chosen look, and the hint
 * on the last row. A screen too short for all of it keeps the rows and the hint.
 */
export function renderSettings(state: SettingsState, width: number, height: number, model?: PanelModel): string[] {
	const columns = Math.max(0, Math.floor(width));
	const rows = Math.max(0, Math.floor(height));
	if (columns === 0 || rows === 0) return [];
	const items = SETTINGS_ROWS.map((_, index) => settingsRow(state, index));
	const hint = ` ${fg(palette.muted, SETTINGS_HINT)}`;
	let lines: string[];
	if (rows < HEAD_ROWS + 1) {
		lines = [...items.slice(0, rows - 1), ...Array<string>(Math.max(0, rows - 1 - items.length)).fill(""), hint].slice(-rows);
	} else {
		const room = rows - HEAD_ROWS - 1;
		const previewWidth = Math.min(PREVIEW_WIDTH, columns - 2);
		const preview = model && room >= PREVIEW_MIN_ROWS && previewWidth >= PREVIEW_MIN_WIDTH ? renderRail(model, previewWidth, { maxRows: room, ...state.look }).slice(0, room).map((line) => ` ${line}`) : [];
		lines = [` ${bold(fg(palette.pink, "Fisi Dock look"))}`, "", ...items, "", ...preview, ...Array<string>(room - preview.length).fill(""), hint];
	}
	return lines.map((line) => padEnd(truncateToWidth(line, columns), columns));
}
