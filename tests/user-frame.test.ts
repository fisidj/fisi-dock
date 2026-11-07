import assert from "node:assert/strict";
import test from "node:test";
import { fgCode, palette, vivid } from "../lib/palette.ts";
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
