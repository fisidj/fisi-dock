import assert from "node:assert/strict";
import test from "node:test";
import { renderNarrowHeader, renderHeaderLine } from "../lib/header.ts";
import { wavePetal, waveLabel } from "../lib/label-wave.ts";
import { renderLoadedBox } from "../lib/loaded-box.ts";
import { ACCENTS, DEFAULT_LOOK, FRAME_STYLES } from "../lib/look.ts";
import { BACKGROUND, LIGHT_BACKGROUND, accentBase, accentLabel, bgCode, contrast, dim, fadeAmount, fadedEdge, fgCode, labelAccent, lightColor, lightPalette, paint, palette, panelAccent, panelVivid, vivid, type Rgb } from "../lib/palette.ts";
import { samplePanelModel, type PanelModel } from "../lib/panel-model.ts";
import { DOCK_WIDTH, renderAgentsCard, renderDock, renderPanel, renderRail, renderTodoCard } from "../lib/panel.ts";
import { boxPromptRows } from "../lib/prompt-box.ts";
import { promptLineParts, renderPromptLine } from "../lib/prompt-line.ts";
import { renderSettings } from "../lib/settings-menu.ts";
import { renderStrip } from "../lib/strip.ts";
import { visibleWidth } from "../lib/text.ts";
import { frameUserLines } from "../lib/user-frame.ts";
import { renderWelcomeCard } from "../lib/welcome-card.ts";

// look-more S5 "Un solo tema claro": colors light repaints everything Fisi Dock paints
// itself for a light terminal background. Every 24-bit color Fisi Dock paints in vivid
// becomes lightColor of it: dark text and fades toward the light background.

const plain = (line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\]133;[ABC]\x07/g, "");
const COLOR = /\x1b\[(38|48);2;(\d+);(\d+);(\d+)m/g;
const codeOf = (kind: string, color: Rgb) => (kind === "38" ? fgCode(color) : bgCode(color));
/** `text` with each 24-bit color Fisi Dock painted (every one, except the `keep` codes from Gentle Shell or Pi) as lightColor of it. */
const lightOf = (text: string, keep: readonly string[] = []) =>
	text.replace(COLOR, (code, kind: string, r: string, g: string, b: string) => (keep.includes(code) ? code : codeOf(kind, lightColor([Number(r), Number(g), Number(b)]))));
const colorsIn = (lines: string[]) => [...lines.join("\n").matchAll(COLOR)].map((match) => match[0]);
/** Today's dark text on words and its highlight row: neither is painted in light. Frame glyphs are left out, a light fade may land on any gray. */
const noDarkNeutrals = (lines: string[], label: string) => {
	const all = lines.join("\n");
	// The glyph right after each of today's text codes (bold or not): none is a letter or a digit.
	const after = (code: string) => all.split(code).slice(1).map((rest) => rest.replace(/^\x1b\[1m/, "")[0] ?? "").join("");
	assert.ok(!/[A-Za-z0-9]/.test(after(fgCode(palette.text))), `${label}: a word in today's dark-theme text`);
	assert.ok(!all.includes(bgCode(palette.highlight)), `${label}: today's highlight row`);
};

const HUES = ["pink", "deepPink", "teal", "coral", "amber", "lilac", "green", "blue", "red", "purple", "sexyPink", "rose"] as const;

// --- the light palette ----------------------------------------------------------------

test("look-more S5 the light background is Fisi-Dock-Light's #fafafa, and the dark background maps onto it", () => {
	assert.deepEqual([...LIGHT_BACKGROUND], [0xfa, 0xfa, 0xfa]);
	assert.deepEqual([...lightColor(BACKGROUND)], [...LIGHT_BACKGROUND]);
});

test("look-more S5 the light palette: text and muted read AA (4.5:1) on the light background; every hue too, as itself, as a vivid label and as a panel title", () => {
	assert.ok(contrast(lightPalette.text, LIGHT_BACKGROUND) >= 13, `text ${contrast(lightPalette.text, LIGHT_BACKGROUND)}`);
	assert.ok(contrast(lightPalette.muted, LIGHT_BACKGROUND) >= 4.5, "muted reads AA, above today's 3.45:1");
	for (const hue of HUES) {
		assert.ok(contrast(lightPalette[hue], LIGHT_BACKGROUND) >= 4.5, `${hue} ${contrast(lightPalette[hue], LIGHT_BACKGROUND)}`);
		assert.ok(contrast(labelAccent(palette[hue], "light"), LIGHT_BACKGROUND) >= 4.5, `${hue} label`);
		assert.ok(contrast(panelAccent(palette[hue], "light"), LIGHT_BACKGROUND) >= 4.5, `${hue} title`);
	}
	for (const accent of ACCENTS) {
		assert.ok(contrast(accentLabel(accent, "light"), LIGHT_BACKGROUND) >= 4.5, `${accent} accent label`);
		assert.ok(contrast(accentBase(accent, "light"), LIGHT_BACKGROUND) >= 4.5, `${accent} accent base (the highlight bar, the wave head)`);
	}
});

test("look-more S5 decorative glyphs keep today's contrast on light (the documented floor): faint, frame, the logo's deep pink, the highlight row", () => {
	for (const name of ["faint", "frame", "sexyDeepPink", "highlight"] as const) {
		const dark = contrast(palette[name]);
		const light = contrast(lightPalette[name], LIGHT_BACKGROUND);
		assert.ok(light >= dark - 1e-9 && light < dark + 0.1, `${name}: ${dark} on dark, ${light} on light`);
		assert.ok(light < 4.5, `${name} stays decorative`);
	}
	assert.ok(contrast(lightPalette.text, lightPalette.highlight) >= 4.5, "text reads on a highlight row");
	assert.ok(contrast(lightPalette.highlight, LIGHT_BACKGROUND) > 1.1, "the highlight row shows against the background");
});

test("look-more S5 every light palette color keeps its hue's family: a neutral stays gray, a hue keeps its hue within a few degrees", () => {
	for (const name of ["text", "muted", "faint", "frame", "highlight"] as const) {
		const [r, g, b] = lightPalette[name];
		assert.ok(r === g && g === b, `${name} gray`);
	}
	const hueOf = ([r, g, b]: Rgb) => {
		const [x, y, z] = [r / 255, g / 255, b / 255];
		const max = Math.max(x, y, z);
		const spread = max - Math.min(x, y, z);
		const raw = max === x ? ((y - z) / spread) % 6 : max === y ? (z - x) / spread + 2 : (x - y) / spread + 4;
		return (raw * 60 + 360) % 360;
	};
	for (const hue of HUES) {
		const delta = Math.abs(hueOf(lightPalette[hue]) - hueOf(palette[hue]));
		assert.ok(Math.min(delta, 360 - delta) < 6, `${hue}: ${delta}°`);
	}
});

test("look-more S5 lightColor reads at least as today on dark up to the hue target: neutrals mirror their contrast, hues past 5.5:1 settle at 5.5:1, nothing dimmer than it was", () => {
	for (const amount of [0.05, 0.2, 0.35, 0.55, 1]) {
		const fade = dim(palette.text, amount);
		const light = contrast(lightColor(fade), LIGHT_BACKGROUND);
		const dark = contrast(fade);
		assert.ok(light >= dark - 1e-9 && light < dark + 0.1, `fade ${amount}: ${dark} -> ${light}`);
	}
	for (const hue of HUES) {
		const dark = contrast(palette[hue]);
		const light = contrast(lightPalette[hue], LIGHT_BACKGROUND);
		assert.ok(light >= Math.min(dark, 5.5) - 1e-9 && light < Math.min(dark, 5.5) + 0.4, `${hue}: ${dark} -> ${light}`);
	}
	assert.equal(lightColor(palette.teal), lightColor(palette.teal), "memoized: the same color each call");
});

test("look-more S5 fades blend toward the light background: the ends of a faded edge sink into #fafafa, its middle is the darkest", () => {
	const width = 40;
	const edge = fadedEdge("─".repeat(width), 0, width, "light");
	const colors = colorsIn([edge]).map((code) => code.match(/\d+/g)!.slice(2).map(Number) as unknown as Rgb);
	assert.equal(colors.length, width);
	for (const [index, color] of colors.entries()) assert.deepEqual([...color], [...lightColor(dim(palette.text, fadeAmount(index, width)))], `cell ${index}`);
	const ends = [colors[0], colors[width - 1]].map((color) => contrast(color, LIGHT_BACKGROUND));
	for (const end of ends) assert.ok(end < 1.02, `an end sinks into the background: ${end}`);
	const middle = contrast(colors[width / 2], LIGHT_BACKGROUND);
	assert.ok(colors.every((color) => contrast(color, LIGHT_BACKGROUND) <= middle + 1e-9), "brightest... darkest at the middle");
	assert.ok(colors.every((color) => color[0] <= LIGHT_BACKGROUND[0]), "never lighter than the background");
	assert.equal(fadedEdge("─ ─", 0, 3), fadedEdge("─ ─", 0, 3, "vivid"), "vivid unchanged");
});

test("look-more S5 paint maps each 24-bit color of a Fisi Dock string to lightColor in light, foreground and background; vivid and soft leave it as it is", () => {
	const text = `${fgCode(palette.text)}a\x1b[39m ${bgCode(palette.highlight)}${fgCode(palette.teal)}b\x1b[39m\x1b[49m \x1b[1mc\x1b[22m`;
	assert.equal(paint(text, "light"), `${fgCode(lightPalette.text)}a\x1b[39m ${bgCode(lightPalette.highlight)}${fgCode(lightPalette.teal)}b\x1b[39m\x1b[49m \x1b[1mc\x1b[22m`);
	assert.equal(paint(text, "vivid"), text);
	assert.equal(paint(text, "soft"), text);
	assert.equal(paint(text), text);
});

// --- each site --------------------------------------------------------------------------

const lookModel: PanelModel = {
	...samplePanelModel,
	headsUp: [{ kind: "unpushed", text: "1 commit not pushed" }],
	ci: { sha: "fb7ca9d", checks: [{ name: "test", state: "running", seconds: 12 }] },
};

test("look-more S5 the rail, the panel and /dock in light: vivid's lines with every color in the light palette, in every frame style, logo, divider and accent", () => {
	for (const frames of FRAME_STYLES) {
		for (const logo of ["braille", "text"] as const) {
			for (const accent of ["pink", "teal"] as const) {
				const base = { frames, logo, accent };
				const label = `${frames}/${logo}/${accent}`;
				const views: [string, string[], string[]][] = [
					["panel", renderPanel(lookModel, 55, { ...base, colors: "light" }), renderPanel(lookModel, 55, { ...base, colors: "vivid" })],
					["rail", renderRail(lookModel, 57, { ...base, colors: "light", maxRows: 60, divider: "strong" }), renderRail(lookModel, 57, { ...base, colors: "vivid", maxRows: 60, divider: "strong" })],
					["dock", renderDock(lookModel, DOCK_WIDTH + 2, 200, 0, { ...base, colors: "light" }).lines, renderDock(lookModel, DOCK_WIDTH + 2, 200, 0, { ...base, colors: "vivid" }).lines],
				];
				for (const [name, light, vividLines] of views) {
					assert.deepEqual(light, vividLines.map((line) => lightOf(line)), `${name} ${label}`);
					noDarkNeutrals(light, `${name} ${label}`);
				}
			}
		}
	}
});

test("look-more S5 the light rail paints the light palette: text, muted, the faded frames toward #fafafa, the section titles and the highlight row", () => {
	const lines = renderRail(lookModel, 57, { colors: "light", maxRows: 60 });
	const all = lines.join("\n");
	assert.ok(all.includes(fgCode(lightPalette.text)), "dark text");
	assert.ok(all.includes(fgCode(lightPalette.muted)), "muted");
	assert.ok(all.includes(fgCode(panelAccent(palette.teal, "light"))), "the session title in its light teal");
	assert.ok(all.includes(bgCode(lightPalette.highlight)), "the highlight row light");
	assert.ok(all.includes(`${fgCode(accentBase("pink", "light"))}▎`), "the highlight bar in the light pink");
	// The divider's first and last cells fade out into the background (blank), its middle is a light-palette gray.
	const divider = lines.map((line) => line.match(/^(?:\x1b\[38;2;(\d+);\d+;\d+m)?(.)/)!);
	assert.equal(divider[0][2], " ");
	const middle = divider[Math.floor(lines.length / 2)];
	assert.equal(middle[2], "│");
	assert.ok(Number(middle[1]) < LIGHT_BACKGROUND[0], "darker than the light background");
});

test("look-more S5 the narrow cards and the strip in light", () => {
	const todo = renderTodoCard(lookModel.todo, 64, 1, "light", "on", "teal");
	assert.ok(todo.length > 0);
	assert.deepEqual(todo, renderTodoCard(lookModel.todo, 64, 1, "vivid", "on", "teal").map((line) => lightOf(line)));
	const agents = renderAgentsCard(lookModel.agents, 53, 1, 0, "light");
	assert.ok(agents.length > 0);
	assert.deepEqual(agents, renderAgentsCard(lookModel.agents, 53, 1, 0, "vivid").map((line) => lightOf(line)));
	const strip = renderStrip(lookModel, 80, { colors: "light" });
	assert.ok(strip.length > 0);
	assert.deepEqual(strip, renderStrip(lookModel, 80).map((line) => lightOf(line)));
	for (const [name, lines] of [["todo", todo], ["agents", agents], ["strip", strip]] as const) noDarkNeutrals(lines, name);
	assert.deepEqual(renderStrip(lookModel, 80, { colors: "soft" }), renderStrip(lookModel, 80), "soft paints the strip as before");
});

test("look-more S5 the header, the welcome card and the loaded box in light", () => {
	const header = renderNarrowHeader(lookModel, 90, "light");
	assert.deepEqual(header, renderNarrowHeader(lookModel, 90).map((line) => lightOf(line)));
	assert.deepEqual(renderHeaderLine("E:\\DEV\\app", 60, "light"), renderHeaderLine("E:\\DEV\\app", 60).map((line) => lightOf(line)));
	const card = renderWelcomeCard({ version: "4.6.0", project: "app", branch: "main" }, 80, "light");
	assert.deepEqual(card, renderWelcomeCard({ version: "4.6.0", project: "app", branch: "main" }, 80).map((line) => lightOf(line)));
	const kinds = [{ label: "skills", names: ["a", "b"] }];
	const box = renderLoadedBox(kinds, 80, "ctrl+o", "light");
	assert.deepEqual(box, renderLoadedBox(kinds, 80, "ctrl+o").map((line) => lightOf(line)));
	for (const [name, lines] of [["header", header], ["card", card], ["box", box]] as const) {
		assert.ok(colorsIn(lines).length > 0, name);
		noDarkNeutrals(lines, name);
	}
	assert.deepEqual(renderNarrowHeader(lookModel, 90, "vivid"), renderNarrowHeader(lookModel, 90), "vivid as before");
});

test("look-more S5 the prompt line and its parts in light: the vivid labels in the light palette", () => {
	const labels = { mode: "super-yolo", modelId: "claude-opus-5-5", effort: "high" };
	assert.deepEqual(renderPromptLine(labels, 100, "light"), renderPromptLine(labels, 100, "vivid").map((line) => lightOf(line)));
	assert.deepEqual(renderPromptLine(labels, 12, "light"), renderPromptLine(labels, 12, "vivid").map((line) => lightOf(line)), "compact");
	const parts = promptLineParts(labels, "light");
	assert.deepEqual(parts.map((part) => part.styled), promptLineParts(labels, "vivid").map((part) => lightOf(part.styled)));
	assert.ok(parts[0].styled.includes(fgCode(lightColor(vivid(palette.red)))), "the mode in the light vivid red");
});

test("look-more S5 the label wave and the petal in light, for every accent", () => {
	for (const accent of ACCENTS) {
		for (const now of [0, 360, 1200]) {
			assert.equal(waveLabel("implementing…", now, accent, "light"), lightOf(waveLabel("implementing…", now, accent)), `${accent} wave ${now}`);
			assert.equal(wavePetal(now, "light", accent), lightOf(wavePetal(now, "vivid", accent)), `${accent} petal ${now}`);
		}
	}
	assert.equal(waveLabel("working…", 360, "pink", "vivid"), waveLabel("working…", 360), "vivid as before");
});

// Gentle Shell's own paint inside the prompt box stays its own: Fisi Dock repaints only what it adds.
const PETAL = "\x1b[38;2;255;118;195m\x1b[1m✿\x1b[22m\x1b[39m";
const GS_BORDER = (text: string) => `\x1b[38;2;80;80;80m${text}\x1b[39m`;
const gsRows = (width: number, label = "waiting for input", scan = false): string[] => {
	const painted = scan ? Array.from(label, (char) => `\x1b[90m${char}\x1b[39m`).join("") : `\x1b[2m${label}\x1b[22m`;
	const fill = width - (2 + 1 + 1 + visibleWidth(label) + 1) - 1;
	return [`${GS_BORDER("─ ")}${PETAL} ${painted} ${GS_BORDER("─".repeat(fill))}${GS_BORDER("─")}`, `› \x1b[38;2;200;100;50mhola\x1b[39m`.padEnd(width + 14), " ".repeat(width)];
};

test("look-more S5 the prompt box in light: its frames, labels, dot, wave and petal in the light palette, in every frame style; Gentle Shell's petal, label and text keep their colors", () => {
	const labels = { mode: "super-yolo", modelId: "claude-opus-5-5", effort: "high" };
	// Gentle Shell's petal, its border code left before the petal and the label, the editor's text.
	const keep = ["\x1b[38;2;255;118;195m", "\x1b[38;2;80;80;80m", "\x1b[38;2;200;100;50m"];
	for (const frames of FRAME_STYLES) {
		for (const accent of ["pink", "lilac"] as const) {
			const idle = boxPromptRows(gsRows(56), 60, 0, labels, undefined, "light", frames, accent);
			assert.equal(idle.boxed, true);
			assert.deepEqual(idle.rows, boxPromptRows(gsRows(56), 60, 0, labels, undefined, "vivid", frames, accent).rows.map((row) => lightOf(row, keep)), `${frames} ${accent} idle`);
			assert.ok(idle.rows[0].includes(PETAL), "Gentle Shell's petal as it painted it");
			assert.ok(idle.rows.join("\n").includes("\x1b[38;2;200;100;50mhola"), "the editor text as Gentle Shell painted it");
			noDarkNeutrals(idle.rows, `${frames} ${accent}`);
			const scanRows = gsRows(56, "implementing…", true);
			const working = boxPromptRows(scanRows, 60, 0, labels, 360, "light", frames, accent);
			assert.deepEqual(working.rows, boxPromptRows(scanRows, 60, 0, labels, 360, "vivid", frames, accent).rows.map((row) => lightOf(row, keep)), `${frames} ${accent} wave`);
		}
	}
});

test("look-more S5 the box around your messages in light: frames and `you` in the light palette; Pi's message background stays Pi's", () => {
	const PI_BG = "\x1b[48;2;31;31;31m";
	const render = (width: number) => ["", `${PI_BG} hola\x1b[49m`.padEnd(width + 20), ""];
	for (const frames of FRAME_STYLES) {
		for (const accent of ["pink", "amber"] as const) {
			const light = frameUserLines(render, 24, "light", frames, accent);
			assert.deepEqual(light, frameUserLines(render, 24, "vivid", frames, accent).map((line) => lightOf(line, [PI_BG])), `${frames} ${accent}`);
			assert.ok(light.join("\n").includes(PI_BG), "Pi's background untouched");
			assert.ok(light[0].includes(`${fgCode(accentLabel(accent, "light"))}you`), "`you` in the light accent");
			noDarkNeutrals(light, `${frames} ${accent}`);
		}
	}
});

test("look-more S5 the settings menu in light: its rows, title and hint in the light palette, the preview the light rail", () => {
	const look = { ...DEFAULT_LOOK, colors: "light" as const, accent: "green" as const };
	const light = renderSettings({ row: 2, look }, 60, 30, lookModel);
	const vividLines = renderSettings({ row: 2, look: { ...look, colors: "vivid" } }, 60, 30, lookModel);
	assert.deepEqual(light.map(plain), vividLines.map((line) => plain(line).replace("vivid", "light")), "same words, the colors row says light");
	assert.deepEqual(light, vividLines.map((line) => lightOf(line).replace("vivid", "light")));
	noDarkNeutrals(light, "menu");
	assert.match(plain(light[4]), /^ › colors +‹ light › *$/);
});

test("look-more S5 vivid and soft never paint a light-palette text color, and light differs from both", () => {
	const vividRail = renderRail(lookModel, 57, { maxRows: 60 });
	const softRail = renderRail(lookModel, 57, { colors: "soft", maxRows: 60 });
	const lightRail = renderRail(lookModel, 57, { colors: "light", maxRows: 60 });
	for (const lines of [vividRail, softRail]) assert.ok(!lines.join("\n").includes(fgCode(lightPalette.text)));
	assert.notDeepEqual(lightRail, vividRail);
	assert.notDeepEqual(lightRail, softRail);
	assert.deepEqual(lightRail.map(plain), vividRail.map(plain), "same words and layout");
	assert.deepEqual([...panelVivid(palette.teal)], [...panelAccent(palette.teal, "vivid")], "vivid helpers unchanged");
});
