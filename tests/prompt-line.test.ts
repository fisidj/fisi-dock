import assert from "node:assert/strict";
import test from "node:test";
import { fgCode, palette } from "../lib/palette.ts";
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
	assert.ok(lines[0].includes(`\x1b[1m${fgCode(palette.red)}SUPER-YOLO`), "the mode bold in red, like the fork build painted it");
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
