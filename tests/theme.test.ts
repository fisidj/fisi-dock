import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const theme = read("../themes/Fisi-Dock.json");
const manifest = read("../package.json");

// Every color role Gentle Shell's own Gentleman-Cute theme defines, plus Pi's scrollbar track.
const ROLES = [
	"accent", "border", "borderAccent", "borderMuted", "success", "error", "warning", "muted", "dim", "text",
	"thinkingText", "selectedBg", "scrollbarThumb", "scrollbarTrack", "searchMatchBg", "searchMatchText",
	"userMessageBg", "userMessageText", "customMessageBg", "customMessageText", "customMessageLabel",
	"toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput", "mdHeading", "mdLink",
	"mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr",
	"mdListBullet", "toolDiffAdded", "toolDiffRemoved", "toolDiffContext", "syntaxComment", "syntaxKeyword",
	"syntaxFunction", "syntaxVariable", "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator",
	"syntaxPunctuation", "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh",
	"thinkingXhigh", "thinkingMax", "bashMode",
];

test("the Fisi-Dock theme is named like its file and is a dark theme", () => {
	assert.equal(theme.name, "Fisi-Dock");
	assert.ok(!theme.name.includes("/") && theme.name !== "system");
	assert.equal(theme.appearance, "dark");
});

test("the theme defines every color role and each one resolves to a hex color", () => {
	const resolve = (value: string): string => (value.startsWith("#") ? value : resolve(theme.vars[value]));
	for (const role of ROLES) {
		assert.ok(role in theme.colors, `missing role ${role}`);
		assert.match(resolve(theme.colors[role]), /^#[0-9a-f]{6}$/i, role);
	}
	for (const [key, value] of Object.entries(theme.export)) assert.match(resolve(value as string), /^#[0-9a-f]{6}$/i, key);
});

test("selection is pink-tinted so the chosen option stands out (S10)", () => {
	assert.equal(theme.vars[theme.colors.selectedBg], "#2a2228");
	assert.equal(theme.vars[theme.colors.accent], "#f5388e", "the vivid pink (S4)");
});

test("the package ships the theme folder like Gentle Shell does", () => {
	assert.deepEqual(manifest.pi.themes, ["./themes"]);
});

// S47: Grok palette measured from the user's screenshot (text, muted, amber, frame).
// Vivid labels S4: the theme's amber is the panel's amber made vivid.
test("Grok palette: theme and panel share text #e1e1e1, muted #6c6c6c; the theme's amber #f5a838 is the panel's #e0af68 made vivid; frames #454545 (S47, S4)", async () => {
	const { palette } = await import("../lib/palette.ts");
	const theme = JSON.parse((await import("node:fs")).readFileSync(new URL("../themes/Fisi-Dock.json", import.meta.url), "utf8"));
	assert.equal(theme.vars.text, "#e1e1e1");
	assert.equal(theme.vars.muted, "#6c6c6c");
	assert.equal(theme.vars.amber, "#f5a838");
	assert.deepEqual([...palette.text], [0xe1, 0xe1, 0xe1]);
	assert.deepEqual([...palette.muted], [0x6c, 0x6c, 0x6c]);
	assert.deepEqual([...palette.amber], [0xe0, 0xaf, 0x68]);
	assert.deepEqual([...palette.frame], [0x45, 0x45, 0x45]);
});

// Vivid labels S4: the theme's accents are the panel's pastels made vivid (S1); neutrals and backgrounds stay.
test("theme accents are the vivid version of the panel's pastels; neutrals and backgrounds stay (S4)", async () => {
	const { palette, vivid } = await import("../lib/palette.ts");
	const hex = (rgb: readonly number[]) => `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
	const accents = { pink: "#f5388e", deepPink: "#f53894", teal: "#38e3f5", coral: "#f55a38", amber: "#f5a838", lilac: "#9464f7", green: "#38f538", blue: "#4c76f6", red: "#f53838" } as const;
	for (const [name, value] of Object.entries(accents)) {
		assert.equal(theme.vars[name], value, name);
		assert.equal(theme.vars[name], hex(vivid(palette[name as keyof typeof accents])), `${name} is vivid(${hex(palette[name as keyof typeof accents])})`);
	}
	assert.deepEqual(
		Object.fromEntries(Object.entries(theme.vars).filter(([name]) => !(name in accents))),
		{ bg: "#161616", bgBar: "#1f1f1f", bgHighlight: "#262626", border: "#2a2a2a", borderSubtle: "#222222", text: "#e1e1e1", muted: "#6c6c6c", dim: "#6b6b6b", pinkSelection: "#2a2228", diffAddedBg: "#24321f", toolErrorBg: "#2e1a1d" },
	);
});

// Look settings S4: Fisi-Dock-Soft is the Fisi-Dock theme as it was before 0.3.0 (ce511ae^), the pastel accents.
test("S4 the Fisi-Dock-Soft theme: same roles and keys as Fisi-Dock, the pre-0.3.0 pastel accents, the panel's palette", async () => {
	const { palette } = await import("../lib/palette.ts");
	const soft = read("../themes/Fisi-Dock-Soft.json");
	const hex = (rgb: readonly number[]) => `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
	assert.equal(soft.name, "Fisi-Dock-Soft");
	assert.equal(soft.appearance, "dark");
	assert.deepEqual(Object.keys(soft), Object.keys(theme), "top-level keys");
	for (const key of ["vars", "colors", "export"]) assert.deepEqual(Object.keys(soft[key]), Object.keys(theme[key]), key);
	assert.deepEqual(soft.colors, theme.colors, "the same roles on the same vars");
	assert.deepEqual(soft.export, theme.export);
	const accents = { pink: "#f2a7c9", deepPink: "#c9779f", teal: "#5fd4e0", coral: "#ff9b85", amber: "#e0af68", lilac: "#c3a6ff", green: "#8fc98f", blue: "#7b9cff", red: "#ff6b6b" } as const;
	for (const [name, value] of Object.entries(accents)) {
		assert.equal(soft.vars[name], value, name);
		assert.equal(value, hex(palette[name as keyof typeof accents]), `${name} is the panel's own color`);
	}
	assert.deepEqual(
		Object.fromEntries(Object.entries(soft.vars).filter(([name]) => !(name in accents))),
		Object.fromEntries(Object.entries(theme.vars).filter(([name]) => !(name in accents))),
		"neutrals and backgrounds as in Fisi-Dock",
	);
	const resolve = (value: string): string => (value.startsWith("#") ? value : resolve(soft.vars[value]));
	for (const role of ROLES) assert.match(resolve(soft.colors[role]), /^#[0-9a-f]{6}$/i, role);
	assert.equal(soft.vars[soft.colors.selectedBg], "#2a2228", "selection stays pink-tinted (S10)");
});

// --- look-more S4: the accent themes, generated from Fisi-Dock and Fisi-Dock-Soft by scripts/build-themes.mjs ---

const ACCENT_THEMES = { teal: "Teal", lilac: "Lilac", amber: "Amber", green: "Green" } as const;
/** The pink-family vars: accent, borderAccent, mdListBullet, thinkingXhigh (pink); searchMatchBg, mdQuoteBorder (deepPink); selectedBg (pinkSelection). */
const ACCENT_VARS = ["pink", "deepPink", "pinkSelection"];

test("look-more S4 the themes folder holds the ten Fisi Dock themes, named like their files", async () => {
	const { readdirSync } = await import("node:fs");
	const { FISI_DOCK_THEMES } = await import("../lib/look.ts");
	const files = readdirSync(new URL("../themes/", import.meta.url)).filter((file) => file.endsWith(".json")).sort();
	assert.deepEqual(files, [...FISI_DOCK_THEMES].map((name) => `${name}.json`).sort());
	assert.equal(files.length, 10);
	for (const file of files) assert.equal(read(`../themes/${file}`).name, file.slice(0, -5), file);
});

test("look-more S4 each accent theme is its source with only the pink-family vars on the accent: same keys and roles, every role a hex color, the accent reading at least as well as pink", async () => {
	const { accentLabel, accentTone, contrast, labelAccent, palette } = await import("../lib/palette.ts");
	const hex = (rgb: readonly number[]) => `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
	const rgbOf = (value: string) => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16)) as unknown as readonly [number, number, number];
	const sources = { vivid: theme, soft: read("../themes/Fisi-Dock-Soft.json") };
	for (const [accent, title] of Object.entries(ACCENT_THEMES) as [keyof typeof ACCENT_THEMES, string][]) {
		for (const mode of ["vivid", "soft"] as const) {
			const name = `Fisi-Dock-${title}${mode === "soft" ? "-Soft" : ""}`;
			const source = sources[mode];
			const out = read(`../themes/${name}.json`);
			assert.equal(out.name, name);
			assert.equal(out.appearance, "dark");
			assert.equal(out.$schema, source.$schema);
			assert.deepEqual(Object.keys(out), Object.keys(source), `${name} top-level keys`);
			for (const key of ["vars", "colors", "export"]) assert.deepEqual(Object.keys(out[key]), Object.keys(source[key]), `${name} ${key} keys`);
			assert.deepEqual(out.colors, source.colors, `${name}: the same roles on the same vars`);
			assert.deepEqual(out.export, source.export);
			const changed = Object.keys(source.vars).filter((key) => out.vars[key] !== source.vars[key]);
			assert.deepEqual(changed, ACCENT_VARS, `${name}: only the pink-family vars change`);
			for (const key of ACCENT_VARS) assert.match(out.vars[key], /^#[0-9a-f]{6}$/, `${name} ${key}`);
			assert.equal(out.vars.pink, hex(accentLabel(accent, mode)), `${name}: the panel's accent tone`);
			assert.equal(out.vars.deepPink, hex(accentTone(labelAccent(palette.deepPink, mode), accent, mode)), `${name}: deepPink on the accent`);
			assert.equal(out.vars.pinkSelection, hex(accentTone(rgbOf(source.vars.pinkSelection), accent, mode)), `${name}: the selection tint on the accent`);
			const bg = rgbOf(out.vars.bg);
			assert.ok(contrast(rgbOf(out.vars.pink), bg) >= contrast(rgbOf(source.vars.pink), bg), `${name}: accent contrast floor`);
			const resolve = (value: string): string => (value.startsWith("#") ? value : resolve(out.vars[value]));
			for (const role of ROLES) assert.match(resolve(out.colors[role]), /^#[0-9a-f]{6}$/i, `${name} ${role}`);
		}
	}
});
