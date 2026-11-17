import assert from "node:assert/strict";
import test from "node:test";
import { ellipsize, fitWidth, padEnd, sliceColumns, truncateToWidth, visibleWidth } from "../lib/text.ts";

test("visibleWidth ignores ANSI escapes and counts wide characters as 2", () => {
	assert.equal(visibleWidth("\x1b[1mabc\x1b[0m"), 3);
	assert.equal(visibleWidth("\x1b[38;2;242;167;201mabc\x1b[39m"), 3);
	assert.equal(visibleWidth("\x1b]8;;https://x\x07link\x1b]8;;\x07"), 4);
	assert.equal(visibleWidth("\x1b_pi:c\x07\x1b_pi:fc\x07 \x1b_pi:/fc\x07abc"), 4, "the editor's APC cursor markers take no column");
	assert.equal(visibleWidth("\x1bPq\x1b\\abc"), 3, "a DCS string ended by ST takes no column");
	assert.equal(visibleWidth("╭─╮▀▄█▰▱"), 8);
	assert.equal(visibleWidth("日本"), 4);
});

test("truncateToWidth keeps escapes and cuts visible text", () => {
	const out = truncateToWidth("\x1b[31mhello world\x1b[39m", 5);
	assert.equal(visibleWidth(out), 5);
	assert.ok(out.startsWith("\x1b[31mhello"));
	assert.equal(truncateToWidth("short", 10), "short");
	assert.equal(truncateToWidth("abc", 0), "");
	assert.equal(visibleWidth(truncateToWidth("日本語", 3)), 2);
});

test("ellipsize cuts with … only when the text is too wide", () => {
	assert.equal(ellipsize("short", 10), "short");
	assert.equal(ellipsize("abcdef", 4), "abc…");
	assert.equal(ellipsize("abcdef", 1), "…");
	assert.equal(ellipsize("abcdef", 0), "");
	const styled = ellipsize("\x1b[31mhello world\x1b[39m", 6);
	assert.equal(visibleWidth(styled), 6);
	assert.ok(styled.endsWith("…"));
});

test("only a whole CSI, OSC, APC, DCS, PM or SOS sequence takes no column; a broken one is drawn as text", () => {
	assert.equal(visibleWidth("\x1b[?25hab"), 2, "CSI with a private parameter");
	assert.equal(visibleWidth("\x1b[ qab"), 2, "CSI with an intermediate byte");
	assert.equal(visibleWidth("\x1b["), 1, "CSI cut after its opener: the bracket shows");
	assert.equal(visibleWidth("\x1b[31"), 3, "CSI without a final byte");
	assert.equal(visibleWidth("\x1b]unterminated"), 13, "OSC that never ends");
	assert.equal(visibleWidth("\x1b]a\x1bb"), 3, "OSC broken by an ESC that is not ST");
	assert.equal(visibleWidth("\x1bXsos\x1b\\z"), 1, "SOS ended by ST");
	assert.equal(visibleWidth("\x1b^pm\x07z"), 1, "PM ended by BEL");
	assert.equal(visibleWidth("\x1bc"), 1, "an escape outside those families");
	assert.equal(visibleWidth("\x1b"), 0, "a lone ESC");
	assert.equal(truncateToWidth("\x1b[31mab\x1b[39mcd", 3), "\x1b[31mab\x1b[39mc\x1b[0m");
	assert.equal(truncateToWidth("\x1b[31", 2), "\x1b[3");
	assert.equal(sliceColumns("\x1b[31mabcd\x1b[39m", 1, 3), "\x1b[31mbc\x1b[0m");
	assert.equal(sliceColumns("a日b", 1, 2), "", "a wide character astride the edge is left out");
});

test("fitWidth gives exactly the width: padded when the text fits, cut with … when it does not, as padEnd(ellipsize()) does", () => {
	assert.equal(fitWidth("abc", 6), "abc   ");
	assert.equal(fitWidth("abcdef", 6), "abcdef");
	assert.equal(fitWidth("abcdefgh", 6), "abcde…");
	assert.equal(fitWidth("日本語", 5), "日本…");
	assert.equal(fitWidth("日本語", 4), "日… ", "a wide character that does not fit leaves a column to pad");
	assert.equal(fitWidth("\x1b[31mab\x1b[39m", 4), "\x1b[31mab\x1b[39m  ", "escapes take no column");
	assert.equal(fitWidth("\x1b[31mabcdef\x1b[39m", 4), "\x1b[31mabc\x1b[0m…");
	assert.equal(fitWidth("abc", 0), "");
	assert.equal(fitWidth("abc", -2), "");
	assert.equal(fitWidth("", 3), "   ");
	for (const text of ["", "abc", "abcdefgh", "日本語テキスト", "\x1b[1mbold\x1b[22m tail", "e\u0301 mark"]) {
		for (let width = -1; width <= 12; width++) assert.equal(fitWidth(text, width), padEnd(ellipsize(text, width), width), `${JSON.stringify(text)} at ${width}`);
	}
});

// Expected widths come from Unicode EastAsianWidth.txt (W and F), not from the code under test.
test("S29 emoji-presentation symbols below U+2E80 and in the old emoji blocks are 2 columns wide", () => {
	for (const glyph of ["\u231a", "\u231b", "\u2329", "\u232a", "\u23e9", "\u23f0", "\u23f3", "\u25fd", "\u2614", "\u2648", "\u267f", "\u2693", "\u26a1", "\u26bd", "\u26c4", "\u26d4", "\u26ea", "\u2705", "\u270a", "\u2728", "\u274c", "\u2753", "\u2795", "\u27b0", "\u2b1b", "\u2b50", "\u2b55", "\u{1f004}", "\u{1f0cf}", "\u{1f18e}", "\u{1f191}", "\u{1f201}", "\u{1f22f}"]) {
		assert.equal(visibleWidth(glyph), 2, `U+${glyph.codePointAt(0)!.toString(16)}`);
	}
	assert.equal(padEnd("\u231a", 2), "\u231a", "no padding: the glyph already fills two columns");
	assert.equal(padEnd("\u231a", 4), "\u231a  ");
	assert.equal(truncateToWidth("\u231a\u231a", 3), "\u231a", "a second wide glyph does not fit in column 3");
});

test("S29 the narrow symbols the panel draws stay 1 column", () => {
	for (const glyph of ["─", "╭", "█", "▰", "⣿", "→", "↑", "✿", "✓", "✗", "·", "…", "☃", "⌘", "\u23f4", "\u25fc", "⚠", "★", "\u2b1d", "\u2b56"]) {
		assert.equal(visibleWidth(glyph), 1, `U+${glyph.codePointAt(0)!.toString(16)}`);
	}
});

test("S30 sliceColumns keeps a combining mark with its base and never starts a slice with an orphan mark", () => {
	assert.equal(sliceColumns("e\u0301x", 0, 1), "e\u0301");
	assert.equal(sliceColumns("e\u0301x", 1, 2), "x", "the accent belongs to the base left out of the slice");
	assert.equal(sliceColumns("ae\u0301\u0302x", 1, 2), "e\u0301\u0302", "every mark after the base");
	assert.equal(sliceColumns("e\u0301x", 0, 2), "e\u0301x");
	assert.equal(sliceColumns("e\u0301x", 0, 0), "", "nothing selected, no mark");
	assert.equal(sliceColumns("\u65e5\u0301a", 0, 2), "\u65e5\u0301");
	assert.equal(sliceColumns("\x1b[31me\u0301x\x1b[39m", 0, 1), "\x1b[31me\u0301\x1b[0m", "escapes before it stay");
});
