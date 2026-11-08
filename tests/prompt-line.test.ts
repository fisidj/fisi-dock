import assert from "node:assert/strict";
import test from "node:test";
import { fgCode, palette, vivid } from "../lib/palette.ts";
import { permissionModeLabel, renderPromptLine, shortAgentModel, shortModelName } from "../lib/prompt-line.ts";
import { visibleWidth } from "../lib/text.ts";

const plain = (lines: string[]) => lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));

test("shortModelName drops the vendor prefix and joins the version with a dot", () => {
	assert.equal(shortModelName("claude-opus-5-5"), "opus-5.5");
	assert.equal(shortModelName("claude-sonnet-5-5"), "sonnet-5.5");
	assert.equal(shortModelName("gpt-5"), "gpt-5");
	assert.equal(shortModelName("grok-4.7"), "grok-4.7");
});

test("shortAgentModel drops a provider/ prefix, then shortens like shortModelName (S56)", () => {
	assert.equal(shortAgentModel("claude-bridge/claude-opus-5-5"), "opus-5.5");
	assert.equal(shortAgentModel("claude-haiku-5-5"), "haiku-5.5");
	assert.equal(shortAgentModel("openai/gpt-5"), "gpt-5");
	for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "gpt-5", "grok-4.7"]) assert.equal(shortAgentModel(id), shortModelName(id), id);
});

test("prompt line shows model and effort right-aligned on one line", () => {
	const lines = renderPromptLine({ modelId: "claude-opus-5-5", effort: "high" }, 60);
	assert.equal(lines.length, 1);
	assert.equal(visibleWidth(lines[0]), 60);
	assert.ok(plain(lines)[0].endsWith("opus-5.5 · high "));
});

test("prompt line omits effort for models without reasoning", () => {
	const [line] = plain(renderPromptLine({ modelId: "gpt-5" }, 40));
	assert.ok(line.endsWith("gpt-5 "));
	assert.ok(!line.includes("·"));
});

test("prompt line is empty without a model", () => {
	assert.deepEqual(renderPromptLine({}, 40), []);
});

test("prompt line puts a non-default permission mode first: `SUPER-YOLO · opus-5.5 · high`; NORMAL shows nothing (S84)", () => {
	const lines = renderPromptLine({ mode: "super-yolo", modelId: "claude-opus-5-5", effort: "high" }, 60);
	assert.equal(lines.length, 1);
	assert.equal(visibleWidth(lines[0]), 60);
	assert.ok(plain(lines)[0].endsWith("SUPER-YOLO · opus-5.5 · high "), plain(lines)[0]);
	assert.ok(lines[0].includes(`\x1b[1m${fgCode(vivid(palette.red))}SUPER-YOLO`), "the mode bold in vivid red, the prompt box's label (vivid labels S3)");
	assert.ok(plain(renderPromptLine({ mode: "yolo", modelId: "gpt-5" }, 40))[0].endsWith("YOLO · gpt-5 "), "no effort: mode and model");
	// Gentle Shell's status bar shows the mode only when it is not NORMAL (lib/shell-bar.ts): the same rule here.
	assert.deepEqual(renderPromptLine({ mode: "normal", modelId: "claude-opus-5-5", effort: "high" }, 60), renderPromptLine({ modelId: "claude-opus-5-5", effort: "high" }, 60));
	assert.deepEqual(renderPromptLine({ mode: "NORMAL", modelId: "claude-opus-5-5", effort: "high" }, 60), renderPromptLine({ modelId: "claude-opus-5-5", effort: "high" }, 60));
	assert.deepEqual(renderPromptLine({ mode: "  ", modelId: "gpt-5" }, 40), renderPromptLine({ modelId: "gpt-5" }, 40), "blank: as without a mode");
	assert.equal(permissionModeLabel("super-yolo"), "SUPER-YOLO");
	assert.equal(permissionModeLabel("auto"), "AUTO");
	assert.equal(permissionModeLabel("normal"), undefined);
	assert.equal(permissionModeLabel(undefined), undefined);
	assert.equal(permissionModeLabel(3), undefined);
	for (const width of [60, 20, 8, 3, 0]) {
		for (const line of renderPromptLine({ mode: "super-yolo", modelId: "claude-opus-5-5", effort: "high" }, width)) assert.ok(visibleWidth(line) <= width, `${width}: ${JSON.stringify(line)}`);
	}
});

for (const width of [60, 20, 8, 3, 0]) {
	test(`prompt line never exceeds width ${width}`, () => {
		for (const line of renderPromptLine({ modelId: "claude-opus-5-5-very-long-preview-build", effort: "xhigh" }, width)) {
			assert.ok(visibleWidth(line) <= width, `${JSON.stringify(line)} > ${width}`);
		}
	});
}

// S3: too narrow for the whole line, the labels compact like on the prompt box: tight dots, then no
// effort, then the mode alone (the model alone in normal mode); only below that is the line cut.
test("S3 prompt line compacts its labels before it cuts them", () => {
	const labels = { mode: "super-yolo", modelId: "claude-opus-5-5", effort: "high" };
	const line = (width: number, model: object = labels) => plain(renderPromptLine(model, width))[0];
	assert.equal(line(29), "SUPER-YOLO · opus-5.5 · high ");
	assert.equal(line(28), "SUPER-YOLO · opus-5.5 · high", "room for the text but not the space: whole and flush, as before");
	assert.equal(line(27), "  SUPER-YOLO·opus-5.5·high ");
	assert.equal(line(25), "SUPER-YOLO·opus-5.5·high ");
	assert.equal(line(24), "    SUPER-YOLO·opus-5.5 ");
	assert.equal(line(20), "SUPER-YOLO·opus-5.5 ");
	assert.equal(line(19), `${" ".repeat(8)}SUPER-YOLO `);
	assert.equal(line(11), "SUPER-YOLO ");
	assert.equal(line(10), "SUPER-YOL…", "too narrow even for the mode: cut, as before");
	const normal = { modelId: "claude-opus-5-5", effort: "high" };
	assert.equal(line(16, normal), "opus-5.5 · high ");
	assert.equal(line(15, normal), "opus-5.5 · high");
	assert.equal(line(14, normal), "opus-5.5·high ");
	assert.equal(line(13, normal), "    opus-5.5 ");
	assert.equal(line(9, normal), "opus-5.5 ");
	const [styled] = renderPromptLine(labels, 25);
	assert.ok(styled.includes(`\x1b[1m${fgCode(vivid(palette.red))}SUPER-YOLO`), "the mode bold in vivid red");
	assert.ok(styled.includes(`${fgCode(palette.faint)}·`) && styled.includes(`${fgCode(vivid(palette.blue))}high`), "the tight dot faint, the effort vivid blue");
	for (let width = 0; width <= 40; width++) {
		for (const model of [labels, normal]) for (const row of renderPromptLine(model, width)) assert.ok(visibleWidth(row) <= width, `${width}: ${JSON.stringify(row)}`);
	}
});

// Look settings S4, S6: soft paints the mode and effort in their plain pastels; no mode is vivid, byte for byte.
test("S4 soft colors: the mode bold in pastel red, the effort pastel blue; omitting the mode equals vivid (S6)", async () => {
	const { promptLineParts, promptLineSteps } = await import("../lib/prompt-line.ts");
	const model = { mode: "super-yolo", modelId: "claude-opus-5-5", effort: "high" };
	const [soft] = renderPromptLine(model, 60, "soft");
	assert.ok(soft.includes(`\x1b[1m${fgCode(palette.red)}SUPER-YOLO`), "the mode bold in pastel red");
	assert.ok(soft.includes(`${fgCode(palette.blue)}high`), "the effort pastel blue");
	assert.ok(!soft.includes(fgCode(vivid(palette.red))) && !soft.includes(fgCode(vivid(palette.blue))), "no vivid tone");
	assert.ok(soft.includes(`${fgCode(palette.muted)}opus-5.5`), "the model stays muted");
	assert.deepEqual(plain([soft]), plain(renderPromptLine(model, 60)), "same words and layout");
	for (const width of [60, 26, 20, 12]) assert.deepEqual(renderPromptLine(model, width), renderPromptLine(model, width, "vivid"), `${width}`);
	assert.deepEqual(promptLineParts(model), promptLineParts(model, "vivid"));
	assert.deepEqual(promptLineSteps(model), promptLineSteps(model, "vivid"));
	assert.ok(promptLineParts(model, "soft")[0].styled.includes(fgCode(palette.red)));
	assert.ok(promptLineSteps(model, "soft")[0][2].styled.includes(fgCode(palette.blue)));
});
