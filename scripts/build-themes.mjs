// The accent themes (look-more S4): `Fisi-Dock-<Accent>.json` and `Fisi-Dock-<Accent>-Soft.json`,
// generated from the two pink themes, themes/Fisi-Dock.json and themes/Fisi-Dock-Soft.json,
// never kept by hand. Only the pink-family vars change: `pink` (accent, borderAccent,
// mdListBullet, thinkingXhigh) becomes the theme's own var of the accent (vivid in the vivid
// source, pastel in the soft one), lifted until it reads on the background at least as well as
// the pink did; `deepPink` (searchMatchBg, mdQuoteBorder) and `pinkSelection` (selectedBg) move
// to its hue keeping their saturation and luminance (lib/palette.ts retone). Every other var,
// role and key stays. The panel paints the same tones (lib/palette.ts accentLabel, accentTone).
//
// The light theme (look-more S5): `Fisi-Dock-Light.json` from Fisi-Dock.json, every var as the
// panel paints it on a light background (lib/palette.ts lightColor): the backgrounds, borders and
// tints mirrored onto #fafafa, the text roles dark enough to read 4.5:1 on every background text
// sits on, and `deepPink`, which is also the search match background, light enough for the text
// to read 4.5:1 on it. Every role, key and export stays; one light theme for every accent.
//
//   npm run build:themes
//
// Deterministic and idempotent: tests/build-themes.test.ts checks the files are its output.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ACCENTS, themeNameFor } from "../lib/look.ts";
import { LIGHT_TEXT_CONTRAST, contrast, lightColor, liftContrast, retone } from "../lib/palette.ts";

const rgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const hex = (color) => `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

/** The dark themes an accent has, each from its pink source. */
const DARK_MODES = ["vivid", "soft"];

/** The theme `source` (the pink theme of color mode `mode`) on `accent`. */
export function accentTheme(source, accent, mode) {
	const vars = source.vars;
	const background = rgb(vars.bg);
	const pink = liftContrast(rgb(vars[accent]), contrast(rgb(vars.pink), background), background);
	const tone = (name) => hex(retone(rgb(vars[name]), pink));
	return { ...source, name: themeNameFor(mode, accent), vars: { ...vars, pink: hex(pink), deepPink: tone("deepPink"), pinkSelection: tone("pinkSelection") } };
}

/** Every accent theme from the pink `sources`, file name to its JSON text, per accent vivid then soft. */
export function buildThemes(sources) {
	const out = {};
	for (const accent of ACCENTS.filter((name) => name !== "pink")) {
		for (const mode of DARK_MODES) out[`${themeNameFor(mode, accent)}.json`] = `${JSON.stringify(accentTheme(sources[mode], accent, mode), null, 2)}\n`;
	}
	return out;
}

/** The vars text is painted in, and the backgrounds it is painted on (bgHighlight is the panel's highlight row). */
const TEXT_VARS = ["text", "muted", "dim", "pink", "teal", "coral", "amber", "lilac", "green", "blue", "red"];
const TEXT_BACKGROUNDS = ["bgBar", "bgHighlight", "pinkSelection", "diffAddedBg", "toolErrorBg"];

/** Fisi-Dock-Light from the vivid pink theme `source` (look-more S5). */
export function lightTheme(source) {
	const mirrored = Object.fromEntries(Object.entries(source.vars).map(([name, value]) => [name, lightColor(rgb(value))]));
	// Text reads AA on every background it sits on: on bg, that much more as the darkest of them is darker.
	const floor = LIGHT_TEXT_CONTRAST * Math.max(...TEXT_BACKGROUNDS.map((name) => contrast(mirrored[name], mirrored.bg)));
	const vars = Object.fromEntries(Object.entries(source.vars).map(([name, value]) => [name, hex(TEXT_VARS.includes(name) ? lightColor(rgb(value), floor) : mirrored[name])]));
	vars.deepPink = hex(liftContrast(mirrored.deepPink, LIGHT_TEXT_CONTRAST, rgb(vars.text)));
	return { ...source, name: themeNameFor("light"), appearance: "light", vars };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const themes = new URL("../themes/", import.meta.url);
	const read = (file) => JSON.parse(readFileSync(new URL(file, themes), "utf8"));
	const vivid = read("Fisi-Dock.json");
	const files = { ...buildThemes({ vivid, soft: read("Fisi-Dock-Soft.json") }), [`${themeNameFor("light")}.json`]: `${JSON.stringify(lightTheme(vivid), null, 2)}\n` };
	for (const [file, text] of Object.entries(files)) {
		writeFileSync(new URL(file, themes), text);
		console.log(`themes/${file}`);
	}
}
