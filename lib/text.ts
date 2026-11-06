// ANSI-aware width helpers. Gentle Shell hides the whole rail when any line is
// wider than the width it asked for, so every rail line goes through these.

// CSI sequences (colors, styles) and OSC sequences (hyperlinks) paint nothing.
// CSI, OSC, and the APC, DCS, PM and SOS strings: Pi's editor marks its cursor with APC. None takes a column.
const ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[_P^X][^\x07\x1b]*(?:\x07|\x1b\\)/y;
const RESET = "\x1b[0m";

function charWidth(codePoint: number): number {
	if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
	// Combining marks, zero-width joiners and variation selectors.
	if ((codePoint >= 0x300 && codePoint <= 0x36f) || (codePoint >= 0x200b && codePoint <= 0x200f) || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)) return 0;
	if (
		(codePoint >= 0x1100 && codePoint <= 0x115f) ||
		(codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
		(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
		(codePoint >= 0xff00 && codePoint <= 0xff60) ||
		(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
		(codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
		(codePoint >= 0x20000 && codePoint <= 0x3fffd)
	) return 2;
	return 1;
}

function escapeAt(text: string, index: number): string | undefined {
	ESCAPE.lastIndex = index;
	return ESCAPE.exec(text)?.[0];
}

export function visibleWidth(text: string): number {
	let width = 0;
	for (let index = 0; index < text.length;) {
		const escape = escapeAt(text, index);
		if (escape) {
			index += escape.length;
			continue;
		}
		const codePoint = text.codePointAt(index)!;
		width += charWidth(codePoint);
		index += codePoint > 0xffff ? 2 : 1;
	}
	return width;
}

/** Cut visible text to `width` columns, keeping escapes and resetting styles after a cut. */
export function truncateToWidth(text: string, width: number): string {
	if (visibleWidth(text) <= width) return text;
	let out = "";
	let used = 0;
	let styled = false;
	for (let index = 0; index < text.length;) {
		const escape = escapeAt(text, index);
		if (escape) {
			out += escape;
			styled = true;
			index += escape.length;
			continue;
		}
		const codePoint = text.codePointAt(index)!;
		const next = charWidth(codePoint);
		if (used + next > width) break;
		out += String.fromCodePoint(codePoint);
		used += next;
		index += codePoint > 0xffff ? 2 : 1;
	}
	return styled ? out + RESET : out;
}

/**
 * The visible columns `[from, to)` of `text`. Every escape met before the slice
 * ends is kept, so the slice carries the styles it had in place; styles are
 * reset after it when any were kept. A wide character astride an edge is left out.
 */
export function sliceColumns(text: string, from: number, to: number): string {
	let out = "";
	let column = 0;
	let styled = false;
	for (let index = 0; index < text.length;) {
		const escape = escapeAt(text, index);
		if (escape) {
			out += escape;
			styled = true;
			index += escape.length;
			continue;
		}
		if (column >= to) break;
		const codePoint = text.codePointAt(index)!;
		const next = charWidth(codePoint);
		if (column >= from && column + next <= to) out += String.fromCodePoint(codePoint);
		column += next;
		index += codePoint > 0xffff ? 2 : 1;
	}
	return styled ? out + RESET : out;
}

/** Cut to `width` columns, ending in … when anything was dropped. */
export function ellipsize(text: string, width: number): string {
	if (visibleWidth(text) <= width) return text;
	if (width <= 0) return "";
	return truncateToWidth(text, width - 1) + "…";
}

/** Pad with spaces on the right up to `width` visible columns. */
export function padEnd(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}
