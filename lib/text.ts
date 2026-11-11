// ANSI-aware width helpers. Gentle Shell hides the whole rail when any line is
// wider than the width it asked for, so every rail line goes through these.

const RESET = "\x1b[0m";

function charWidth(codePoint: number): number {
	// Printable ASCII, most of what the panel draws, skips the range checks below.
	if (codePoint >= 0x20 && codePoint < 0x7f) return 1;
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

/**
 * Where the escape sequence that starts at `index` ends, or -1 when none starts there.
 * An escape paints nothing, so it takes no column. One that never ends is not an
 * escape: its characters are drawn as text.
 *
 *   CSI (colors, styles)      ESC [   parameters 0-?   intermediates space-/   one final @-~
 *   OSC (hyperlinks)          ESC ]   anything but BEL and ESC, then BEL or ESC \
 *   APC, DCS, PM, SOS         ESC _ P ^ X, then the same as OSC (Pi's editor marks its cursor with APC)
 *
 * Scanned by hand, with no regex and no substring: frames are colored glyph by
 * glyph, so a rail line holds about two escapes per column and this runs for each.
 */
function escapeEnd(text: string, index: number): number {
	if (text.charCodeAt(index) !== 0x1b) return -1;
	const kind = text.charCodeAt(index + 1);
	if (kind === 0x5b) {
		let at = index + 2;
		let code = text.charCodeAt(at);
		while (code >= 0x30 && code <= 0x3f) code = text.charCodeAt(++at);
		while (code >= 0x20 && code <= 0x2f) code = text.charCodeAt(++at);
		return code >= 0x40 && code <= 0x7e ? at + 1 : -1;
	}
	if (kind !== 0x5d && kind !== 0x5f && kind !== 0x50 && kind !== 0x5e && kind !== 0x58) return -1;
	for (let at = index + 2; at < text.length; at++) {
		const code = text.charCodeAt(at);
		if (code === 0x07) return at + 1;
		if (code === 0x1b) return text.charCodeAt(at + 1) === 0x5c ? at + 2 : -1;
	}
	return -1;
}

export function visibleWidth(text: string): number {
	let width = 0;
	for (let index = 0; index < text.length;) {
		const unit = text.charCodeAt(index);
		if (unit >= 0x20 && unit < 0x7f) {
			width++;
			index++;
			continue;
		}
		const end = escapeEnd(text, index);
		if (end >= 0) {
			index = end;
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
		const end = escapeEnd(text, index);
		if (end >= 0) {
			out += text.slice(index, end);
			styled = true;
			index = end;
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
		const end = escapeEnd(text, index);
		if (end >= 0) {
			out += text.slice(index, end);
			styled = true;
			index = end;
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
