import assert from "node:assert/strict";
import test from "node:test";
import type { ColorMode } from "../lib/look.ts";
import { bgCode, lightPalette, palette } from "../lib/palette.ts";
import { samplePanelModel } from "../lib/panel-model.ts";
import { DOCK_WIDTH, renderDock, renderRail } from "../lib/panel.ts";

// S59: /dock wears the side panel's colors (the terminal background, the rail highlight), no black of its own.
// Judged on what is painted: the dock and the rail render the same model in the same color mode, and every
// background the dock paints is one the rail paints too.

/** Every background code in `lines`: 24-bit, 256-color, 16-color or bright ones; not the default-background reset (49). */
const BACKGROUND_CODE = /\x1b\[(?:48;[25];[\d;]+|4[0-7]|10[0-7])m/g;
const backgrounds = (lines: string[]) => new Set(lines.join("\n").match(BACKGROUND_CODE) ?? []);

const MODES: [ColorMode | undefined, ReturnType<typeof bgCode>][] = [
	[undefined, bgCode(palette.highlight)],
	["vivid", bgCode(palette.highlight)],
	["soft", bgCode(palette.highlight)],
	["light", bgCode(lightPalette.highlight)],
];

for (const [colors, highlight] of MODES) {
	test(`/dock has no colors of its own: in ${colors ?? "the default"} colors its backgrounds are the rail's, only the highlight row`, () => {
		const rail = backgrounds(renderRail(samplePanelModel, DOCK_WIDTH + 2, { colors, maxRows: 200 }));
		const dock = backgrounds(renderDock(samplePanelModel, DOCK_WIDTH + 2, 200, 0, { colors }).lines);
		assert.deepEqual([...rail], [highlight], "the rail paints the highlight row and no other background");
		assert.deepEqual([...dock], [...rail], "the dock paints the same background, no black or highlight of its own");
	});
}
