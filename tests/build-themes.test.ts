import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildThemes } from "../scripts/build-themes.mjs";

// look-more S4: the accent themes are generated from the two pink themes, never kept by hand.
const raw = (file: string) => readFileSync(new URL(`../themes/${file}`, import.meta.url), "utf8");
const sources = () => ({ vivid: JSON.parse(raw("Fisi-Dock.json")), soft: JSON.parse(raw("Fisi-Dock-Soft.json")) });
const FILES = ["Fisi-Dock-Teal.json", "Fisi-Dock-Teal-Soft.json", "Fisi-Dock-Lilac.json", "Fisi-Dock-Lilac-Soft.json", "Fisi-Dock-Amber.json", "Fisi-Dock-Amber-Soft.json", "Fisi-Dock-Green.json", "Fisi-Dock-Green-Soft.json"];

const deepFreeze = <T>(value: T): T => {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
};

test("look-more S4 buildThemes writes the eight accent themes, vivid and soft per accent, as 2-space JSON with a final newline", () => {
	const out = buildThemes(sources());
	assert.deepEqual(Object.keys(out), FILES);
	for (const [file, text] of Object.entries(out)) {
		assert.ok(text.endsWith("}\n") && !text.endsWith("\n\n"), file);
		assert.equal(text, `${JSON.stringify(JSON.parse(text), null, 2)}\n`, `${file}: 2-space JSON`);
		assert.equal(JSON.parse(text).name, file.slice(0, -5));
	}
});

test("look-more S4 buildThemes is pure and deterministic: frozen sources stay as they were, every run gives the same text", () => {
	const frozen = deepFreeze(sources());
	const first = buildThemes(frozen);
	assert.deepEqual(frozen, sources(), "the sources are not touched");
	assert.deepEqual(buildThemes(frozen), first);
	assert.deepEqual(buildThemes(sources()), first);
});

test("look-more S4 the checked-in accent themes are exactly the generator's output, so they never drift (npm run build:themes rewrites them)", () => {
	for (const [file, text] of Object.entries(buildThemes(sources()))) assert.equal(raw(file), text, `${file}: run npm run build:themes`);
	const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	assert.equal(manifest.scripts["build:themes"], "node scripts/build-themes.mjs");
});

test("look-more S4 the pink sources are in the generator's own format, so a rebuild is idempotent", () => {
	for (const file of ["Fisi-Dock.json", "Fisi-Dock-Soft.json"]) assert.equal(raw(file), `${JSON.stringify(JSON.parse(raw(file)), null, 2)}\n`, file);
});

// look-more S5 "Un solo tema claro": Fisi-Dock-Light, generated from Fisi-Dock.json like the accent themes.
const rgbOf = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as unknown as readonly [number, number, number];

test("look-more S5 the checked-in Fisi-Dock-Light.json is exactly lightTheme(Fisi-Dock.json): pure, deterministic, 2-space JSON", async () => {
	const { lightTheme } = await import("../scripts/build-themes.mjs");
	const frozen = deepFreeze(sources().vivid);
	const text = `${JSON.stringify(lightTheme(frozen), null, 2)}\n`;
	assert.deepEqual(frozen, sources().vivid, "the source is not touched");
	assert.equal(raw("Fisi-Dock-Light.json"), text, "run npm run build:themes");
	assert.equal(`${JSON.stringify(lightTheme(sources().vivid), null, 2)}\n`, text);
});

test("look-more S5 Fisi-Dock-Light keeps Fisi-Dock's shape: the same vars, roles and export keys and every role on the same var; name Fisi-Dock-Light, appearance light", () => {
	const dark = JSON.parse(raw("Fisi-Dock.json"));
	const light = JSON.parse(raw("Fisi-Dock-Light.json"));
	assert.equal(light.name, "Fisi-Dock-Light");
	assert.equal(light.appearance, "light");
	assert.equal(light.$schema, dark.$schema);
	assert.deepEqual(Object.keys(light), Object.keys(dark));
	assert.deepEqual(Object.keys(light.vars), Object.keys(dark.vars));
	assert.deepEqual(light.colors, dark.colors, "every role points at the same var");
	assert.deepEqual(light.export, dark.export);
	for (const [name, value] of Object.entries(light.vars)) assert.match(value as string, /^#[0-9a-f]{6}$/, name);
	assert.equal(light.vars.bg, "#fafafa");
});

test("look-more S5 Fisi-Dock-Light reads AA: every text role 4.5:1 on the background and on every background text sits on; search matches readable; selection, diffs and tool errors light tints", async () => {
	const { contrast } = await import("../lib/palette.ts");
	const vars = JSON.parse(raw("Fisi-Dock-Light.json")).vars as Record<string, string>;
	const textVars = ["text", "muted", "dim", "pink", "teal", "coral", "amber", "lilac", "green", "blue", "red"];
	const backgrounds = ["bg", "bgBar", "bgHighlight", "pinkSelection", "diffAddedBg", "toolErrorBg"];
	for (const name of textVars) {
		for (const background of backgrounds) {
			const ratio = contrast(rgbOf(vars[name]), rgbOf(vars[background]));
			assert.ok(ratio >= 4.5, `${name} on ${background}: ${ratio.toFixed(2)}`);
		}
	}
	assert.ok(contrast(rgbOf(vars.text), rgbOf(vars.bg)) >= 13, "dark text");
	assert.ok(contrast(rgbOf(vars.text), rgbOf(vars.deepPink)) >= 4.5, "searchMatchText on searchMatchBg");
	assert.ok(contrast(rgbOf(vars.deepPink), rgbOf(vars.bg)) >= 3, "mdQuoteBorder shows on the background");
	for (const name of backgrounds.slice(1)) {
		const [r, g, b] = rgbOf(vars[name]);
		assert.ok(Math.min(r, g, b) >= 0xc0 && contrast(rgbOf(vars[name]), rgbOf(vars.bg)) < 1.5, `${name} a light tint: ${vars[name]}`);
	}
	for (const name of ["border", "borderSubtle"]) assert.ok(contrast(rgbOf(vars[name]), rgbOf(vars.bg)) < 1.6, `${name} subtle on light`);
});
