import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND, dim, fadeAmount, fgCode, palette, vivid } from "../lib/palette.ts";
import { visibleWidth } from "../lib/text.ts";
import { frameUserLines, installUserFrame, USER_FRAME_HOOK } from "../lib/user-frame.ts";

// S45: the user's own messages sit in a gray box with `you` on the top rule,
// like the prompt box, so they stand out from tool blocks of the same gray.

const plain = (line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\]133;[ABC]\x07/g, "");
const ZONE_START = "\x1b]133;A\x07";
const ZONE_END = "\x1b]133;B\x07\x1b]133;C\x07";
const BG = "\x1b[48;2;31;31;31m";

/** Pi's user message at `width`: a padding row, the text rows, a padding row, all on the message background, with prompt-zone marks. */
function piUserMessage(text: string[]) {
	return (width: number) => {
		const row = (content: string) => `${BG}${content}${" ".repeat(Math.max(0, width - content.length))}\x1b[49m`;
		const lines = [row(""), ...text.map((line) => row(` ${line}`)), row("")];
		lines[0] = ZONE_START + lines[0];
		lines[lines.length - 1] = ZONE_END + lines[lines.length - 1];
		return lines;
	};
}

test("a user message is boxed in gray with `you` on the top rule; padding rows go (S45)", () => {
	const lines = frameUserLines(piUserMessage(["hola, una cosa"]), 30);
	assert.deepEqual(lines.map(plain), [
		"╭─ you ──────────────────────╮",
		"│ hola, una cosa             │",
		"╰────────────────────────────╯",
	]);
	for (const line of lines) assert.equal(visibleWidth(line), 30);
	const gray = fgCode(palette.frame);
	assert.ok(lines[0].startsWith(`${ZONE_START}${gray}╭─ `), "the prompt zone opens with the box");
	assert.ok(lines[2].startsWith(`${ZONE_END}${gray}╰`), "and closes with it");
	assert.ok(lines[0].includes(`${fgCode(vivid(palette.pink))}you`), "`you` in the vivid brand pink");
	assert.ok(lines[1].startsWith(`${gray}│\x1b[39m${BG}`), "the message keeps its own background inside the gray sides");
	assert.ok(lines[1].endsWith(`${gray}│\x1b[39m`));
	assert.equal(lines.filter((line) => line.includes("\x1b]133;")).length, 2, "each mark once");
});

test("multi-line messages keep every row; the text renders two columns narrower (S45)", () => {
	const widths: number[] = [];
	const render = piUserMessage(["first line", "", "third line"]);
	const lines = frameUserLines((width) => (widths.push(width), render(width)), 24);
	assert.deepEqual(widths, [22]);
	assert.deepEqual(lines.map(plain), [
		"╭─ you ────────────────╮",
		"│ first line           │",
		"│                      │",
		"│ third line           │",
		"╰──────────────────────╯",
	]);
});

test("too narrow for a box, or nothing rendered: Pi's lines unchanged (S45)", () => {
	const render = piUserMessage(["hi"]);
	assert.deepEqual(frameUserLines(render, 9), render(9));
	assert.deepEqual(frameUserLines(() => [], 40), []);
});

class Container {
	children: unknown[] = [];
	render(_width: number): string[] {
		return [];
	}
}
class UserMessageComponent extends Container {
	override render(width: number): string[] {
		return piUserMessage(["mine"])(width);
	}
}

test("install finds Pi's user message class in the TUI tree, patches it once, and only frames while the hook is set (S45)", (t) => {
	t.after(() => delete (globalThis as Record<symbol, unknown>)[USER_FRAME_HOOK]);
	const message = new UserMessageComponent();
	const chat = new Container();
	chat.children.push(new Container(), message);
	const tui = new Container();
	tui.children.push(new Container(), chat);
	const original = UserMessageComponent.prototype.render;

	assert.equal(installUserFrame(new Container()), false, "no user message on screen yet");
	assert.equal(UserMessageComponent.prototype.render, original);
	assert.equal(installUserFrame(tui), true);
	const patched = UserMessageComponent.prototype.render;
	assert.equal(installUserFrame(tui), true, "already patched");
	assert.equal(UserMessageComponent.prototype.render, patched, "patched only once");

	assert.deepEqual(message.render(20), original.call(message, 20), "no hook: Pi's lines");
	(globalThis as Record<symbol, unknown>)[USER_FRAME_HOOK] = frameUserLines;
	assert.equal(plain(message.render(20)[0]), "╭─ you ────────────╮");
	(globalThis as Record<symbol, unknown>)[USER_FRAME_HOOK] = () => {
		throw new Error("broken hook");
	};
	assert.deepEqual(message.render(20), original.call(message, 20), "a throwing hook falls back to Pi's lines");
});

// Look settings S4, S6: soft paints `you` in the plain pink of before 0.3.1; no mode is vivid, byte for byte.
test("S4 soft colors draw `you` in the pastel pink; omitting the mode equals vivid (S6)", () => {
	const render = piUserMessage(["hola"]);
	const soft = frameUserLines(render, 30, "soft");
	assert.ok(soft[0].includes(`${fgCode(palette.pink)}you`), "`you` in the pastel pink");
	assert.ok(!soft[0].includes(fgCode(vivid(palette.pink))), "no vivid pink");
	assert.deepEqual(frameUserLines(render, 30), frameUserLines(render, 30, "vivid"));
	assert.ok(frameUserLines(render, 30, "vivid")[0].includes(`${fgCode(vivid(palette.pink))}you`));
	assert.deepEqual(soft.map(plain), frameUserLines(render, 30).map(plain), "same words and layout");
});

// --- look-more S3: the user's box follows `frames` --------------------------------------

/** Each visible cell of `line` with the 24-bit foreground in force on it (undefined after a `39`). */
function cells(line: string): { glyph: string; color: string | undefined }[] {
	const out: { glyph: string; color: string | undefined }[] = [];
	let color: string | undefined;
	for (const match of line.matchAll(/\x1b\[([0-9;]*)m|\x1b\][^\x07]*\x07|(.)/gsu)) {
		if (match[2] !== undefined) out.push({ glyph: match[2], color });
		else if (match[1]?.startsWith("38;2;")) color = `\x1b[${match[1]}m`;
		else if (match[1] === "39" || match[1] === "0") color = undefined;
	}
	return out;
}
const fade = (index: number, count: number) => fgCode(dim(palette.text, fadeAmount(index, count)));
const FRAME_GLYPHS = new Set([..."╭╮╰╯─│"]);
const frameColors = (line: string) => cells(line).flatMap((cell, column) => (FRAME_GLYPHS.has(cell.glyph) ? [[column, cell.color] as const] : []));
const marks = (lines: string[]) => lines.flatMap((line, index) => [...line.matchAll(/\x1b\]133;([ABC])\x07/g)].map((match) => `${index}${match[1]}`));

test("S3 classic is today's box byte for byte; omitting the style is classic", () => {
	for (const text of [["hola, una cosa"], ["first line", "", "third line"]]) {
		for (const width of [30, 24, 12]) {
			const render = piUserMessage(text);
			assert.deepEqual(frameUserLines(render, width, undefined, "classic"), frameUserLines(render, width), `${width}`);
			assert.deepEqual(frameUserLines(render, width, "soft", "classic"), frameUserLines(render, width, "soft"), `${width} soft`);
		}
	}
});

test("S3 faded: classic's geometry, `you` in its pink; the top and bottom fade by column, the sides by row, corners at the background", () => {
	for (const width of [30, 24]) {
		const render = piUserMessage(["first line", "", "third"]);
		const lines = frameUserLines(render, width, undefined, "faded");
		assert.deepEqual(lines.map(plain), frameUserLines(render, width).map(plain), `${width}: same words and places`);
		for (const line of lines) assert.equal(visibleWidth(line), width);
		for (const index of [0, lines.length - 1]) {
			const colors = frameColors(lines[index]);
			for (const [column, color] of colors) assert.equal(color, fade(column, width), `${width} row ${index} col ${column}`);
			const byColumn = new Map(colors);
			assert.equal(byColumn.get(0), fgCode(BACKGROUND), "the left corner sinks into the background");
			assert.equal(byColumn.get(width - 1), fgCode(BACKGROUND), "the right corner too");
			for (const [column, color] of colors) if (byColumn.has(width - 1 - column)) assert.equal(color, byColumn.get(width - 1 - column), "mirrored");
		}
		for (let index = 1; index < lines.length - 1; index++) {
			const row = cells(lines[index]);
			assert.deepEqual([row[0], row[width - 1]], [{ glyph: "│", color: fade(index, lines.length) }, { glyph: "│", color: fade(index, lines.length) }], `${width} side ${index}`);
		}
		assert.ok(lines[0].includes(`${fgCode(vivid(palette.pink))}you`), "`you` keeps its color");
		assert.ok(lines[1].includes(BG), "the message keeps its background");
		assert.deepEqual(marks(lines), ["0A", `${lines.length - 1}B`, `${lines.length - 1}C`], "the prompt zone once, first and last row");
	}
	assert.ok(frameUserLines(piUserMessage(["hola"]), 30, "soft", "faded")[0].includes(`${fgCode(palette.pink)}you`), "soft `you` too");
});

test("S3 none: `you` on a fading top rule in its place; no sides, no bottom; the text keeps its columns; the prompt zone stays valid", () => {
	const render = piUserMessage(["hola, una cosa"]);
	const lines = frameUserLines(render, 30, undefined, "none");
	assert.deepEqual(lines.map(plain), [
		`── you ${"─".repeat(23)}`,
		`  hola, una cosa${" ".repeat(14)}`,
	]);
	assert.deepEqual(marks(lines), ["0A", "1B", "1C"], "zone start on the first row, end on the last");
	assert.ok(lines[0].startsWith(ZONE_START) && lines[1].startsWith(ZONE_END));
	assert.ok(lines[0].includes(`${fgCode(vivid(palette.pink))}you`), "`you` keeps its color");
	const rule = frameColors(lines[0]);
	assert.equal(rule.length, 25, "the corners turned dashes and the fill");
	for (const [column, color] of rule) assert.equal(color, fade(column, 30), `rule col ${column}`);
	assert.equal(new Map(rule).get(0), fgCode(BACKGROUND));
	assert.ok(lines[1].startsWith(`${ZONE_END} ${BG}`) && lines[1].endsWith("\x1b[49m "), "a plain space for each side, the message background inside");
	const classic = frameUserLines(piUserMessage(["first line", "", "third line"]), 24);
	const none = frameUserLines(piUserMessage(["first line", "", "third line"]), 24, "soft", "none");
	assert.deepEqual(none.map(plain), [
		`── you ${"─".repeat(17)}`,
		`  first line${" ".repeat(12)}`,
		" ".repeat(24),
		`  third line${" ".repeat(12)}`,
	]);
	assert.equal(plain(none[0]), plain(classic[0]).replace("╭", "─").replace("╮", "─"), "`you` in classic's place");
	assert.deepEqual(none.slice(1).map(plain), classic.slice(1, -1).map((line) => plain(line).replaceAll("│", " ")), "the text in classic's columns");
	for (const line of none) assert.equal(visibleWidth(line), 24);
	assert.deepEqual(marks(none), ["0A", "3B", "3C"]);
	assert.ok(none[0].includes(`${fgCode(palette.pink)}you`), "soft `you`");
	assert.ok(!none.slice(1).some((line) => /[│╰╯]/u.test(plain(line))));
});
