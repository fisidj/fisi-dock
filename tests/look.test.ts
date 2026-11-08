import assert from "node:assert/strict";
import test from "node:test";
import { ACCENTS, COLOR_MODES, DEFAULT_LOOK, DIVIDER_LEVELS, FRAME_STYLES, LOGO_STYLES, LOOK_OPTIONS, MOTION_MODES, normalizeLook } from "../lib/look.ts";

test("S6 the default look is today's: braille logo, faded frames, vivid colors, pink accent, medium divider, motion on (look-more S7)", () => {
	assert.deepEqual(DEFAULT_LOOK, { logo: "braille", frames: "faded", colors: "vivid", accent: "pink", divider: "medium", motion: "on" });
});

test("S1 each look key has its ordered options, the default first", () => {
	assert.deepEqual(LOGO_STYLES, ["braille", "text", "none"]);
	assert.deepEqual(FRAME_STYLES, ["faded", "classic", "none"]);
	assert.deepEqual(COLOR_MODES, ["vivid", "soft"]);
	assert.deepEqual(ACCENTS, ["pink", "teal", "lilac", "amber", "green"], "look-more S4");
	assert.deepEqual(DIVIDER_LEVELS, ["medium", "off", "subtle", "strong"], "look-more S1");
	assert.deepEqual(MOTION_MODES, ["on", "off"], "look-more S2");
	assert.deepEqual(LOOK_OPTIONS, { logo: LOGO_STYLES, frames: FRAME_STYLES, colors: COLOR_MODES, accent: ACCENTS, divider: DIVIDER_LEVELS, motion: MOTION_MODES });
	for (const key of ["logo", "frames", "colors", "accent", "divider", "motion"] as const) assert.equal(LOOK_OPTIONS[key][0], DEFAULT_LOOK[key], key);
});

test("S5 normalizeLook keeps every valid field and falls back per field to the default", () => {
	assert.deepEqual(normalizeLook({ logo: "text", frames: "none", colors: "soft", accent: "lilac", divider: "strong", motion: "off" }), { logo: "text", frames: "none", colors: "soft", accent: "lilac", divider: "strong", motion: "off" }, "full valid");
	assert.deepEqual(normalizeLook({ frames: "classic" }), { logo: "braille", frames: "classic", colors: "vivid", accent: "pink", divider: "medium", motion: "on" }, "partial");
	assert.deepEqual(normalizeLook({ logo: "text", frames: "none", colors: "soft" }), { logo: "text", frames: "none", colors: "soft", accent: "pink", divider: "medium", motion: "on" }, "look-more S7: a look saved before divider, motion and accent reads them as the default");
	assert.deepEqual(normalizeLook({ logo: "text", divider: "off", motion: "off" }), { ...DEFAULT_LOOK, logo: "text", divider: "off", motion: "off" }, "look-more S4: a look saved before accent reads pink");
	for (const accent of ACCENTS) assert.equal(normalizeLook({ accent }).accent, accent, accent);
	assert.deepEqual(normalizeLook({ divider: "bright", motion: false }), DEFAULT_LOOK, "look-more: bad divider and motion fall back");
	for (const accent of ["Teal", "red", "rose", "", 1, null, ["teal"], "toString"]) assert.equal(normalizeLook({ accent }).accent, "pink", `look-more S4: bad accent ${JSON.stringify(accent)}`);
	assert.deepEqual(normalizeLook({ logo: 1, frames: ["none"], colors: { soft: true } }), DEFAULT_LOOK, "wrong types");
	assert.deepEqual(normalizeLook({ logo: "big", frames: "Faded", colors: "soft", extra: 1 }), { ...DEFAULT_LOOK, colors: "soft" }, "unknown values and keys");
	assert.deepEqual(normalizeLook({ logo: "toString", frames: "constructor", colors: "__proto__" }), DEFAULT_LOOK, "inherited names are not options");
	for (const value of [undefined, null, "soft", 3, true, [], ["text"]]) assert.deepEqual(normalizeLook(value), DEFAULT_LOOK, JSON.stringify(value));
});

test("S6 normalizeLook returns a fresh object, never DEFAULT_LOOK itself", () => {
	const look = normalizeLook(undefined);
	assert.notEqual(look, DEFAULT_LOOK);
	look.logo = "none";
	assert.equal(DEFAULT_LOOK.logo, "braille");
});

test("S4 themeNameFor: Fisi-Dock for vivid, Fisi-Dock-Soft for soft", async () => {
	const { themeNameFor } = await import("../lib/look.ts");
	assert.equal(themeNameFor("vivid"), "Fisi-Dock");
	assert.equal(themeNameFor("soft"), "Fisi-Dock-Soft");
	assert.equal(themeNameFor(DEFAULT_LOOK.colors), "Fisi-Dock", "S6 the default look keeps today's theme");
	assert.equal(themeNameFor(DEFAULT_LOOK.colors, DEFAULT_LOOK.accent), "Fisi-Dock", "look-more S7 the default accent keeps it too");
});

test("look-more S4 themeNameFor(colors, accent): pink keeps Fisi-Dock and Fisi-Dock-Soft, every other accent its own pair", async () => {
	const { themeNameFor, FISI_DOCK_THEMES } = await import("../lib/look.ts");
	const expected: Record<string, [string, string]> = {
		pink: ["Fisi-Dock", "Fisi-Dock-Soft"],
		teal: ["Fisi-Dock-Teal", "Fisi-Dock-Teal-Soft"],
		lilac: ["Fisi-Dock-Lilac", "Fisi-Dock-Lilac-Soft"],
		amber: ["Fisi-Dock-Amber", "Fisi-Dock-Amber-Soft"],
		green: ["Fisi-Dock-Green", "Fisi-Dock-Green-Soft"],
	};
	for (const accent of ACCENTS) {
		assert.equal(themeNameFor("vivid", accent), expected[accent][0], `${accent} vivid`);
		assert.equal(themeNameFor("soft", accent), expected[accent][1], `${accent} soft`);
	}
	assert.deepEqual([...FISI_DOCK_THEMES], Object.values(expected).flat(), "every Fisi Dock theme, pink first");
});

test("S1 lookKey names the look for memo keys: each field changes it, equal looks share it", async () => {
	const { lookKey } = await import("../lib/look.ts");
	assert.equal(lookKey(DEFAULT_LOOK), "braille/faded/vivid/pink/medium/on");
	assert.equal(lookKey({ logo: "text", frames: "none", colors: "soft", accent: "green", divider: "off", motion: "off" }), "text/none/soft/green/off/off");
	assert.equal(lookKey(normalizeLook({ frames: "classic" })), lookKey({ ...DEFAULT_LOOK, frames: "classic" }));
	const keys = new Set([DEFAULT_LOOK, { ...DEFAULT_LOOK, logo: "none" }, { ...DEFAULT_LOOK, frames: "none" }, { ...DEFAULT_LOOK, colors: "soft" }, { ...DEFAULT_LOOK, accent: "teal" }, { ...DEFAULT_LOOK, divider: "strong" }, { ...DEFAULT_LOOK, motion: "off" }].map((look) => lookKey(look as typeof DEFAULT_LOOK)));
	assert.equal(keys.size, 7);
});
