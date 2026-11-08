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
