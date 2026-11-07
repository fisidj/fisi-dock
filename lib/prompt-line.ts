import { bold, fg, palette, vivid } from "./palette.ts";
import { ellipsize, visibleWidth } from "./text.ts";

// Design 07 shows the model and effort beside the prompt. The prompt editor is
// Gentle Shell's, so Fisi Dock adds this line below it instead of replacing it.

export interface PromptLineModel {
	/** Gentle Shell's permission mode (`normal`, `auto`, `yolo`, `super-yolo`); drawn first, only when it is not normal (S84). */
	mode?: string;
	modelId?: string;
	effort?: string;
}

/** Gentle Shell's status bar names the mode in capitals and leaves NORMAL out (lib/shell-bar.ts); the same here. */
const DEFAULT_MODE = "NORMAL";

/** `super-yolo` -> `SUPER-YOLO`; undefined for the default mode, a blank or a non-string. */
export function permissionModeLabel(mode: unknown): string | undefined {
	if (typeof mode !== "string") return undefined;
	const label = mode.trim().toUpperCase();
	return label && label !== DEFAULT_MODE ? label : undefined;
}

/** "claude-opus-5-5" -> "opus-5.5": no vendor prefix, version joined with a dot. */
export function shortModelName(id: string): string {
	return id.replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, "-$1.$2");
}

/** "claude-bridge/claude-opus-5-5" -> "opus-5.5": a subagent's model, any provider/ prefix dropped (S56). */
export function shortAgentModel(id: string): string {
	return shortModelName(id.slice(id.lastIndexOf("/") + 1));
}

export interface PromptLinePart {
	kind: "mode" | "model" | "effort";
	plain: string;
	styled: string;
}

/**
 * The labels in order, each plain and styled: the mode bold in vivid red, like its dot (only
 * when it is not normal), the model muted, the effort in vivid blue (vivid labels S3).
 * Nothing without a model.
 * The line under the prompt and the prompt box (S88) paint the same parts.
 */
export function promptLineParts(model: PromptLineModel): PromptLinePart[] {
	if (!model.modelId) return [];
	const mode = permissionModeLabel(model.mode);
	const name = shortModelName(model.modelId);
	return [
		...(mode ? [{ kind: "mode" as const, plain: mode, styled: bold(fg(vivid(palette.red), mode)) }] : []),
		{ kind: "model" as const, plain: name, styled: fg(palette.muted, name) },
		...(model.effort ? [{ kind: "effort" as const, plain: model.effort, styled: fg(vivid(palette.blue), model.effort) }] : []),
	];
}

/**
 * The parts at each compact step, widest first (S3): all of them, then without the effort,
 * then the first alone (the mode, or the model in normal mode). The mode goes last: it is
 * the safety signal. A step that drops nothing is left out; no steps without a model.
 */
export function promptLineSteps(model: PromptLineModel): PromptLinePart[][] {
	const parts = promptLineParts(model);
	if (parts.length === 0) return [];
	const steps = [parts, parts.filter((part) => part.kind !== "effort"), parts.slice(0, 1)];
	return steps.filter((step, index) => index === 0 || step.length < steps[index - 1].length);
}

/**
 * One right-aligned line with "MODE · model · effort" (the mode only when it is not normal),
 * or no line without a model. Too narrow, the labels compact (S3): tight dots
 * (`MODE·model·effort`), then no effort, then the mode alone; narrower still the line is cut.
 */
export function renderPromptLine(model: PromptLineModel, width: number): string[] {
	const columns = Math.max(0, Math.floor(width));
	const steps = promptLineSteps(model);
	if (steps.length === 0 || columns === 0) return [];
	const plainText = steps[0].map((part) => part.plain).join(" · ");
	// One trailing space keeps the text off the terminal edge, like the input bar.
	const room = Math.max(0, columns - 1);
	// Room for the text but not the space: it stays whole, flush and muted, as before S3.
	const compact = visibleWidth(plainText) > columns ? steps.map((parts) => ({ parts, separator: "·" })) : [];
	for (const { parts, separator } of [{ parts: steps[0], separator: " · " }, ...compact]) {
		const text = parts.map((part) => part.plain).join(separator);
		if (visibleWidth(text) > room) continue;
		const styled = parts.map((part) => part.styled).join(fg(palette.faint, separator));
		return [`${" ".repeat(room - visibleWidth(text))}${styled} `];
	}
	return [ellipsize(fg(palette.muted, plainText), columns)];
}
