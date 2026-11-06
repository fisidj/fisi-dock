import assert from "node:assert/strict";
import test from "node:test";
import { ellipsize, truncateToWidth, visibleWidth } from "../lib/text.ts";

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
