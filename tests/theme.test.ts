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
