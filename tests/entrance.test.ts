import assert from "node:assert/strict";
import test from "node:test";
import { ENTRANCE_FLASH_STEPS, entranceFlash, entranceSteps, entranceText, mixColor } from "../lib/entrance.ts";
import { bold, fg, palette, type Rgb } from "../lib/palette.ts";

const WHITE: Rgb = [0xff, 0xff, 0xff];
const LIGHT: Rgb = [0xc8, 0xc8, 0xc8];
const GRAY: Rgb = [0x9a, 0x9a, 0x9a];

test("entrance: 3 flash steps, the row bold in the section color fading to its own colors (S54)", () => {
	assert.equal(ENTRANCE_FLASH_STEPS, 3);
	const pieces = [{ text: "ab", color: palette.text, bold: true }, { text: " cd", color: palette.muted }];
	assert.equal(entranceText(pieces, palette.lilac, 0), bold(fg(palette.lilac, "ab cd")), "step 0: all in the section color, all bold");
	assert.deepEqual(mixColor(palette.lilac, palette.text, 1 / 3), [205, 186, 245]);
	assert.deepEqual(mixColor(palette.lilac, palette.muted, 2 / 3), [137, 127, 157]);
	const one = mixColor(palette.lilac, palette.text, 1 / 3);
	const oneMuted = mixColor(palette.lilac, palette.muted, 1 / 3);
	assert.equal(entranceText(pieces, palette.lilac, 1), bold(fg(one, "ab")) + bold(fg(oneMuted, " cd")), "step 1: a third of the way to each char's color, still bold");
	const two = mixColor(palette.lilac, palette.text, 2 / 3);
	const twoMuted = mixColor(palette.lilac, palette.muted, 2 / 3);
	assert.equal(entranceText(pieces, palette.lilac, 2), bold(fg(two, "ab")) + bold(fg(twoMuted, " cd")));
	assert.deepEqual([0, 1, 2, 3].map(entranceFlash), [true, true, true, false]);
	assert.equal(entranceFlash(undefined), false);
});

test("entrance: then one white shine walks the text from -2, one char per step, and the entrance ends 2 past the end (S54)", () => {
	const pieces = [{ text: "abcd", color: palette.muted }];
	assert.equal(entranceText(pieces, palette.amber, 3), fg(GRAY, "a") + fg(palette.muted, "bcd"), "step 3: head at -2");
	assert.equal(entranceText(pieces, palette.amber, 4), fg(LIGHT, "a") + fg(GRAY, "b") + fg(palette.muted, "cd"), "step 4: head at -1");
	assert.equal(entranceText(pieces, palette.amber, 5), fg(WHITE, "a") + fg(LIGHT, "b") + fg(GRAY, "c") + fg(palette.muted, "d"), "step 5: head on the first char");
	assert.equal(entranceText(pieces, palette.amber, 7), fg(GRAY, "a") + fg(LIGHT, "b") + fg(WHITE, "c") + fg(LIGHT, "d"));
	assert.equal(entranceText(pieces, palette.amber, 11), fg(palette.muted, "abcd"), "step 11: head at len + 2, the last entrance step");
	assert.equal(entranceSteps("abcd"), 12, "flash 3 + head from -2 to len + 2");
	assert.equal(entranceText(pieces, palette.amber, 12), undefined, "over: the caller draws the normal row");
	assert.equal(entranceText(pieces, palette.amber, undefined), undefined);
	assert.equal(entranceText(pieces, palette.amber, -1), undefined);
});

test("entrance: the shine keeps each char's bold flag; the flash makes every char bold (S54)", () => {
	const pieces = [{ text: "ab", color: palette.text, bold: true }, { text: "c", color: palette.muted }];
	assert.equal(entranceText(pieces, palette.rose, 5), bold(fg(WHITE, "a")) + bold(fg(LIGHT, "b")) + fg(GRAY, "c"));
	assert.equal(entranceSteps(""), 8);
	assert.equal(entranceSteps("día"), 11, "chars, not UTF-16 units");
});
