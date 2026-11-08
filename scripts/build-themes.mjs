// The accent themes (look-more S4): `Fisi-Dock-<Accent>.json` and `Fisi-Dock-<Accent>-Soft.json`,
// generated from the two pink themes, themes/Fisi-Dock.json and themes/Fisi-Dock-Soft.json,
// never kept by hand. Only the pink-family vars change: `pink` (accent, borderAccent,
// mdListBullet, thinkingXhigh) becomes the theme's own var of the accent (vivid in the vivid
// source, pastel in the soft one), lifted until it reads on the background at least as well as
// the pink did; `deepPink` (searchMatchBg, mdQuoteBorder) and `pinkSelection` (selectedBg) move
// to its hue keeping their saturation and luminance (lib/palette.ts retone). Every other var,
// role and key stays. The panel paints the same tones (lib/palette.ts accentLabel, accentTone).
//
//   npm run build:themes
//
// Deterministic and idempotent: tests/build-themes.test.ts checks the files are its output.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ACCENTS, COLOR_MODES, themeNameFor } from "../lib/look.ts";
import { contrast, liftContrast, retone } from "../lib/palette.ts";

const rgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const hex = (color) => `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

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
		for (const mode of COLOR_MODES) out[`${themeNameFor(mode, accent)}.json`] = `${JSON.stringify(accentTheme(sources[mode], accent, mode), null, 2)}\n`;
	}
	return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const themes = new URL("../themes/", import.meta.url);
	const read = (file) => JSON.parse(readFileSync(new URL(file, themes), "utf8"));
	for (const [file, text] of Object.entries(buildThemes({ vivid: read("Fisi-Dock.json"), soft: read("Fisi-Dock-Soft.json") }))) {
		writeFileSync(new URL(file, themes), text);
		console.log(`themes/${file}`);
	}
}
