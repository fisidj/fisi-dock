// The user's own messages (S45): Pi paints them on userMessageBg, the same gray
// as tool blocks, so Fisi Dock boxes them like the prompt box, with `you` on the
// top rule. Pi is never imported: the live UserMessageComponent class is found
// in the TUI tree and its render goes through a global hook, so a removed or
// reloaded Fisi Dock leaves Pi's own lines. The box takes the look's `frames`
// (look-more S3), like the prompt box. Light colors paint the box and `you` for a light
// background (look-more S5); Pi's rows keep their own colors.
import type { Accent, ColorMode, FrameStyle } from "./look.ts";
import { accentLabel, dim, fadeAmount, fadedEdge, fg, palette, tone } from "./palette.ts";
import { padEnd, truncateToWidth } from "./text.ts";

export const USER_FRAME_HOOK = Symbol.for("fisi-dock.user-frame");
/** Pi's original render, kept on the patched prototype; shared across reloads. */
const ORIGINAL_RENDER = Symbol.for("fisi-dock.user-frame.original");

const USER_MESSAGE_CLASS = "UserMessageComponent";
/** Narrower than this, the box would leave almost no room for the text. */
const MIN_WIDTH = 10;
// The tree walk is bounded so a huge or cyclic tree can never stall a frame:
// Pi's user messages sit a few levels down (TUI > chat container > message),
// and a long chat holds a few thousand components at most.
const MAX_DEPTH = 12;
const MAX_NODES = 5_000;
/** Cells of the top rule other than its dashes: `╭─ ` (3), `you` (3), ` ` (1) and `╮` (1). */
const TOP_RULE_CHROME = 8;

// Pi's prompt-zone marks (OSC 133): zone start on the first row, end and final on the last.
const ZONE_START = "\x1b]133;A\x07";
const ZONE_END = "\x1b]133;B\x07\x1b]133;C\x07";
const ZONE_MARK = /\x1b\]133;[ABC]\x07/g;

type Render = (width: number) => string[];
type Hook = (render: Render, width: number) => string[];

/** A row with no visible text: Pi's padding rows are background-colored spaces. */
const blank = (line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").trim() === "";

/**
 * Pi's user message in a gray box: `╭─ you ─…─╮`, each row between `│` sides,
 * `╰─…─╯`. Pi renders two columns narrower; its blank padding rows go. Under
 * MIN_WIDTH columns, or when nothing shows, Pi's lines stay as they are.
 * `you` in vivid pink, or its pastel in soft `colors` (look settings S4); another `accent`
 * paints it in that accent's tone instead (look-more S4).
 * `frames` (look-more S3): classic (the default) flat gray; faded the same box,
 * the top and bottom faded by column and the sides by row; none the top rule
 * alone as a fading line with `you` in its place, a space for each side and no
 * bottom row, the prompt zone closing on the last text row.
 */
export function frameUserLines(render: Render, width: number, colors?: ColorMode, frames: FrameStyle = "classic", accent?: Accent): string[] {
	if (width < MIN_WIDTH) return render(width);
	const inner = width - 2;
	const rows = render(inner).map((line) => line.replace(ZONE_MARK, ""));
	let first = 0;
	let last = rows.length - 1;
	while (first <= last && blank(rows[first])) first++;
	while (last >= first && blank(rows[last])) last--;
	if (first > last) return render(width);
	const text = rows.slice(first, last + 1);
	const height = text.length + 2;
	// Frame glyphs from column `start`: flat gray in classic, faded by column otherwise; none's rule has no corners.
	const edge = (glyphs: string, start: number) => (frames === "classic" ? fg(tone(palette.frame, colors), glyphs) : fadedEdge(glyphs, start, width, colors));
	const corner = (glyph: string) => (frames === "none" ? "─" : glyph);
	const side = (index: number) => (frames === "classic" ? fg(tone(palette.frame, colors), "│") : frames === "none" ? " " : fg(tone(dim(palette.text, fadeAmount(index + 1, height)), colors), "│"));
	const body = text.map((row, index) => `${side(index)}${padEnd(truncateToWidth(row, inner), inner)}${side(index)}`);
	const top = `${ZONE_START}${edge(`${corner("╭")}─ `, 0)}${fg(accentLabel(accent, colors), "you")}${edge(` ${"─".repeat(width - TOP_RULE_CHROME)}${corner("╮")}`, 6)}`;
	if (frames === "none") return [top, ...body.slice(0, -1), `${ZONE_END}${body.at(-1)}`];
	return [top, ...body, `${ZONE_END}${edge(`╰${"─".repeat(inner)}╯`, 0)}`];
}

type Node = { children?: unknown; constructor?: { name?: unknown } };

function findUserMessage(root: unknown): object | undefined {
	const seen = new Set<unknown>();
	let level: unknown[] = [root];
	for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
		const next: unknown[] = [];
		for (const node of level) {
			if (!node || typeof node !== "object" || seen.has(node)) continue;
			if (seen.size >= MAX_NODES) return undefined;
			seen.add(node);
			if ((node as Node).constructor?.name === USER_MESSAGE_CLASS) return node;
			const children = (node as Node).children;
			if (Array.isArray(children)) next.push(...children);
		}
		level = next;
	}
	return undefined;
}

/**
 * Patch the render of Pi's user message class, found through an instance in
 * the TUI tree under `root`, once. The patched render asks the global hook and
 * falls back to Pi's lines when the hook is absent or throws. True when the
 * class is (already) patched; false while no user message is on screen.
 */
export function installUserFrame(root: unknown): boolean {
	const message = findUserMessage(root);
	if (!message) return false;
	const prototype = Object.getPrototypeOf(message) as Record<PropertyKey, unknown> | null;
	if (!prototype || typeof prototype.render !== "function") return false;
	if (Object.hasOwn(prototype, ORIGINAL_RENDER)) return true;
	const original = prototype.render as (this: unknown, width: number) => string[];
	prototype[ORIGINAL_RENDER] = original;
	prototype.render = function (this: unknown, width: number): string[] {
		const hook = (globalThis as Record<symbol, unknown>)[USER_FRAME_HOOK];
		if (typeof hook === "function") {
			try {
				const lines = (hook as Hook)((inner) => original.call(this, inner), width);
				if (Array.isArray(lines)) return lines;
			} catch {}
		}
		return original.call(this, width);
	};
	return true;
}
