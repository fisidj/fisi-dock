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
	assert.equal(theme.vars[theme.colors.accent], "#f2a7c9");
});

test("the package ships the theme folder like Gentle Shell does", () => {
	assert.deepEqual(manifest.pi.themes, ["./themes"]);
});

// S47: Grok palette measured from the user's screenshot (text, muted, amber, frame).
test("Grok palette: theme and panel share text #e1e1e1, muted #6c6c6c, amber #e0af68; frames #454545 (S47)", async () => {
	const { palette } = await import("../lib/palette.ts");
	const theme = JSON.parse((await import("node:fs")).readFileSync(new URL("../themes/Fisi-Dock.json", import.meta.url), "utf8"));
	assert.equal(theme.vars.text, "#e1e1e1");
	assert.equal(theme.vars.muted, "#6c6c6c");
	assert.equal(theme.vars.amber, "#e0af68");
	assert.deepEqual([...palette.text], [0xe1, 0xe1, 0xe1]);
	assert.deepEqual([...palette.muted], [0x6c, 0x6c, 0x6c]);
	assert.deepEqual([...palette.amber], [0xe0, 0xaf, 0x68]);
	assert.deepEqual([...palette.frame], [0x45, 0x45, 0x45]);
});
