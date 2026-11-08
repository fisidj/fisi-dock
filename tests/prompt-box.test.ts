import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND, dim, fadeAmount, fgCode, palette, vivid } from "../lib/palette.ts";
import { boxPromptRows, createPromptBox, FRAME_COLUMNS, MIN_BOX_WIDTH, PROMPT_OWNER, wrapPromptFactory } from "../lib/prompt-box.ts";
import { WAVE_STEP_MS } from "../lib/label-wave.ts";
import { SIDEBAR_STATE } from "../lib/slot.ts";
import { visibleWidth } from "../lib/text.ts";

// S88: Gentle Shell's panel-chrome editor paints an open rule (`─ ✿ label ──── hint ─`),
// `› ` rows and a blank last row. Fisi Dock closes it into a box and puts the permission
// mode, model and effort on the rule, keeping Gentle Shell's own label, hint and button.

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

// Gentle Shell paints the petal and label with its theme roles; the fake uses its own codes so
// the test can prove Fisi Dock carries them over instead of repainting them.
const PETAL = "\x1b[38;2;255;118;195m\x1b[1m✿\x1b[22m\x1b[39m";
const gsBorder = (text: string) => `\x1b[38;2;80;80;80m${text}\x1b[39m`;
const gsLabel = (text: string) => `\x1b[2m${text}\x1b[22m`;
const PANEL_BUTTON = "[ Panel ]";

interface GentleOptions {
	label?: string;
	/** The vim mode or esc hint Gentle Shell writes at the right end of its rule. */
	hint?: string;
	/** Narrow chrome: the `[ Panel ]` button at the right end. */
	button?: boolean;
	text?: string[];
	top?: string[];
	autocomplete?: string[];
	/** A non-blank last frame row (a selection label). */
	bottom?: string;
	/** A working label: Gentle Shell's scan wraps each character on its own (lib/shell-prompt.ts scanWorkingText). */
	scan?: boolean;
}

const gsScan = (text: string) => Array.from(text, (char) => `\x1b[90m${char}\x1b[39m`).join("");

/** Gentle Shell's panel rule at `width` (lib/shell-prompt.ts panelPromptRule, restated). */
function gentleRule(width: number, { label = "waiting for input", hint, button, scan }: GentleOptions): string {
	const painted = scan ? gsScan(label) : gsLabel(label);
	if (button) {
		const end = ` ${PANEL_BUTTON}${hint ? ` ${gsLabel(hint)}` : ""} ${gsBorder("─")}`;
		const fill = Math.max(0, width - 4 - visibleWidth(label) - visibleWidth(end));
		return `${gsBorder("─ ")}${PETAL} ${painted}${gsBorder("─".repeat(fill))}${end}`;
	}
	const end = hint ? ` ${gsLabel(hint)} ` : "";
	const fill = width - (2 + 1 + 1 + visibleWidth(label) + 1) - (hint ? visibleWidth(hint) + 2 : 0) - 1;
	// Nothing fits: Gentle Shell paints dashes only.
	if (fill < 1) return gsBorder("─".repeat(width));
	return `${gsBorder("─ ")}${PETAL} ${painted} ${gsBorder("─".repeat(fill))}${end}${gsBorder("─")}`;
}

const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - visibleWidth(text)));

/** Gentle Shell's editor rows at `width`: top rows, the rule, `› ` rows, the blank row, then autocomplete rows. */
function gentleRows(width: number, options: GentleOptions = {}): string[] {
	const text = options.text ?? [""];
	return [
		...(options.top ?? []).map((row) => pad(row, width)),
		gentleRule(width, options),
		...text.map((line, index) => pad(`${index === 0 ? "› " : "  "}${line}`, width)),
		options.bottom === undefined ? " ".repeat(width) : pad(options.bottom, width),
		...(options.autocomplete ?? []).map((row) => pad(`  ${row}`, width)),
	];
}

const LABELS = { mode: "super-yolo", modelId: "claude-opus-5-5", effort: "high" };
const gray = fgCode(palette.frame);

test("the rule row closes the box and carries Gentle Shell's label, then the mode, model and effort (S88)", () => {
	const rows = gentleRows(56, { text: ["hello"] });
	const box = boxPromptRows(rows, 60, 0, LABELS);
	assert.equal(box.boxed, true);
	assert.equal(plain(box.rows[0]), "╭─ ✿ waiting for input ──── ● SUPER-YOLO  opus-5.5 · high ─╮");
	for (const row of box.rows) assert.equal(visibleWidth(row), 60, plain(row));
	const rule = box.rows[0];
	assert.ok(rule.startsWith(`${gray}╭─ `), "the frame in Fisi Dock's gray");
	assert.ok(rule.includes(PETAL), "Gentle Shell's own petal, with its colour");
	assert.ok(rule.includes(gsLabel("waiting for input")), "Gentle Shell's own label, as it painted it");
	assert.ok(rule.includes(`${fgCode(vivid(palette.red))}●`), "a vivid red dot before the mode");
	assert.ok(rule.includes(`\x1b[1m${fgCode(vivid(palette.red))}SUPER-YOLO`), "the mode bold in vivid red, as the prompt line paints it");
	assert.ok(rule.includes(`${fgCode(palette.muted)}opus-5.5`), "the model muted");
	assert.ok(rule.includes(`${fgCode(vivid(palette.blue))}high`), "the effort in vivid blue");
	assert.ok(rule.endsWith(`${gray}─╮\x1b[39m`) || rule.endsWith("─╮\x1b[39m"), JSON.stringify(rule.slice(-40)));
});

test("NORMAL mode shows no dot and no mode; an ODD phase label is carried as Gentle Shell wrote it (S88)", () => {
	const box = boxPromptRows(gentleRows(56, { label: "explore · 0:12" }), 60, 0, { modelId: "claude-opus-5-5", effort: "high" });
	assert.equal(plain(box.rows[0]), `╭─ ✿ explore · 0:12 ${"─".repeat(21)} opus-5.5 · high ─╮`);
	assert.ok(!box.rows[0].includes("●"));
	const noEffort = boxPromptRows(gentleRows(56), 60, 0, { mode: "yolo", modelId: "gpt-5" });
	assert.equal(plain(noEffort.rows[0]), `╭─ ✿ waiting for input ${"─".repeat(20)} ● YOLO  gpt-5 ─╮`);
});

test("the editor's invisible cursor markers take no columns: the right border stays at the edge (S88)", () => {
	// As the real Pi editor paints a focused empty prompt: cursor marker, then the fake cursor between its two markers.
	const markers = "\x1b_pi:c\x07\x1b_pi:fc\x07 \x1b_pi:/fc\x07";
	const rows = gentleRows(56, { text: ["x"] });
	rows[1] = `› ${markers} type, or / for commands${" ".repeat(27)}`;
	const box = boxPromptRows(rows, 60, 0, LABELS);
	assert.equal(box.boxed, true);
	// Measured apart from lib/text.ts, the helper under test: colours and markers out, then count.
	assert.equal(plain(box.rows[1]).replace(/\x1b_[^\x07]*\x07/g, "").length, 60, "the markers count zero columns");
	assert.ok(box.rows[1].includes(markers), "the markers survive, so the terminal cursor still lands");
	assert.ok(plain(box.rows[1]).endsWith(" │"), "the right border at the edge");
});

test("too tight for labels and Gentle Shell's hint together: the labels drop, the hint stays (S88)", () => {
	const options = { label: "implementing · 2:03", hint: "esc again to cancel", button: true, scan: true };
	const box = boxPromptRows(gentleRows(56, options), 60, 0, LABELS);
	const rule = plain(box.rows[0]);
	assert.ok(rule.endsWith(" esc again to cancel ─╮"), rule);
	assert.ok(!rule.includes("SUPER-YOLO"), rule);
	assert.ok(rule.startsWith("╭─ ✿ implementing · 2:03 ─"), rule);
	assert.equal(visibleWidth(rule), 60);
});

test("rows that are not panel chrome render once a frame after the first, so Gentle Shell's animation keeps its speed (S88)", () => {
	let chrome = false;
	const widths: number[] = [];
	const editorLike = Object.assign((_tui: unknown) => ({
		topRowCount: 0,
		render(width: number) {
			widths.push(width);
			return chrome ? gentleRows(width, {}) : [`╭${"─".repeat(width - 2)}╮`, pad("│ hi", width - 1) + "│", `╰${"─".repeat(width - 2)}╯`];
		},
	}), { [PROMPT_OWNER]: true });
	const editor = wrapPromptFactory(editorLike, { painting, labels: () => LABELS })(tuiWith(true), {}, {});
	for (let frame = 0; frame < 4; frame++) editor.render(60);
	assert.deepEqual(widths, [56, 60, 60, 60, 60], "only the first frame tries the box");
	// The chrome comes back: the box returns in that same frame.
	widths.length = 0;
	chrome = true;
	assert.ok(plain(editor.render(60)[0]).startsWith("╭─ ✿"), "boxed again");
	assert.deepEqual(widths, [60, 56]);
	widths.length = 0;
	editor.render(60);
	assert.deepEqual(widths, [56], "one render per boxed frame");
});

test("panel chrome too tight for the bare box renders once a frame until the width changes (S88)", () => {
	const widths: number[] = [];
	const options = { label: "x".repeat(40) };
	const editorLike = Object.assign((_tui: unknown) => ({
		topRowCount: 0,
		render(width: number) {
			widths.push(width);
			const rows = gentleRows(width, {});
			rows[0] = `─ ✿ ${options.label} ─`;
			return rows;
		},
	}), { [PROMPT_OWNER]: true });
	const editor = wrapPromptFactory(editorLike, { painting, labels: () => LABELS })(tuiWith(true), {}, {});
	for (let frame = 0; frame < 3; frame++) editor.render(30);
	assert.deepEqual(widths, [26, 30, 30, 30]);
	widths.length = 0;
	options.label = "x";
	assert.ok(plain(editor.render(70)[0]).startsWith("╭─ ✿"), "a new width tries the box again");
	assert.deepEqual(widths, [66]);
});

test("too tight for the right part: the mode, model and effort drop first, the box stays (S88)", () => {
	// A model too long for the rule even alone: nothing of ours is left to compact to (S3).
	const long = { modelId: "claude-opus-5-5-very-long-preview-build", effort: "high" };
	const box = boxPromptRows(gentleRows(26, { text: ["hi"] }), 30, 0, long);
	assert.equal(box.boxed, true);
	assert.equal(plain(box.rows[0]), "╭─ ✿ waiting for input ──────╮");
	assert.deepEqual(box.rows.map(plain), [
		"╭─ ✿ waiting for input ──────╮",
		"│ › hi                       │",
		"╰────────────────────────────╯",
	]);
	for (const row of box.rows) assert.equal(visibleWidth(row), 30);
	// One column more than the right part needs is enough.
	const fits = boxPromptRows(gentleRows(53), 57, 0, LABELS);
	assert.equal(plain(fits.rows[0]), "╭─ ✿ waiting for input ─ ● SUPER-YOLO  opus-5.5 · high ─╮");
	const short = boxPromptRows(gentleRows(52), 56, 0, LABELS);
	assert.equal(plain(short.rows[0]), `╭─ ✿ ${"─".repeat(18)} ● SUPER-YOLO  opus-5.5 · high ─╮`, "one column less: the idle label's words drop first");
});

test("content rows get `│ ` and ` │`, padded to the width; the blank last row closes the box; a selection label stays on it (S88)", () => {
	const box = boxPromptRows(gentleRows(36, { text: ["first", "", "third"] }), 40, 0, {});
	assert.deepEqual(box.rows.map(plain), [
		"╭─ ✿ waiting for input ────────────────╮",
		"│ › first                              │",
		"│                                      │",
		"│   third                              │",
		"╰──────────────────────────────────────╯",
	]);
	assert.ok(box.rows[1].startsWith(`${gray}│\x1b[39m › first`), "the row keeps Gentle Shell's bytes inside the sides");
	assert.ok(box.rows[1].endsWith(` ${gray}│\x1b[39m`));
	const selected = boxPromptRows(gentleRows(36, { text: ["abc"], bottom: " 3 chars selected - Del deletes - Alt+a select all " }), 40, 0, {});
	assert.equal(plain(selected.rows.at(-1)!), "╰─ 3 chars selected - Del deletes - … ─╯", "the label on the bottom rule, cut to fit");
	assert.equal(visibleWidth(selected.rows.at(-1)!), 40);
	const roomy = boxPromptRows(gentleRows(66, { text: ["abc"], bottom: " 3 chars selected - Del deletes - Alt+a select all " }), 70, 0, {});
	assert.equal(plain(roomy.rows.at(-1)!), `╰─ 3 chars selected - Del deletes - Alt+a select all ${"─".repeat(16)}╯`);
});

test("Gentle Shell's top rows and autocomplete rows are returned untouched, before and after the box (S88)", () => {
	const rows = gentleRows(46, { top: ["✿ work row", "? agent question"], text: ["/do"], autocomplete: ["/dock   the panel", "/dock2  another"] });
	const box = boxPromptRows(rows, 50, 2, {});
	assert.deepEqual(box.rows.slice(0, 2), rows.slice(0, 2), "top rows as Gentle Shell painted them");
	assert.deepEqual(box.rows.slice(-2), rows.slice(-2), "autocomplete rows as Gentle Shell painted them");
	assert.deepEqual(box.rows.slice(2, -2).map(plain), [
		`╭─ ✿ waiting for input ${"─".repeat(26)}╮`,
		`│ › /do${" ".repeat(41)} │`,
		`╰${"─".repeat(48)}╯`,
	]);
	assert.equal(box.rows.length, rows.length, "no row added or removed: Gentle Shell's row coordinates hold");
});

test("Gentle Shell's hint stays after the labels; its `[ Panel ]` button is left out and the rule row keeps clicks (S88)", () => {
	const hinted = boxPromptRows(gentleRows(76, { hint: "esc again to clear" }), 80, 0, LABELS);
	assert.equal(plain(hinted.rows[0]), "╭─ ✿ waiting for input ──── ● SUPER-YOLO  opus-5.5 · high  esc again to clear ─╮");
	assert.ok(hinted.rows[0].includes(gsLabel("esc again to clear")), "the hint as Gentle Shell painted it");
	assert.equal(hinted.buttonDropped, false);
	const gentle = gentleRows(76, { button: true, hint: "INSERT" });
	const box = boxPromptRows(gentle, 80, 0, LABELS);
	assert.equal(plain(box.rows[0]), `╭─ ✿ waiting for input ${"─".repeat(16)} ● SUPER-YOLO  opus-5.5 · high  INSERT ─╮`);
	assert.ok(box.rows[0].includes(gsLabel("INSERT")), "the vim mode as Gentle Shell painted it, without the button before it");
	assert.equal(box.buttonDropped, true);
	assert.equal(box.ruleShift, FRAME_COLUMNS / 2, "the rule shifts like a content row");
	// A rule with only the button: nothing of Gentle Shell's is kept on the right.
	const tight = boxPromptRows(gentleRows(36, { button: true }), 40, 0, {});
	assert.equal(plain(tight.rows[0]), `╭─ ✿ waiting for input ${"─".repeat(16)}╮`);
	assert.equal(tight.buttonDropped, true);
	assert.equal(boxPromptRows(gentleRows(56), 60, 0, LABELS).ruleShift, FRAME_COLUMNS / 2, "without a button the rule shifts like a content row");
});

test("rows that are not Gentle Shell's panel chrome come back unchanged (S88)", () => {
	const neon = ["╭─ ✿ waiting for input ─╮", "│ › hi                 │", "╰──────────────────────╯"];
	const box = boxPromptRows(neon, 28, 0, LABELS);
	assert.equal(box.boxed, false);
	assert.deepEqual(box.rows, neon);
	assert.deepEqual(boxPromptRows(["─".repeat(26), "› ", " ".repeat(26)], 30, 0, LABELS).rows, ["─".repeat(26), "› ", " ".repeat(26)], "the all-dashes rule Gentle Shell paints when nothing fits");
	assert.deepEqual(boxPromptRows([], 60, 0, LABELS).rows, []);
	assert.deepEqual(boxPromptRows([gentleRule(56, {})], 60, 0, LABELS).rows, [gentleRule(56, {})], "a rule with no rows under it");
});

// A Gentle Shell editor as Pi sees it: render at a width, topRowCount after render, handleMouse.
class FakeGentleEditor {
	topRowCount = 0;
	widths: number[] = [];
	mouse: { x: number; y: number; width: number; height: number; type: string; button: string }[] = [];
	private readonly options: GentleOptions;
	constructor(options: GentleOptions) {
		this.options = options;
	}
	render(width: number): string[] {
		this.widths.push(width);
		this.topRowCount = this.options.top?.length ?? 0;
		return gentleRows(width, this.options);
	}
	handleMouse(event: { x: number; y: number; width: number; height: number; type: string; button: string }) {
		this.mouse.push(event);
		return { handled: true };
	}
	setText(_text: string): void {}
}

const markedFactory = (options: GentleOptions = {}) => {
	const editors: FakeGentleEditor[] = [];
	const factory = Object.assign((_tui: unknown, _theme: unknown, _keys: unknown) => {
		const editor = new FakeGentleEditor(options);
		editors.push(editor);
		return editor;
	}, { [PROMPT_OWNER]: true });
	return { factory, editors };
};

const tuiWith = (painting: boolean) => ({ terminal: painting ? { [SIDEBAR_STATE]: { active: true, parts: new Map() } } : {}, requestRender() {} });
const painting = (tui: unknown) => Boolean((tui as { terminal?: Record<symbol, unknown> }).terminal?.[SIDEBAR_STATE]);

test("the wrapper creates Gentle Shell's editor, renders it four columns narrower and boxes it; it carries the owner marker (S88)", () => {
	const gentle = markedFactory({ text: ["hola"], top: ["work row"] });
	const wrapper = wrapPromptFactory(gentle.factory, { painting, labels: () => LABELS });
	assert.equal((wrapper as Record<symbol, unknown>)[PROMPT_OWNER], true, "Gentle Shell's shutdown and reinstall see their own marker");
	const editor = wrapper(tuiWith(true), {}, {}) as FakeGentleEditor;
	assert.equal(gentle.editors.length, 1);
	assert.equal(editor, gentle.editors[0], "Gentle Shell's own editor instance, patched");
	const rows = editor.render(60);
	assert.deepEqual(editor.widths, [56]);
	assert.equal(plain(rows[0]), pad("work row", 56));
	assert.equal(plain(rows[1]), "╭─ ✿ waiting for input ──── ● SUPER-YOLO  opus-5.5 · high ─╮");
	assert.equal(plain(rows[2]), `│ › hola${" ".repeat(50)} │`);
	assert.equal(plain(rows[3]), `╰${"─".repeat(58)}╯`);
});

test("the wrapper leaves Gentle Shell's rows alone without Fisi Dock's sidebar state, under the minimum width, or when the rows are not panel chrome (S88)", () => {
	const gentle = markedFactory({ text: ["x"], label: "wait" });
	const wrapper = wrapPromptFactory(gentle.factory, { painting, labels: () => LABELS });
	const quiet = wrapper(tuiWith(false), {}, {}) as FakeGentleEditor;
	assert.deepEqual(quiet.render(60), gentleRows(60, { text: ["x"], label: "wait" }));
	assert.deepEqual(quiet.widths, [60]);
	const narrow = wrapper(tuiWith(true), {}, {}) as FakeGentleEditor;
	assert.deepEqual(narrow.render(MIN_BOX_WIDTH - 1), gentleRows(MIN_BOX_WIDTH - 1, { text: ["x"], label: "wait" }));
	assert.deepEqual(narrow.widths, [MIN_BOX_WIDTH - 1], "no second render under the minimum");
	assert.ok(narrow.render(MIN_BOX_WIDTH).some((row) => plain(row).startsWith("╭")), "boxed from the minimum width");
	// Neon chrome (regular mode): Gentle Shell's own closed frame comes back at the full width.
	const neon = Object.assign((_tui: unknown) => ({
		topRowCount: 0,
		render: (width: number) => [`╭${"─".repeat(width - 2)}╮`, pad("│ hi", width - 1) + "│", `╰${"─".repeat(width - 2)}╯`],
		handleMouse: () => undefined,
	}), { [PROMPT_OWNER]: true });
	const editor = wrapPromptFactory(neon, { painting, labels: () => LABELS })(tuiWith(true), {}, {});
	assert.deepEqual(editor.render(40), neon(undefined).render(40));
});

test("the wrapper shifts mouse x by the left border and space, clamps at 0, and tells Gentle Shell the narrower width (S88)", () => {
	const gentle = markedFactory({ text: ["hola"], top: ["work row"], button: true });
	const wrapper = wrapPromptFactory(gentle.factory, { painting, labels: () => LABELS });
	const editor = wrapper(tuiWith(true), {}, {}) as FakeGentleEditor;
	const rows = editor.render(70);
	const click = (x: number, y: number) => editor.handleMouse({ x, y, width: 70, height: rows.length, type: "click", button: "left" });
	click(10, 2);
	assert.deepEqual(editor.mouse.at(-1), { x: 8, y: 2, width: 66, height: rows.length, type: "click", button: "left" });
	click(1, 2);
	assert.equal(editor.mouse.at(-1)!.x, 0, "clamped at 0");
	click(5, 0);
	assert.deepEqual(editor.mouse.at(-1), { x: 3, y: 0, width: 66, height: rows.length, type: "click", button: "left" }, "top rows: y untouched");
	// The rule row: Gentle Shell's `[ Panel ]` button was left out, so a click there never reaches it.
	assert.equal(plain(rows[1]).indexOf(PANEL_BUTTON), -1, "no button on our rule");
	const before = editor.mouse.length;
	click(60, 1);
	assert.equal(editor.mouse.length, before, "a rule-row click stays with the box");
	// A rule without the button still forwards rule-row clicks, shifted like a content row.
	const plainGentle = markedFactory({ text: ["hola"], top: ["work row"] });
	const plainEditor = wrapPromptFactory(plainGentle.factory, { painting, labels: () => LABELS })(tuiWith(true), {}, {}) as FakeGentleEditor;
	const plainRows = plainEditor.render(70);
	plainEditor.handleMouse({ x: 10, y: 1, width: 70, height: plainRows.length, type: "click", button: "left" });
	assert.equal(plainEditor.mouse.at(-1)!.x, 8, "rule row shifted by the left border and space");
	// Not boxed (no sidebar state): the event passes through as it came.
	const quiet = wrapper(tuiWith(false), {}, {}) as FakeGentleEditor;
	quiet.render(70);
	quiet.handleMouse({ x: 1, y: 2, width: 70, height: 3, type: "click", button: "left" });
	assert.deepEqual(quiet.mouse.at(-1), { x: 1, y: 2, width: 70, height: 3, type: "click", button: "left" });
});

test("the wrapper reports whether its last render boxed, so the prompt line can step aside (S88)", () => {
	const seen: boolean[] = [];
	const gentle = markedFactory({ text: [""] });
	const wrapper = wrapPromptFactory(gentle.factory, { painting, labels: () => LABELS, onRender: (boxed) => void seen.push(boxed) });
	const editor = wrapper(tuiWith(true), {}, {}) as FakeGentleEditor;
	editor.render(60);
	editor.render(10);
	const quiet = wrapper(tuiWith(false), {}, {}) as FakeGentleEditor;
	quiet.render(60);
	assert.deepEqual(seen, [true, false, false]);
});

function fakeUi(initial?: unknown) {
	let factory = initial;
	const sets: unknown[] = [];
	return {
		getEditorComponent: () => factory,
		setEditorComponent: (next: unknown) => {
			factory = next;
			sets.push(next);
		},
		sets,
	};
}

test("install: only Gentle Shell's marked factory is wrapped; nothing or an unmarked editor stays as it is; restore puts the replaced factory back only while ours is current (S88)", () => {
	const gentle = markedFactory();
	const ui = fakeUi(gentle.factory);
	const box = createPromptBox(ui, { painting, labels: () => LABELS });
	assert.equal(box.ensure(), true);
	const wrapper = ui.getEditorComponent() as Record<symbol, unknown>;
	assert.notEqual(wrapper, gentle.factory);
	assert.equal(wrapper[PROMPT_OWNER], true);
	assert.equal(box.ensure(), true, "already ours");
	assert.equal(ui.sets.length, 1, "installed once");
	box.restore();
	assert.equal(ui.getEditorComponent(), gentle.factory, "Gentle Shell's factory back");
	box.restore();
	assert.equal(ui.sets.length, 2, "a second restore does nothing");

	const empty = fakeUi(undefined);
	assert.equal(createPromptBox(empty, { painting, labels: () => LABELS }).ensure(), false, "no editor yet: nothing installed");
	assert.equal(empty.sets.length, 0);
	const foreign = () => ({ render: () => [], handleMouse: () => undefined });
	const other = fakeUi(foreign);
	assert.equal(createPromptBox(other, { painting, labels: () => LABELS }).ensure(), false, "someone else's editor: untouched");
	assert.equal(other.getEditorComponent(), foreign);

	// Gentle Shell reinstalled its own factory meanwhile: ours is gone, so restore leaves the newer one.
	const again = fakeUi(gentle.factory);
	const second = createPromptBox(again, { painting, labels: () => LABELS });
	second.ensure();
	const newer = markedFactory().factory;
	again.setEditorComponent(newer);
	second.restore();
	assert.equal(again.getEditorComponent(), newer);
	assert.equal(second.ensure(), true, "and ensure wraps the newer one");
	assert.notEqual(again.getEditorComponent(), newer);

	// A ui without the editor API (an older Pi) installs nothing and never throws.
	const bare = createPromptBox({}, { painting, labels: () => LABELS });
	assert.equal(bare.ensure(), false);
	bare.restore();
});

test("boxed(): true only while our wrapper is the current factory and its last render boxed (S88)", () => {
	const gentle = markedFactory({ text: [""] });
	const ui = fakeUi(gentle.factory);
	const box = createPromptBox(ui, { painting, labels: () => LABELS });
	assert.equal(box.boxed(), false);
	box.ensure();
	assert.equal(box.boxed(), false, "not rendered yet");
	const editor = (ui.getEditorComponent() as (tui: unknown, theme: unknown, keys: unknown) => FakeGentleEditor)(tuiWith(true), {}, {});
	editor.render(60);
	assert.equal(box.boxed(), true);
	editor.render(12);
	assert.equal(box.boxed(), false, "the box did not fit: the prompt line is the fallback");
	editor.render(60);
	ui.setEditorComponent(gentle.factory);
	assert.equal(box.boxed(), false, "Gentle Shell took its editor back");
});

// S96: "deberia ser la rosita ODD implenting o exploring segun trabajo". Gentle Shell writes an ODD
// phase as `${phase}…` (lib/odd-phase.ts oddPhaseLabel); the box puts `ODD ` before it, only there.

test("S96 an ODD phase label gets `ODD ` before it, and the right part still drops first at narrow widths", () => {
	const rule = (width: number, options: GentleOptions = {}, labels: object = LABELS) => plain(boxPromptRows(gentleRows(width - FRAME_COLUMNS, options), width, 0, labels).rows[0]);
	const exploring = { label: "exploring…" };
	assert.equal(rule(100, exploring), `╭─ ✿ ODD exploring… ${"─".repeat(47)} ● SUPER-YOLO  opus-5.5 · high ─╮`);
	assert.equal(rule(60, exploring), "╭─ ✿ ODD exploring… ─────── ● SUPER-YOLO  opus-5.5 · high ─╮");
	assert.equal(rule(47, exploring), "╭─ ✿ ODD exploring… ── ● SUPER-YOLO opus-5.5 ─╮", "phone: the labels compact (S3), `ODD` stays");
	for (const phase of ["authorizing", "researching", "deciding", "planning", "implementing", "checking", "closing"]) {
		assert.ok(rule(100, { label: `${phase}…` }).startsWith(`╭─ ✿ ODD ${phase}… ─`), phase);
	}
	for (const width of [100, 60, 47]) assert.equal(visibleWidth(rule(width, exploring)), width);
});

test("S96 with Gentle Shell's hint the labels drop before the hint, then the hint; too tight for `ODD ` the bare label stays boxed (S88)", () => {
	const implementing = { label: "implementing…", hint: "esc again to cancel" };
	const rule = (width: number, options: GentleOptions) => plain(boxPromptRows(gentleRows(width - FRAME_COLUMNS, options), width, 0, LABELS).rows[0]);
	assert.equal(rule(60, implementing), `╭─ ✿ ODD implementing… ${"─".repeat(14)} esc again to cancel ─╮`);
	assert.equal(rule(47, implementing), "╭─ ✿ ODD implementing… ─ esc again to cancel ─╮");
	assert.equal(rule(46, implementing), `╭─ ✿ ODD implementing… ${"─".repeat(7)} ● SUPER-YOLO ─╮`, "no room for the hint: the labels compact to the mode (S3)");
	assert.equal(rule(21, { label: "exploring…" }), "╭─ ✿ exploring… ────╮", "the box beats the prefix");
});

test("S96 no `ODD ` for waiting for input, working, queued or any other label", () => {
	for (const label of ["waiting for input", "working…", "queued", "explore · 0:12", "exploring", "implementi…", "ODD exploring…"]) {
		const row = plain(boxPromptRows(gentleRows(96, { label }), 100, 0, LABELS).rows[0]);
		assert.ok(row.startsWith(`╭─ ✿ ${label} ─`), row);
	}
});

test("S96 without the clock (potato) `ODD ` is painted in Gentle Shell's label gray and its label and petal stay as painted", () => {
	const box = boxPromptRows(gentleRows(56, { label: "checking…" }), 60, 0, LABELS);
	assert.equal(box.scanning, false);
	assert.ok(plain(box.rows[0]).startsWith("╭─ ✿ ODD checking… ─"), plain(box.rows[0]));
	assert.ok(box.rows[0].includes(`${fgCode(palette.muted)}ODD \x1b[39m`), "`ODD ` in the gray of Gentle Shell's label role (muted)");
	assert.ok(box.rows[0].includes(PETAL) && box.rows[0].includes(gsLabel("checking…")), "Gentle Shell's petal and label as painted");
});

// "en el movil no me sale super yolo ni el modelo ni el esfuerso … cuando no estas haciendo nada no
// aparece y cuando empezas a trabjar aparece": Gentle Shell's idle label (lib/shell-prompt.ts
// panelPromptRule, `waiting for input`) is long, so on a phone it pushed the labels off the rule.

const phoneRule = (width: number, options: GentleOptions = {}, labels: object = LABELS) => plain(boxPromptRows(gentleRows(width - FRAME_COLUMNS, options), width, 0, labels).rows[0]);

test("phone: too tight for `waiting for input` and the labels, the idle label's words drop and the petal keeps the labels", () => {
	assert.equal(phoneRule(45), `╭─ ✿ ${"─".repeat(7)} ● SUPER-YOLO  opus-5.5 · high ─╮`);
	assert.equal(phoneRule(50), `╭─ ✿ ${"─".repeat(12)} ● SUPER-YOLO  opus-5.5 · high ─╮`);
	assert.equal(phoneRule(39), "╭─ ✿ ─ ● SUPER-YOLO  opus-5.5 · high ─╮", "one fill column is enough");
	// Gentle Shell's hint stays when it fits too, after the labels; the `[ Panel ]` button is still left out.
	const narrow = { button: true, hint: "INSERT" };
	assert.equal(phoneRule(50, narrow), `╭─ ✿ ${"─".repeat(4)} ● SUPER-YOLO  opus-5.5 · high  INSERT ─╮`);
	assert.equal(phoneRule(45, narrow), `╭─ ✿ ${"─".repeat(7)} ● SUPER-YOLO  opus-5.5 · high ─╮`, "the hint drops before the labels");
	const box = boxPromptRows(gentleRows(41), 45, 0, LABELS);
	assert.equal(box.boxed, true);
	assert.equal(box.ruleShift, FRAME_COLUMNS / 2, "the rule row shifts clicks like a content row");
	assert.ok(box.rows[0].includes(PETAL), "Gentle Shell's own petal, with its colour");
	assert.ok(box.rows[0].includes(`${fgCode(vivid(palette.red))}●`), "the vivid red dot before the mode");
	for (const width of [39, 45, 50]) assert.equal(visibleWidth(phoneRule(width)), width);
	for (const width of [45, 50]) assert.equal(visibleWidth(phoneRule(width, narrow)), width);
});

test("phone: `working…` keeps its words; the labels compact or show exactly as before", () => {
	assert.equal(phoneRule(45, { label: "working…" }), "╭─ ✿ working… ─ ● SUPER-YOLO opus-5.5·high ─╮");
	assert.equal(phoneRule(47, { label: "working…" }), "╭─ ✿ working… ─── ● SUPER-YOLO opus-5.5·high ─╮");
	assert.equal(phoneRule(48, { label: "working…" }), "╭─ ✿ working… ─ ● SUPER-YOLO  opus-5.5 · high ─╮");
	assert.equal(phoneRule(50, { label: "working…" }), `╭─ ✿ working… ${"─".repeat(3)} ● SUPER-YOLO  opus-5.5 · high ─╮`);
	assert.equal(phoneRule(45, { label: "queued" }), "╭─ ✿ queued ─── ● SUPER-YOLO opus-5.5·high ─╮", "queued is a working state: its word stays");
	assert.equal(phoneRule(45, { label: "exploring…" }), `╭─ ✿ ODD exploring… ${"─".repeat(9)} ● SUPER-YOLO ─╮`);
});

test("`waiting for input` keeps its words when the labels fit beside it, and with no labels to keep", () => {
	assert.equal(phoneRule(57), "╭─ ✿ waiting for input ─ ● SUPER-YOLO  opus-5.5 · high ─╮");
	assert.equal(phoneRule(60), "╭─ ✿ waiting for input ──── ● SUPER-YOLO  opus-5.5 · high ─╮");
	assert.equal(phoneRule(45, {}, {}), `╭─ ✿ waiting for input ${"─".repeat(21)}╮`, "no model: nothing to make room for");
	// Labels and hint fit beside it: the bytes are the ones painted before.
	const box = boxPromptRows(gentleRows(76, { hint: "esc again to clear" }), 80, 0, LABELS);
	assert.ok(box.rows[0].includes(gsLabel("waiting for input")), "Gentle Shell's label as it painted it");
	assert.equal(plain(box.rows[0]), "╭─ ✿ waiting for input ──── ● SUPER-YOLO  opus-5.5 · high  esc again to clear ─╮");
});

test("too tight even for the petal and the full labels: the petal keeps the compacted labels (S3)", () => {
	assert.equal(phoneRule(38), "╭─ ✿ ─── ● SUPER-YOLO opus-5.5·high ─╮");
	assert.equal(phoneRule(30), `╭─ ✿ ${"─".repeat(9)} ● SUPER-YOLO ─╮`);
	assert.equal(phoneRule(38, { hint: "INSERT" }), "╭─ ✿ ─── ● SUPER-YOLO opus-5.5·high ─╮", "idle, the labels beat the hint, as at 45");
	// Nothing of ours fits even alone: `waiting for input` stays, as before.
	assert.equal(phoneRule(30, {}, { modelId: "claude-opus-5-5-very-long-preview-build" }), "╭─ ✿ waiting for input ──────╮");
});

// S2: "Gentle Shell en otro idioma o con textos propios: el arreglo del móvil reconoce solo el texto
// exacto `waiting for input`." Gentle Shell paints its idle label whole and every busy label as a
// scan, an ODD phase, `queued` or Pi's scroll indicator: any other whole label is idle, whatever its words.

test("S2 a translated idle label gets the same petal-only rule as `waiting for input`, at every width", () => {
	assert.equal(phoneRule(45, { label: "esperando entrada" }), `╭─ ✿ ${"─".repeat(7)} ● SUPER-YOLO  opus-5.5 · high ─╮`);
	assert.equal(phoneRule(60, { label: "esperando entrada" }), "╭─ ✿ esperando entrada ──── ● SUPER-YOLO  opus-5.5 · high ─╮", "room for both: its words stay");
	// The same length as `waiting for input`: the rule is the same with its words swapped.
	for (let width = 26; width <= 80; width++) {
		for (const options of [{}, { hint: "INSERT" }, { button: true, hint: "INSERT" }]) {
			const english = phoneRule(width, options);
			assert.equal(phoneRule(width, { ...options, label: "esperando entrada" }), english.replace("waiting for input", "esperando entrada"), `${width} ${JSON.stringify(options)}`);
		}
	}
});

test("S2 a clipped idle label (`waiting for i…`, Gentle Shell's narrow fullscreen) and a custom one drop their words like the full one", () => {
	assert.equal(phoneRule(45, { label: "waiting for i…", button: true }), `╭─ ✿ ${"─".repeat(7)} ● SUPER-YOLO  opus-5.5 · high ─╮`);
	assert.equal(phoneRule(50, { label: "type a message to begin" }), `╭─ ✿ ${"─".repeat(12)} ● SUPER-YOLO  opus-5.5 · high ─╮`);
	assert.equal(phoneRule(70, { label: "type a message to begin" }), `╭─ ✿ type a message to begin ${"─".repeat(8)} ● SUPER-YOLO  opus-5.5 · high ─╮`, "room for both: its words stay");
	assert.equal(phoneRule(45, { label: "waiting for i…", button: true }, {}), `╭─ ✿ waiting for i… ${"─".repeat(24)}╮`, "no model: nothing to make room for");
});

test("S2 busy labels keep their words: a scan in any language, `queued`, a clipped busy label, Pi's scroll indicator", () => {
	const box = boxPromptRows(gentleRows(41, { label: "trabajando…", scan: true }), 45, 0, LABELS);
	assert.equal(box.scanning, true);
	assert.equal(plain(box.rows[0]), "╭─ ✿ trabajando… ─── ● SUPER-YOLO opus-5.5 ─╮");
	assert.equal(phoneRule(34, { label: "worki…" }), `╭─ ✿ worki… ${"─".repeat(6)} ● SUPER-YOLO ─╮`, "`working…` clipped, painted without colors");
	assert.equal(phoneRule(34, { label: "implementi…" }), "╭─ ✿ implementi… ─ ● SUPER-YOLO ─╮", "an ODD phase clipped");
	// Gentle Shell shows the editor's `↑ 3 more` instead of its state: text is out of view, so it stays.
	assert.equal(phoneRule(40, { label: "↑ 3 more" }), "╭─ ✿ ↑ 3 more ─ ● SUPER-YOLO opus-5.5 ─╮");
	assert.equal(phoneRule(40, { label: "↓ 12 more" }), `╭─ ✿ ↓ 12 more ${"─".repeat(9)} ● SUPER-YOLO ─╮`);
});

// S3: "Pantallas muy angostas mientras trabaja: por debajo de unas 47 columnas, modo, modelo y
// esfuerzo siguen sin entrar." The labels compact step by step instead of dropping: tight
// separators, then no effort, then the mode alone (the model alone in normal mode).

test("S3 working: each step of the ladder at the width it starts", () => {
	const working = { label: "working…", scan: true };
	assert.equal(phoneRule(48, working), "╭─ ✿ working… ─ ● SUPER-YOLO  opus-5.5 · high ─╮", "full");
	assert.equal(phoneRule(47, working), "╭─ ✿ working… ─── ● SUPER-YOLO opus-5.5·high ─╮", "tight separators");
	assert.equal(phoneRule(45, working), "╭─ ✿ working… ─ ● SUPER-YOLO opus-5.5·high ─╮");
	assert.equal(phoneRule(44, working), `╭─ ✿ working… ${"─".repeat(5)} ● SUPER-YOLO opus-5.5 ─╮`, "no effort");
	assert.equal(phoneRule(40, working), "╭─ ✿ working… ─ ● SUPER-YOLO opus-5.5 ─╮");
	assert.equal(phoneRule(39, working), `╭─ ✿ working… ${"─".repeat(9)} ● SUPER-YOLO ─╮`, "the mode alone");
	assert.equal(phoneRule(31, working), "╭─ ✿ working… ─ ● SUPER-YOLO ─╮");
	assert.equal(phoneRule(30, working), `╭─ ✿ working… ${"─".repeat(15)}╮`, "nothing of ours fits: the words stay");
	for (let width = 26; width <= 60; width++) assert.equal(visibleWidth(phoneRule(width, working)), width, `${width}`);
	const box = boxPromptRows(gentleRows(36, working), 40, 0, LABELS);
	assert.ok(box.rows[0].includes(`${fgCode(vivid(palette.red))}●`) && box.rows[0].includes(`\x1b[1m${fgCode(vivid(palette.red))}SUPER-YOLO`), "the dot and the mode keep their colors");
	assert.ok(box.rows[0].includes(`${fgCode(palette.muted)}opus-5.5`), "the model muted");
	const tight = boxPromptRows(gentleRows(41, working), 45, 0, LABELS).rows[0];
	assert.ok(tight.includes(`${fgCode(palette.faint)}·`) && tight.includes(`${fgCode(vivid(palette.blue))}high`), "the tight dot faint, the effort vivid blue");
});

test("S3 normal mode: the model and effort compact, then the model alone", () => {
	const normal = { modelId: "claude-opus-5-5", effort: "high" };
	const working = { label: "working…", scan: true };
	assert.equal(phoneRule(34, working, normal), "╭─ ✿ working… ─ opus-5.5 · high ─╮");
	assert.equal(phoneRule(33, working, normal), "╭─ ✿ working… ── opus-5.5·high ─╮");
	assert.equal(phoneRule(31, working, normal), `╭─ ✿ working… ${"─".repeat(5)} opus-5.5 ─╮`);
	assert.equal(phoneRule(26, working, normal), `╭─ ✿ working… ${"─".repeat(11)}╮`);
	assert.equal(phoneRule(30, {}, normal), `╭─ ✿ ${"─".repeat(6)} opus-5.5 · high ─╮`, "idle: the petal keeps the full labels");
});

test("S3 idle: below the petal and the full labels, the same ladder", () => {
	assert.equal(phoneRule(39), "╭─ ✿ ─ ● SUPER-YOLO  opus-5.5 · high ─╮");
	assert.equal(phoneRule(36), "╭─ ✿ ─ ● SUPER-YOLO opus-5.5·high ─╮");
	assert.equal(phoneRule(35), `╭─ ✿ ${"─".repeat(5)} ● SUPER-YOLO opus-5.5 ─╮`);
	assert.equal(phoneRule(31), "╭─ ✿ ─ ● SUPER-YOLO opus-5.5 ─╮");
	assert.equal(phoneRule(30), `╭─ ✿ ${"─".repeat(9)} ● SUPER-YOLO ─╮`);
	assert.equal(phoneRule(28), `╭─ ✿ ${"─".repeat(7)} ● SUPER-YOLO ─╮`);
	for (let width = 28; width <= 60; width++) assert.equal(visibleWidth(phoneRule(width)), width, `${width}`);
});

test("S3 with Gentle Shell's hint: each step is tried beside it first; working, the hint beats our labels alone; idle, our labels beat it", () => {
	const working = { label: "working…", scan: true, hint: "INSERT" };
	assert.equal(phoneRule(56, working), "╭─ ✿ working… ─ ● SUPER-YOLO  opus-5.5 · high  INSERT ─╮");
	assert.equal(phoneRule(55, working), "╭─ ✿ working… ─── ● SUPER-YOLO opus-5.5·high  INSERT ─╮");
	assert.equal(phoneRule(50, working), "╭─ ✿ working… ─── ● SUPER-YOLO opus-5.5  INSERT ─╮");
	assert.equal(phoneRule(45, working), `╭─ ✿ working… ${"─".repeat(7)} ● SUPER-YOLO  INSERT ─╮`);
	assert.equal(phoneRule(38, working), `╭─ ✿ working… ${"─".repeat(14)} INSERT ─╮`, "the hint alone beats `● SUPER-YOLO` alone, as it beat the full labels");
	assert.equal(phoneRule(45, { ...working, button: true }), `╭─ ✿ working… ${"─".repeat(7)} ● SUPER-YOLO  INSERT ─╮`, "the `[ Panel ]` button still left out");
	const idle = { hint: "INSERT" };
	assert.equal(phoneRule(44, idle), `╭─ ✿ ${"─".repeat(6)} ● SUPER-YOLO  opus-5.5 · high ─╮`, "the full labels beat the tight ones beside the hint, as before");
	assert.equal(phoneRule(38, idle), "╭─ ✿ ─── ● SUPER-YOLO opus-5.5·high ─╮");
	// Gentle Shell's narrow fullscreen clips its idle label beside `[ Panel ] INSERT` (lib/shell-prompt.ts panelPromptRule).
	assert.equal(phoneRule(34, { label: "waiti…", button: true, hint: "INSERT" }), "╭─ ✿ ──── ● SUPER-YOLO opus-5.5 ─╮");
	for (let width = 28; width <= 60; width++) assert.equal(visibleWidth(phoneRule(width, working)), width, `${width}`);
	for (let width = 36; width <= 60; width++) assert.equal(visibleWidth(phoneRule(width, idle)), width, `${width}`);
});

// Vivid labels S3: the labels Fisi Dock paints on the rule take the vivid version of their color.
test("the mode, its dot and the effort draw vivid, the ODD wave passes in pastel; the model, the frame and Gentle Shell's own colors stay (S3)", () => {
	const box = boxPromptRows(gentleRows(56, { text: ["hello"] }), 60, 0, LABELS);
	assert.equal(plain(box.rows[0]), "╭─ ✿ waiting for input ──── ● SUPER-YOLO  opus-5.5 · high ─╮", "the same words and layout");
	const rule = box.rows[0];
	assert.ok(rule.includes(`${fgCode(vivid(palette.red))}●`), "the dot vivid red");
	assert.ok(rule.includes(`\x1b[1m${fgCode(vivid(palette.red))}SUPER-YOLO`), "the mode bold in vivid red");
	assert.ok(rule.includes(`${fgCode(vivid(palette.blue))}high`), "the effort vivid blue");
	assert.ok(!rule.includes(fgCode(palette.red)) && !rule.includes(fgCode(palette.blue)), "no pastel red or blue left");
	assert.ok(rule.includes(`${fgCode(palette.muted)}opus-5.5`), "the gray model stays muted");
	assert.ok(rule.startsWith(`${gray}╭─ `) && rule.includes(PETAL) && rule.includes(gsLabel("waiting for input")), "the frame, Gentle Shell's petal and label stay");
	// The wave's head and its softer tone, at a moment the head is on `DD `.
	const working = boxPromptRows(gentleRows(56, { label: "checking…", scan: true }), 60, 0, LABELS, WAVE_STEP_MS * 5).rows[0];
	assert.ok(plain(working).startsWith("╭─ ") && plain(working).includes(" ODD checking… "), "the words stay");
	assert.ok(working.includes(`${fgCode(palette.pink)}D`), "the wave's head pastel pink (L9)");
	assert.ok(working.includes(`${fgCode(palette.lilac)}O`), "the wave's softer tone pastel lilac (L9)");
	assert.ok(working.includes(`${fgCode(palette.muted)}c`), "the rest of the wave stays muted");
	// Without the clock the ODD prefix stays muted beside Gentle Shell's own scan.
	const still = boxPromptRows(gentleRows(56, { label: "checking…", scan: true }), 60, 0, LABELS).rows[0];
	assert.ok(still.includes(`${fgCode(palette.muted)}ODD `) && still.includes(gsScan("checking…")), "Gentle Shell's scan as it painted it");
});

// Look settings S4, S6: soft paints the dot, the mode, the effort and the petal in their plain pastels; no mode is vivid, byte for byte.
test("S4 soft colors on the rule: the dot and mode pastel red, the effort pastel blue, the petal pastel; omitting the mode equals vivid (S6)", async () => {
	const { wavePetal } = await import("../lib/label-wave.ts");
	const rows = gentleRows(56, { text: ["hello"] });
	const soft = boxPromptRows(rows, 60, 0, LABELS, undefined, "soft").rows[0];
	assert.ok(soft.includes(`${fgCode(palette.red)}●`), "the dot pastel red");
	assert.ok(soft.includes(`\x1b[1m${fgCode(palette.red)}SUPER-YOLO`), "the mode bold in pastel red");
	assert.ok(soft.includes(`${fgCode(palette.blue)}high`), "the effort pastel blue");
	assert.ok(!soft.includes(fgCode(vivid(palette.red))) && !soft.includes(fgCode(vivid(palette.blue))), "no vivid tone");
	assert.equal(plain(soft), plain(boxPromptRows(rows, 60, 0, LABELS).rows[0]), "same words and layout");
	const at = WAVE_STEP_MS * 5;
	const working = gentleRows(56, { label: "checking…", scan: true });
	assert.ok(boxPromptRows(working, 60, 0, LABELS, at, "soft").rows[0].includes(wavePetal(at, "soft")), "the clock petal in pastel");
	for (const width of [60, 40, 30]) {
		const idle = gentleRows(width - 4, { text: ["hello"] });
		const busy = gentleRows(width - 4, { label: "checking…", scan: true });
		assert.deepEqual(boxPromptRows(idle, width, 0, LABELS), boxPromptRows(idle, width, 0, LABELS, undefined, "vivid"), `idle ${width}`);
		assert.deepEqual(boxPromptRows(busy, width, 0, LABELS, at), boxPromptRows(busy, width, 0, LABELS, at, "vivid"), `working ${width}`);
	}
	// The factory reads the mode per frame from its deps; without it the box paints vivid.
	const factory = () => ({ render: (columns: number) => gentleRows(columns, { text: ["hello"] }) });
	let mode: "vivid" | "soft" = "soft";
	const painted = wrapPromptFactory(factory, { painting: () => true, labels: () => LABELS, colors: () => mode })(undefined, undefined, undefined);
	assert.ok(painted.render(60)[0].includes(`${fgCode(palette.red)}●`), "soft from deps.colors");
	mode = "vivid";
	const vividRule = painted.render(60)[0];
	assert.ok(vividRule.includes(`${fgCode(vivid(palette.red))}●`), "read per frame");
	const defaults = wrapPromptFactory(factory, { painting: () => true, labels: () => LABELS })(undefined, undefined, undefined);
	assert.equal(defaults.render(60)[0], vividRule, "no colors dep: vivid");
});


// --- look-more S3: the prompt box follows `frames` --------------------------------------

/** Each visible cell of `line` with the 24-bit foreground in force on it (undefined after a `39`). */
function cells(line: string): { glyph: string; color: string | undefined }[] {
	const out: { glyph: string; color: string | undefined }[] = [];
	let color: string | undefined;
	for (const match of line.matchAll(/\x1b\[([0-9;]*)m|\x1b_[^\x07]*\x07|\x1b\][^\x07]*\x07|(.)/gsu)) {
		if (match[2] !== undefined) out.push({ glyph: match[2], color });
		else if (match[1]?.startsWith("38;2;")) color = `\x1b[${match[1]}m`;
		else if (match[1] === "39" || match[1] === "0") color = undefined;
	}
	return out;
}
const fade = (index: number, count: number) => fgCode(dim(palette.text, fadeAmount(index, count)));
const FRAME_GLYPHS = new Set([..."╭╮╰╯─│"]);
/** The colors of the frame glyphs on `line`, by column. */
const frameColors = (line: string) => cells(line).flatMap((cell, column) => (FRAME_GLYPHS.has(cell.glyph) ? [[column, cell.color] as const] : []));

test("S3 classic is today's box byte for byte; omitting the style is classic", () => {
	for (const width of [60, 40, 30]) {
		for (const options of [{ text: ["hello"] }, { text: ["a", "b"], hint: "INSERT" }, { text: ["abc"], bottom: " 3 chars selected - Del deletes - Alt+a select all " }, { label: "checking…", scan: true }]) {
			const rows = gentleRows(width - 4, options);
			assert.deepEqual(boxPromptRows(rows, width, 0, LABELS, undefined, undefined, "classic"), boxPromptRows(rows, width, 0, LABELS), `${width} ${JSON.stringify(options)}`);
		}
	}
});

test("S3 faded: classic's geometry and labels; the top and bottom fade by column, the sides by row, corners at the background, mirrored", () => {
	for (const width of [60, 40]) {
		const rows = gentleRows(width - 4, { text: ["hello", "world"] });
		const classic = boxPromptRows(rows, width, 0, LABELS);
		const faded = boxPromptRows(rows, width, 0, LABELS, undefined, undefined, "faded");
		assert.equal(faded.boxed, true);
		assert.deepEqual(faded.rows.map(plain), classic.rows.map(plain), `${width}: same words and places`);
		for (const row of faded.rows) assert.equal(visibleWidth(row), width);
		const height = faded.rows.length;
		for (const index of [0, height - 1]) {
			const colors = frameColors(faded.rows[index]);
			for (const [column, color] of colors) assert.equal(color, fade(column, width), `${width} row ${index} col ${column}`);
			const byColumn = new Map(colors);
			for (const [column, color] of colors) if (byColumn.has(width - 1 - column)) assert.equal(color, byColumn.get(width - 1 - column), "mirrored");
			assert.equal(byColumn.get(0), fgCode(BACKGROUND), "the left corner sinks into the background");
			assert.equal(byColumn.get(width - 1), fgCode(BACKGROUND), "the right corner too");
		}
		for (let index = 1; index < height - 1; index++) {
			const row = cells(faded.rows[index]);
			assert.deepEqual([row[0], row[width - 1]], [{ glyph: "│", color: fade(index, height) }, { glyph: "│", color: fade(index, height) }], `${width} side ${index}`);
			assert.equal(fade(index, height), fade(height - 1 - index, height), "the sides mirror top to bottom");
		}
	}
	const rule = boxPromptRows(gentleRows(56, { text: ["hello"] }), 60, 0, LABELS, undefined, undefined, "faded").rows[0];
	assert.ok(rule.includes(PETAL) && rule.includes(gsLabel("waiting for input")), "Gentle Shell's petal and label as it painted them");
	assert.ok(rule.includes(`${fgCode(vivid(palette.red))}●`) && rule.includes(`${fgCode(vivid(palette.blue))}high`) && rule.includes(`${fgCode(palette.muted)}opus-5.5`), "the labels keep their colors");
	const selected = boxPromptRows(gentleRows(36, { text: ["abc"], bottom: " 3 chars selected - Del deletes - Alt+a select all " }), 40, 0, {}, undefined, undefined, "faded").rows.at(-1)!;
	assert.equal(plain(selected), "╰─ 3 chars selected - Del deletes - … ─╯");
	for (const [column, color] of frameColors(selected)) assert.equal(color, fade(column, 40));
	assert.ok(selected.includes(`${fgCode(palette.muted)}3 chars selected`), "the selection label stays muted");
});

test("S3 faded: the sides follow the box's current height as the text grows", () => {
	const side = (lines: string[]) => {
		const rows = boxPromptRows(gentleRows(36, { text: lines }), 40, 0, {}, undefined, undefined, "faded").rows;
		return rows.slice(1, -1).map((row) => cells(row)[0].color);
	};
	assert.deepEqual(side(["one"]), [fade(1, 3)]);
	assert.deepEqual(side(["one", "two", "three", "four"]), [1, 2, 3, 4].map((index) => fade(index, 6)));
});

test("S3 none: the labels on a fading top rule in their places; no sides, no bottom; the text keeps its columns", () => {
	const at40 = boxPromptRows(gentleRows(36, { text: ["first", "", "third"] }), 40, 0, {}, undefined, undefined, "none");
	assert.equal(at40.boxed, true);
	assert.deepEqual(at40.rows.map(plain), [
		`── ✿ waiting for input ${"─".repeat(17)}`,
		`  ${"› first".padEnd(36)}  `,
		" ".repeat(40),
		`  ${"  third".padEnd(36)}  `,
	]);
	const rows = gentleRows(56, { text: ["hello"], autocomplete: ["/dock   the panel"] });
	const classic = boxPromptRows(rows, 60, 0, LABELS);
	const none = boxPromptRows(rows, 60, 0, LABELS, undefined, undefined, "none");
	assert.deepEqual(none.rows.map(plain), [
		"── ✿ waiting for input ──── ● SUPER-YOLO  opus-5.5 · high ──",
		`  ${"› hello".padEnd(56)}  `,
		plain(rows.at(-1)!),
	]);
	assert.equal(none.rows.length, classic.rows.length - 1, "the bottom border row is gone");
	assert.equal(none.rows.at(-1), rows.at(-1), "the autocomplete row untouched, right under the text");
	assert.equal(plain(none.rows[0]), plain(classic.rows[0]).replace("╭", "─").replace("╮", "─"), "every label in classic's place");
	assert.equal(plain(none.rows[1]), plain(classic.rows[1]).replaceAll("│", " "), "the text in classic's columns");
	assert.ok(none.rows[1].includes(rows[1]), "Gentle Shell's row bytes inside");
	for (const row of none.rows.slice(0, -1)) assert.equal(visibleWidth(row), 60);
	const dashes = frameColors(none.rows[0]);
	assert.equal(dashes.length, 8, "the corners turned dashes, the fill and the end");
	for (const [column, color] of dashes) assert.equal(color, fade(column, 60), `rule col ${column}`);
	assert.equal(new Map(dashes).get(0), fgCode(BACKGROUND), "the rule sinks into the background at its ends");
	assert.ok(none.rows[0].includes(PETAL) && none.rows[0].includes(`${fgCode(vivid(palette.red))}●`), "labels keep their colors");
	assert.ok(!none.rows.slice(1).some((row) => /[│╰╯╭╮]/u.test(plain(row))), "no side or bottom glyph");
	// A selection label keeps its row, without a border, in the bottom rule's place.
	const selected = boxPromptRows(gentleRows(36, { text: ["abc"], bottom: " 3 chars selected - Del deletes - Alt+a select all " }), 40, 0, {}, undefined, undefined, "none");
	assert.equal(plain(selected.rows.at(-1)!), `   ${"3 chars selected - Del deletes - …".padEnd(37)}`);
	assert.equal(selected.rows.length, 3);
	// Gentle Shell's hint stays on the rule.
	assert.equal(plain(boxPromptRows(gentleRows(76, { hint: "esc again to clear" }), 80, 0, LABELS, undefined, undefined, "none").rows[0]), "── ✿ waiting for input ──── ● SUPER-YOLO  opus-5.5 · high  esc again to clear ──");
});

test("S3 the wrapper reads the frames per frame; with none a click under the text reaches Gentle Shell's row under its blank row", () => {
	const gentle = markedFactory({ text: ["hola"], top: ["work row"], autocomplete: ["/dock   the panel"] });
	let frames: "faded" | "classic" | "none" = "classic";
	const editor = wrapPromptFactory(gentle.factory, { painting, labels: () => LABELS, frames: () => frames })(tuiWith(true), {}, {}) as FakeGentleEditor;
	const classic = editor.render(60);
	assert.deepEqual(classic.map(plain), boxPromptRows(gentleRows(56, { text: ["hola"], top: ["work row"], autocomplete: ["/dock   the panel"] }), 60, 1, LABELS).rows.map(plain));
	frames = "faded";
	const faded = editor.render(60);
	assert.notDeepEqual(faded, classic, "faded at once");
	assert.deepEqual(faded.map(plain), classic.map(plain));
	frames = "none";
	const none = editor.render(60);
	assert.equal(none.length, classic.length - 1);
	assert.equal(plain(none[1]).slice(0, 2), "──");
	const click = (y: number) => editor.handleMouse({ x: 10, y, width: 60, height: none.length, type: "click", button: "left" });
	click(2);
	assert.deepEqual(editor.mouse.at(-1), { x: 8, y: 2, width: 56, height: none.length, type: "click", button: "left" }, "the text row as before");
	click(3);
	assert.equal(editor.mouse.at(-1)!.y, 4, "the autocomplete row, past the blank row the box left out");
	click(0);
	assert.equal(editor.mouse.at(-1)!.y, 0, "top rows untouched");
	const defaults = wrapPromptFactory(gentle.factory, { painting, labels: () => LABELS })(tuiWith(true), {}, {});
	assert.deepEqual(defaults.render(60), classic, "no frames dep: classic");
});


// --- look-more S4: the accent on the rule ----------------------------------------------

test("look-more S4 the clock petal and the wave on the rule follow the accent; the red mode dot and the effort stay; omitting the accent is pink (S7)", async () => {
	const { waveLabel, wavePetal } = await import("../lib/label-wave.ts");
	const at = WAVE_STEP_MS * 6;
	const working = gentleRows(56, { label: "checking…", scan: true });
	const idle = gentleRows(56, { text: ["hello"] });
	for (const frames of ["classic", "faded", "none"] as const) {
		for (const colors of ["vivid", "soft"] as const) {
			assert.deepEqual(boxPromptRows(working, 60, 0, LABELS, at, colors, frames, "pink"), boxPromptRows(working, 60, 0, LABELS, at, colors, frames), `${frames} ${colors}: pink working`);
			assert.deepEqual(boxPromptRows(idle, 60, 0, LABELS, undefined, colors, frames, "pink"), boxPromptRows(idle, 60, 0, LABELS, undefined, colors, frames), `${frames} ${colors}: pink idle`);
			for (const accent of ["teal", "green"] as const) {
				const rule = boxPromptRows(working, 60, 0, LABELS, at, colors, frames, accent).rows[0];
				assert.ok(rule.includes(wavePetal(at, colors, accent)), `${frames} ${colors} ${accent}: the petal`);
				assert.ok(rule.includes(waveLabel("ODD checking…", at, accent)), `${frames} ${colors} ${accent}: the wave`);
				const pinkRule = boxPromptRows(working, 60, 0, LABELS, at, colors, frames).rows[0];
				assert.equal(plain(rule), plain(pinkRule));
				assert.notEqual(rule, pinkRule, `${frames} ${colors} ${accent}: repainted`);
				assert.ok(rule.includes(`${fgCode(colors === "soft" ? palette.red : vivid(palette.red))}●`), "the mode dot stays red");
				assert.deepEqual(boxPromptRows(idle, 60, 0, LABELS, undefined, colors, frames, accent), boxPromptRows(idle, 60, 0, LABELS, undefined, colors, frames), `${frames} ${colors} ${accent}: an idle rule has no pink of ours`);
			}
		}
	}
	// The factory reads the accent per frame from its deps; without it the box paints pink.
	let accent: "pink" | "teal" = "teal";
	const factory = () => ({ render: (columns: number) => gentleRows(columns, { label: "checking…", scan: true }) });
	const painted = wrapPromptFactory(factory, { painting: () => true, labels: () => LABELS, waveAt: () => at, accent: () => accent })(undefined, undefined, undefined);
	assert.ok(painted.render(60)[0].includes(wavePetal(at, "vivid", "teal")), "teal from deps.accent");
	accent = "pink";
	const pinkRule = painted.render(60)[0];
	assert.ok(pinkRule.includes(wavePetal(at)), "read per frame");
	const defaults = wrapPromptFactory(factory, { painting: () => true, labels: () => LABELS, waveAt: () => at })(undefined, undefined, undefined);
	assert.equal(defaults.render(60)[0], pinkRule, "no accent dep: pink");
});
