// The prompt box (S88). In its panel chrome (wide rail or narrow fullscreen)
// Gentle Shell's editor paints an open rule (`─ ✿ label ──── hint ─`), `› `
// rows and a blank last row, with its own top rows (work row, agent questions)
// above and Pi's autocomplete rows under. Fisi Dock wraps the editor factory,
// renders Gentle Shell's editor four columns narrower and closes those rows
// into a box: the rule gets corners and, on the right, the permission mode,
// model and effort as the line under the prompt paints them; the rows get
// `│ ` and ` │`; the blank row becomes the bottom rule. Nothing is imported
// from Gentle Shell: its rule is read as text, its label, petal, hint and
// hint are carried over as it painted them, its `[ Panel ]` button (the sheet
// with its rail sections, empty while Fisi Dock paints them) is left out, and rows that do not
// look like its panel chrome come back unchanged. An ODD phase label gets `ODD `
// before it (S96); with the clock the wave sweeps both and the petal turns by
// the same clock (S97).
import { waveLabel, wavePetal } from "./label-wave.ts";
import { fg, palette } from "./palette.ts";
import { promptLineSteps, type PromptLineModel, type PromptLinePart } from "./prompt-line.ts";
import { ellipsize, padEnd, sliceColumns, truncateToWidth, visibleWidth } from "./text.ts";

/** Gentle Shell marks its editor factory with this symbol (extensions/gentle-shell.ts): it steps aside for an unmarked editor and resets only a marked one at shutdown. */
export const PROMPT_OWNER = Symbol.for("gentle-pi.prompt-owner");
/** Narrower than this the box would leave no room for a label: Gentle Shell's rows stay. */
export const MIN_BOX_WIDTH = 20;
/** Columns the frame adds around Gentle Shell's rows: `│ ` and ` │`. */
export const FRAME_COLUMNS = 4;
/** Columns before Gentle Shell's row in a content row: the mouse shift. */
const LEFT_COLUMNS = 2;
const PANEL_BUTTON = "[ Panel ]";
/** Gentle Shell's panel rule: `─ `, the petal, the label, the fill, then its right end (` hint ─`, ` [ Panel ] hint ─`) or nothing. */
const GENTLE_RULE = /^─ (\S) (.*?) ?(─+)(.*)$/u;
const GENTLE_TAIL = /^ (.*) ─$/;
/** Gentle Shell's selection engine writes this on the blank bottom row while text is selected (lib/selection-engine.ts). */
const SELECTION_LABEL = /chars? selected - Del deletes - Alt\+a select all/;
/** Gentle Shell's ODD phases: lib/odd-phase.ts ODD_PHASES, written `${phase}…` by oddPhaseLabel. */
const ODD_PHASES = ["authorizing", "exploring", "researching", "deciding", "planning", "implementing", "checking", "closing"];
const ODD_PHASE_LABEL = new RegExp(`^(?:${ODD_PHASES.join("|")})…$`);
const ODD_PREFIX = "ODD ";
/** Gentle Shell's busy labels it may paint whole (lib/shell-prompt.ts STATE_LABEL, oddPhaseLabel): `queued`, and `working…` or a phase in a theme without colors. */
const BUSY_LABELS = ["working…", "queued", ...ODD_PHASES.map((phase) => `${phase}…`)];
/** Pi's editor scroll indicator (`↑ 3 more`), shown by Gentle Shell instead of its state label (lib/shell-prompt.ts SCROLL_INDICATOR). */
const SCROLL_LABEL = /^[↑↓]/u;
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[_P^X][^\x07\x1b]*(?:\x07|\x1b\\)/g;

const strip = (text: string) => text.replace(ESCAPES, "");
const countEscapes = (text: string) => text.match(ESCAPES)?.length ?? 0;
const frame = (text: string) => fg(palette.frame, text);

export interface PromptBox {
	rows: string[];
	/** False when the rows came back unchanged. */
	boxed: boolean;
	/** Columns to take off a mouse x on the rule row; LEFT_COLUMNS, like a content row. */
	ruleShift: number;
	/** True when Gentle Shell's rule had its `[ Panel ]` button: the box left it out, so clicks on the rule row stay with the box. */
	buttonDropped: boolean;
	/** True when Gentle Shell painted its label as a working scan. */
	scanning: boolean;
}

interface Segment {
	plain: string;
	styled: string;
}

const join = (segments: Segment[], plain: string, styled = plain): Segment => ({
	plain: segments.map((segment) => segment.plain).join(plain),
	styled: segments.map((segment) => segment.styled).join(styled),
});

/** `● SUPER-YOLO  opus-5.5 · high`, or tight `● SUPER-YOLO opus-5.5·high`: the dot in red, the rest as the prompt line paints it. */
function ownSegment(parts: PromptLinePart[], tight: boolean): Segment {
	const mode = parts.find((part) => part.kind === "mode");
	const rest = parts.filter((part) => part.kind !== "mode");
	const dot = tight ? "·" : " · ";
	const segments: Segment[] = [
		...(mode ? [{ plain: `● ${mode.plain}`, styled: `${fg(palette.red, "●")} ${mode.styled}` }] : []),
		...(rest.length ? [join(rest, dot, fg(palette.faint, dot))] : []),
	];
	return join(segments, tight ? " " : "  ");
}

/**
 * The labels at each compact step, widest first (S3): `● SUPER-YOLO  opus-5.5 · high`,
 * `● SUPER-YOLO opus-5.5·high`, `● SUPER-YOLO opus-5.5`, `● SUPER-YOLO` (`opus-5.5` in
 * normal mode); a step that looks like the one before is left out. None without a model.
 */
function ownSteps(labels: PromptLineModel): Segment[] {
	const steps = promptLineSteps(labels);
	if (steps.length === 0) return [];
	const segments = [ownSegment(steps[0], false), ...steps.map((step) => ownSegment(step, true))];
	return segments.filter((segment, index) => segments.findIndex((other) => other.plain === segment.plain) === index);
}

/**
 * True when Gentle Shell's label is its idle one, told by how it is painted, not by its words
 * (S2). Gentle Shell paints a working label as a scan, each character on its own, and its
 * idle label whole. A label painted whole is idle unless it is one of Gentle Shell's busy
 * labels it paints whole too: `queued`, or `working…` and an ODD phase in a theme without
 * colors, each also clipped with `…` (`implementi…`); or Pi's scroll indicator (`↑ 3 more`),
 * which says text is out of view, so it stays. A translated, custom or clipped
 * (`waiting for i…`) idle label is idle. Only a translated `queued` would read as idle: the
 * petal cannot tell it, Gentle Shell's queued petal is `✿` one frame in four.
 */
function isIdleLabel(label: string, scanning: boolean): boolean {
	if (scanning || SCROLL_LABEL.test(label)) return false;
	const stem = label.endsWith("…") ? label.slice(0, -1) : undefined;
	return !BUSY_LABELS.some((busy) => busy === label || (stem !== undefined && busy.startsWith(stem)));
}

/**
 * Close Gentle Shell's editor rows (rendered FRAME_COLUMNS narrower than
 * `width`) into the box. `topRowCount` rows stay above it and the autocomplete
 * rows after its blank row stay under it, both untouched. When the rule is not
 * Gentle Shell's panel rule, no bottom row is found, or even the bare box does
 * not fit, the rows come back unchanged. With `waveAt`, a scanning label keeps its
 * words and takes its color from that moment (S90), and its petal that moment's
 * frame (S97). An ODD phase label gets `ODD ` before it, inside the wave; without
 * `waveAt` in Gentle Shell's label gray (S96). Too tight for `ODD ` the bare label stays.
 * Too tight for an idle label and the labels, the petal alone keeps them (S2); too tight for
 * the full labels even so, they compact step by step (S3).
 */
export function boxPromptRows(rows: string[], width: number, topRowCount: number, labels: PromptLineModel, waveAt?: number): PromptBox {
	const unchanged: PromptBox = { rows, boxed: false, ruleShift: 0, buttonDropped: false, scanning: false };
	const columns = Math.floor(width);
	const top = Math.max(0, Math.min(rows.length, Number.isInteger(topRowCount) ? topRowCount : 0));
	const rule = rows[top];
	if (rule === undefined) return unchanged;
	const plainRule = strip(rule);
	const match = GENTLE_RULE.exec(plainRule);
	if (!match) return unchanged;
	let bottom = -1;
	for (let index = rows.length - 1; index > top; index--) {
		const text = strip(rows[index]).trim();
		if (text === "" || SELECTION_LABEL.test(text)) {
			bottom = index;
			break;
		}
	}
	if (bottom < 0) return unchanged;

	const [, glyph, label, , tail] = match;
	const glyphWidth = visibleWidth(glyph);
	const labelStart = 2 + glyphWidth + 1;
	const labelWidth = visibleWidth(label);
	const gentleLabel = sliceColumns(rule, labelStart, labelStart + labelWidth);
	// Gentle Shell wraps each character of a scanning label on its own, one idle label as a whole (S90).
	const labelEscapes = countEscapes(gentleLabel) - countEscapes(sliceColumns(rule, 0, labelStart));
	const scanning = labelWidth >= 3 && labelEscapes >= labelWidth;
	const wave = scanning && waveAt !== undefined;
	// Every petal frame is one column like Gentle Shell's, so the rule never shifts (S97).
	const clockPetal = wave ? wavePetal(waveAt) : undefined;
	const petal = clockPetal !== undefined && visibleWidth(clockPetal) === glyphWidth ? clockPetal : sliceColumns(rule, 2, 2 + glyphWidth);
	const bare: Segment = { plain: label, styled: wave ? waveLabel(label, waveAt) : gentleLabel };
	const prefixed: Segment | undefined = ODD_PHASE_LABEL.test(label)
		? { plain: ODD_PREFIX + label, styled: wave ? waveLabel(ODD_PREFIX + label, waveAt) : fg(palette.muted, ODD_PREFIX) + gentleLabel }
		: undefined;
	const tailStart = visibleWidth(plainRule) - visibleWidth(tail);
	const tailMatch = GENTLE_TAIL.exec(tail);
	// Gentle Shell's `[ Panel ]` button is left out: it opens its rail sections, empty while Fisi Dock paints them.
	const buttonDropped = tailMatch !== null && tailMatch[1].startsWith(PANEL_BUTTON);
	const tailText = buttonDropped ? tailMatch![1].slice(PANEL_BUTTON.length).trimStart() : (tailMatch?.[1] ?? "");
	const tailFrom = tailStart + 1 + (buttonDropped ? visibleWidth(tailMatch![1]) - visibleWidth(tailText) : 0);
	const gentleRight: Segment | undefined = tailMatch && tailText !== "" ? { plain: tailText, styled: sliceColumns(rule, tailFrom, tailFrom + visibleWidth(tailText)) } : undefined;
	const steps = ownSteps(labels);
	const own = steps[0];
	// The labels drop first, then Gentle Shell's hint; the bare rule last.
	const withOwn = own ? [...(gentleRight ? [join([own, gentleRight], "  ")] : []), own] : [];
	const candidates: (Segment | undefined)[] = [
		...withOwn.slice(0, -1),
		...(gentleRight ? [gentleRight] : []),
		...withOwn.slice(-1),
		undefined,
	];
	let head = bare;
	let right: Segment | undefined;
	let fill = -1;
	/** Takes the first of `choices` that fits after `left` (the petal alone when empty). */
	const fit = (left: Segment, choices: (Segment | undefined)[]): boolean => {
		const headWidth = 3 + glyphWidth + 1 + (left.plain === "" ? 0 : visibleWidth(left.plain) + 1);
		for (const candidate of choices) {
			const rest = columns - headWidth - (candidate ? visibleWidth(candidate.plain) + 4 : 2);
			if (rest >= 1) {
				[head, right, fill] = [left, candidate, rest];
				return true;
			}
		}
		return false;
	};
	if (!(prefixed ? [prefixed, bare] : [bare]).some((left) => fit(left, candidates))) return unchanged;
	// The idle label's words drop before the labels: the petal alone keeps them, with the hint when it fits too.
	const idle = isIdleLabel(label, scanning);
	const petalOnly: Segment = { plain: "", styled: "" };
	if (idle && withOwn.length > 0 && !(right && withOwn.includes(right))) fit(petalOnly, withOwn);
	// Still no room for the full labels: they compact step by step (S3), each step tried beside
	// Gentle Shell's hint first. Beside a busy label the hint alone beats our labels alone, as it
	// beats the full ones; beside an idle label our labels beat the hint, and its words drop first.
	const compact = steps.slice(1);
	const withHint = (step: Segment): Segment[] => (gentleRight ? [join([step, gentleRight], "  ")] : []);
	if (compact.length > 0 && !(right && withOwn.includes(right))) {
		if (idle) compact.some((step) => [...withHint(step), step].some((choice) => fit(bare, [choice]) || fit(petalOnly, [choice])));
		else fit(head, right ? compact.flatMap(withHint) : compact);
	}
	const ruleRow = `${frame("╭─ ")}${petal} ${head.plain === "" ? "" : `${head.styled} `}${frame("─".repeat(fill))}${right ? ` ${right.styled} ${frame("─╮")}` : frame("─╮")}`;
	const ruleShift = LEFT_COLUMNS;

	const inner = columns - FRAME_COLUMNS;
	const side = frame("│");
	const content = rows.slice(top + 1, bottom).map((row) => `${side} ${padEnd(truncateToWidth(row, inner), inner)} ${side}`);
	const selection = strip(rows[bottom]).trim();
	const bottomRow = selection === ""
		? frame(`╰${"─".repeat(columns - 2)}╯`)
		: `${frame("╰─ ")}${fg(palette.muted, ellipsize(selection, columns - 6))} ${frame(`${"─".repeat(Math.max(0, columns - 5 - visibleWidth(ellipsize(selection, columns - 6))))}╯`)}`;
	return { rows: [...rows.slice(0, top), ruleRow, ...content, bottomRow, ...rows.slice(bottom + 1)], boxed: true, ruleShift, buttonDropped, scanning };
}

/** Pi TUI's mouse event, the members the box reads; passed on with the rest untouched. */
interface MouseEvent {
	x: number;
	y: number;
	width: number;
	[key: string]: unknown;
}

/** Gentle Shell's editor, the members the box uses (Pi's EditorComponent plus its `topRowCount`). */
interface Editor {
	render(width: number): string[];
	handleMouse?(event: MouseEvent): unknown;
	topRowCount?: unknown;
}

export type EditorFactory = (tui: unknown, theme: unknown, keybindings: unknown) => Editor;

export interface PromptBoxDeps {
	/** True while Fisi Dock paints on this host (Gentle Shell's sidebar state on its terminal). */
	painting(tui: unknown): boolean;
	/** The permission mode, model and effort for the rule, read per frame. */
	labels(): PromptLineModel;
	/** After each render: whether it boxed the rows. */
	onRender?(boxed: boolean): void;
	/** The moment to paint a scanning label and its petal at; undefined or absent leaves Gentle Shell's colors and petal. */
	waveAt?(): number | undefined;
	/** After each render: whether its boxed label scans. */
	onScanning?(scanning: boolean): void;
}

/** True when the row after `topRowCount` is Gentle Shell's panel rule. */
function isPanelChrome(rows: string[], topRowCount: number): boolean {
	const rule = rows[topRowCount];
	return rule !== undefined && GENTLE_RULE.test(strip(rule));
}

const topRowsOf = (editor: Editor) => (Number.isInteger(editor.topRowCount) ? (editor.topRowCount as number) : 0);

/**
 * A factory that creates Gentle Shell's editor and patches its `render` and
 * `handleMouse` on the instance: the render boxes the rows while Fisi Dock
 * paints and the box fits, otherwise Gentle Shell's rows at the full width; the
 * mouse x loses the left border and space (clamped at 0) and the width the
 * frame, so Gentle Shell's own geometry holds. The factory carries Gentle
 * Shell's owner marker, so its shutdown and reinstall treat it as their own.
 */
export function wrapPromptFactory(original: EditorFactory, deps: PromptBoxDeps): EditorFactory & { [PROMPT_OWNER]: true } {
	const wrapper = (tui: unknown, theme: unknown, keybindings: unknown): Editor => {
		const editor = original(tui, theme, keybindings);
		const render = editor.render;
		const handleMouse = editor.handleMouse;
		let frame = { boxed: false, ruleShift: LEFT_COLUMNS, top: 0, buttonDropped: false };
		// Gentle Shell's render advances its animation on every call, so a frame must
		// not render twice. After a fallback this width renders straight at the full
		// width; `retry`: the fallback was not panel chrome, so the box is tried again
		// the frame the chrome comes back. Panel chrome too tight for the box waits for
		// a new width.
		let direct: { width: number; retry: boolean } | undefined;
		const unboxed = (rows: string[]): string[] => {
			frame = { boxed: false, ruleShift: LEFT_COLUMNS, top: 0, buttonDropped: false };
			deps.onRender?.(false);
			deps.onScanning?.(false);
			return rows;
		};
		editor.render = function (width: number): string[] {
			const columns = Math.floor(width);
			if (columns < MIN_BOX_WIDTH || !deps.painting(tui)) {
				direct = undefined;
				return unboxed(render.call(editor, width));
			}
			let full: string[] | undefined;
			if (direct?.width === columns) {
				full = render.call(editor, width);
				if (!direct.retry || !isPanelChrome(full, topRowsOf(editor))) return unboxed(full);
			}
			const rows = render.call(editor, columns - FRAME_COLUMNS);
			const top = topRowsOf(editor);
			const box = boxPromptRows(rows, columns, top, deps.labels(), deps.waveAt?.());
			if (box.boxed) {
				direct = undefined;
				frame = { boxed: true, ruleShift: box.ruleShift, top, buttonDropped: box.buttonDropped };
				deps.onRender?.(true);
				deps.onScanning?.(box.scanning);
				return box.rows;
			}
			direct = { width: columns, retry: !full && !isPanelChrome(rows, top) };
			return unboxed(full ?? render.call(editor, width));
		};
		if (typeof handleMouse === "function") {
			editor.handleMouse = function (event: MouseEvent): unknown {
				if (!frame.boxed || !event || typeof event !== "object") return handleMouse.call(editor, event);
				// The rule row holds Gentle Shell's dropped `[ Panel ]` button: a click there stays with the box.
				if (event.y === frame.top && frame.buttonDropped) return undefined;
				const shift = event.y === frame.top ? frame.ruleShift : LEFT_COLUMNS;
				return handleMouse.call(editor, { ...event, x: Math.max(0, event.x - shift), width: event.width - FRAME_COLUMNS });
			};
		}
		return editor;
	};
	return Object.assign(wrapper, { [PROMPT_OWNER]: true as const });
}

/** Pi's editor slot (ExtensionContext.ui), the two members the box uses; both optional for an older Pi. */
export interface EditorHost {
	getEditorComponent?(): unknown;
	setEditorComponent?(factory: unknown): void;
}

export interface PromptBoxInstall {
	/** Wrap Gentle Shell's marked factory when it is the current one and not yet ours. True while ours is installed. */
	ensure(): boolean;
	/** Put the replaced factory back, only while ours is still the current one. */
	restore(): void;
	/** True while our wrapper is the current factory and its last render boxed the rows. */
	boxed(): boolean;
}

export function createPromptBox(ui: EditorHost, deps: PromptBoxDeps): PromptBoxInstall {
	let wrapper: EditorFactory | undefined;
	let replaced: unknown;
	let lastBoxed = false;
	const current = (): unknown => {
		try {
			return ui.getEditorComponent?.();
		} catch {
			return undefined;
		}
	};
	const inner: PromptBoxDeps = {
		...deps,
		onRender: (boxed) => {
			lastBoxed = boxed;
			deps.onRender?.(boxed);
		},
	};
	return {
		ensure() {
			const factory = current();
			if (wrapper !== undefined && factory === wrapper) return true;
			if (typeof factory !== "function" || !(factory as Record<symbol, unknown>)[PROMPT_OWNER] || typeof ui.setEditorComponent !== "function") return false;
			const next = wrapPromptFactory(factory as EditorFactory, inner);
			try {
				ui.setEditorComponent(next);
			} catch {
				return false;
			}
			wrapper = next;
			replaced = factory;
			lastBoxed = false;
			return true;
		},
		restore() {
			if (wrapper === undefined) return;
			if (current() === wrapper) {
				try {
					ui.setEditorComponent?.(replaced);
				} catch {
					// Deliberately ignored: the UI may already be gone at shutdown.
				}
			}
			wrapper = undefined;
			replaced = undefined;
			lastBoxed = false;
		},
		boxed: () => lastBoxed && wrapper !== undefined && current() === wrapper,
	};
}
