import assert from "node:assert/strict";
import test from "node:test";
import { ACCENTS, COLOR_MODES, DEFAULT_LOOK, DEFAULT_SECTIONS, DIVIDER_LEVELS, FRAME_STYLES, LOGO_STYLES, LOOK_OPTIONS, MOTION_MODES, normalizeLook, SECTION_IDS } from "../lib/look.ts";

test("S6 the default look is today's: braille logo, faded frames, vivid colors, pink accent, medium divider, motion on (look-more S7)", () => {
	assert.deepEqual(DEFAULT_LOOK, { logo: "braille", frames: "faded", colors: "vivid", accent: "pink", divider: "medium", motion: "on", sections: DEFAULT_SECTIONS });
});

test("S1 each look key has its ordered options, the default first", () => {
	assert.deepEqual(LOGO_STYLES, ["braille", "text", "none"]);
	assert.deepEqual(FRAME_STYLES, ["faded", "classic", "none"]);
	assert.deepEqual(COLOR_MODES, ["vivid", "soft", "light"], "look-more S5");
	assert.deepEqual(ACCENTS, ["pink", "teal", "lilac", "amber", "green"], "look-more S4");
	assert.deepEqual(DIVIDER_LEVELS, ["medium", "off", "subtle", "strong"], "look-more S1");
	assert.deepEqual(MOTION_MODES, ["on", "off"], "look-more S2");
	assert.deepEqual(LOOK_OPTIONS, { logo: LOGO_STYLES, frames: FRAME_STYLES, colors: COLOR_MODES, accent: ACCENTS, divider: DIVIDER_LEVELS, motion: MOTION_MODES });
	for (const key of ["logo", "frames", "colors", "accent", "divider", "motion"] as const) assert.equal(LOOK_OPTIONS[key][0], DEFAULT_LOOK[key], key);
});

test("S5 normalizeLook keeps every valid field and falls back per field to the default", () => {
	assert.deepEqual(normalizeLook({ logo: "text", frames: "none", colors: "soft", accent: "lilac", divider: "strong", motion: "off" }), { logo: "text", frames: "none", colors: "soft", accent: "lilac", divider: "strong", motion: "off", sections: DEFAULT_SECTIONS }, "full valid");
	assert.deepEqual(normalizeLook({ frames: "classic" }), { logo: "braille", frames: "classic", colors: "vivid", accent: "pink", divider: "medium", motion: "on", sections: DEFAULT_SECTIONS }, "partial");
	assert.deepEqual(normalizeLook({ logo: "text", frames: "none", colors: "soft" }), { logo: "text", frames: "none", colors: "soft", accent: "pink", divider: "medium", motion: "on", sections: DEFAULT_SECTIONS }, "look-more S7: a look saved before divider, motion and accent reads them as the default");
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
	assert.deepEqual([...FISI_DOCK_THEMES], [...Object.values(expected).flat(), "Fisi-Dock-Light"], "every Fisi Dock theme, pink first, the light one last (look-more S5)");
});

test("S1 lookKey names the look for memo keys: each field changes it, equal looks share it", async () => {
	const { lookKey } = await import("../lib/look.ts");
	assert.equal(lookKey(DEFAULT_LOOK), "braille/faded/vivid/pink/medium/on/heads-up,odd,rdd,ci,agents,todo,changes");
	assert.equal(lookKey({ logo: "text", frames: "none", colors: "soft", accent: "green", divider: "off", motion: "off", sections: DEFAULT_SECTIONS }), "text/none/soft/green/off/off/heads-up,odd,rdd,ci,agents,todo,changes");
	assert.equal(lookKey({ ...DEFAULT_LOOK, sections: [{ id: "todo", shown: true }, { id: "odd", shown: false }, ...DEFAULT_SECTIONS.filter((section) => section.id !== "todo" && section.id !== "odd")] }), "braille/faded/vivid/pink/medium/on/todo,!odd,heads-up,rdd,ci,agents,changes", "look-more S6: the order and the hidden ones");
	assert.equal(lookKey(normalizeLook({ frames: "classic" })), lookKey({ ...DEFAULT_LOOK, frames: "classic" }));
	const keys = new Set([DEFAULT_LOOK, { ...DEFAULT_LOOK, logo: "none" }, { ...DEFAULT_LOOK, frames: "none" }, { ...DEFAULT_LOOK, colors: "soft" }, { ...DEFAULT_LOOK, accent: "teal" }, { ...DEFAULT_LOOK, divider: "strong" }, { ...DEFAULT_LOOK, motion: "off" }, { ...DEFAULT_LOOK, sections: DEFAULT_SECTIONS.map((section) => ({ ...section, shown: section.id !== "ci" })) }, { ...DEFAULT_LOOK, sections: [...DEFAULT_SECTIONS].reverse() }].map((look) => lookKey(look as typeof DEFAULT_LOOK)));
	assert.equal(keys.size, 9);
});

test("look-more S5 themeNameFor(light, accent) is Fisi-Dock-Light for every accent: one light theme, no light accents; it is one of Fisi Dock's own", async () => {
	const { themeNameFor, FISI_DOCK_THEMES } = await import("../lib/look.ts");
	for (const accent of ACCENTS) assert.equal(themeNameFor("light", accent), "Fisi-Dock-Light", accent);
	assert.equal(themeNameFor("light"), "Fisi-Dock-Light");
	assert.ok(FISI_DOCK_THEMES.includes("Fisi-Dock-Light"));
	assert.equal(new Set(FISI_DOCK_THEMES).size, FISI_DOCK_THEMES.length, "each theme once");
	assert.deepEqual(normalizeLook({ colors: "light", accent: "teal" }), { ...DEFAULT_LOOK, colors: "light", accent: "teal" }, "light is saved with the accent it was picked with");
	for (const colors of ["Light", "dark", "LIGHT"]) assert.equal(normalizeLook({ colors }).colors, "vivid", colors);
});

const ids = (look: { sections: { id: string; shown: boolean }[] }) => look.sections.map((section) => `${section.shown ? "" : "!"}${section.id}`).join(" ");

test("look-more S6 the sections are heads-up, odd, rdd, ci, agents, todo and changes, today's order, every one shown; session is not in the list", () => {
	assert.deepEqual(SECTION_IDS, ["heads-up", "odd", "rdd", "ci", "agents", "todo", "changes"]);
	assert.deepEqual(DEFAULT_SECTIONS, SECTION_IDS.map((id) => ({ id, shown: true })));
	assert.deepEqual(DEFAULT_LOOK.sections, DEFAULT_SECTIONS);
	assert.ok(!(SECTION_IDS as readonly string[]).includes("session"));
	assert.ok(!Object.hasOwn(LOOK_OPTIONS, "sections"), "not a ←→ row");
});

test("look-more S6 normalizeLook keeps the saved order and the hidden ones; unknown ids and duplicates drop, missing ones come last in today's order, shown", () => {
	const saved = [{ id: "todo", shown: true }, { id: "odd", shown: false }, { id: "changes", shown: true }, { id: "heads-up", shown: false }, { id: "ci", shown: true }, { id: "agents", shown: true }, { id: "rdd", shown: false }];
	assert.deepEqual(normalizeLook({ sections: saved }).sections, saved, "a full list as saved");
	assert.equal(ids(normalizeLook({ sections: [{ id: "session", shown: false }, { id: "todo", shown: false }, { id: "mcp", shown: true }, { id: "TODO", shown: true }, { id: "toString", shown: true }] })), "!todo heads-up odd rdd ci agents changes", "unknown ids (session too) drop");
	assert.equal(ids(normalizeLook({ sections: [{ id: "ci", shown: false }, { id: "ci", shown: true }, { id: "odd", shown: true }, { id: "ci", shown: true }] })), "!ci odd heads-up rdd agents todo changes", "the first of each id wins");
	assert.equal(ids(normalizeLook({ sections: [{ id: "changes", shown: true }] })), "changes heads-up odd rdd ci agents todo", "missing ones appended shown");
	assert.equal(ids(normalizeLook({ sections: [] })), ids(DEFAULT_LOOK), "an empty list is today's");
	assert.equal(ids(normalizeLook({ sections: [null, 3, "todo", ["odd"], { shown: false }, { id: 1 }, { id: "rdd", shown: "no" }, { id: "agents" }] })), "rdd agents heads-up odd ci todo changes", "bad entries drop; only shown false hides");
	for (const sections of [undefined, null, "todo", 7, true, { id: "todo", shown: false }, { 0: { id: "todo", shown: false } }]) assert.deepEqual(normalizeLook({ sections }).sections, DEFAULT_SECTIONS, `garbage ${JSON.stringify(sections)}`);
	assert.deepEqual(normalizeLook({ logo: "text", frames: "none", colors: "soft", accent: "teal", divider: "off", motion: "off" }), { logo: "text", frames: "none", colors: "soft", accent: "teal", divider: "off", motion: "off", sections: DEFAULT_SECTIONS }, "a look saved before sections reads today's sections");
	const entry = { id: "todo", shown: false, extra: 1 };
	const read = normalizeLook({ sections: [entry] });
	assert.deepEqual(read.sections[0], { id: "todo", shown: false }, "only id and shown");
	read.sections[1].shown = false;
	assert.equal(normalizeLook(undefined).sections[0].shown, true, "fresh entries, never DEFAULT_SECTIONS' own");
	assert.equal(DEFAULT_SECTIONS[0].shown, true);
});
