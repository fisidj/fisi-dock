import type { ColorMode, MotionMode } from "./look.ts";
import { spinnerAt } from "./orbs.ts";
import { fg, paint, palette } from "./palette.ts";
import type { PanelModel } from "./panel-model.ts";
import { agentLive, formatTime, warningGlyph } from "./panel.ts";
import { ellipsize, visibleWidth } from "./text.ts";

// The narrow-screen strip (S23 A): one or two lines above the prompt while the
// rail is not on screen. It carries only what the narrow top row does not
// (context and cost are there, S33; model and effort on the prompt, S8), in
// the panel's colors (S9).

const INDENT = "  ";
const SEPARATOR = fg(palette.faint, " · ");

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function oddSegment(model: PanelModel): string | undefined {
	const steps = model.odd?.steps ?? [];
	if (steps.length === 0) return undefined;
	// The active phase is the prompt box's working label (S92): no second copy above it.
	if (steps.some((candidate) => candidate.state === "active")) return undefined;
	// Finished timeline: the time of the steps still kept (older ones only count).
	const total = steps.reduce((sum, done) => sum + Math.max(0, done.seconds), 0);
	return `${fg(palette.green, "✓")} ${fg(palette.amber, `ODD ${formatTime(total)}`)}`;
}

function statusSegments(model: PanelModel, withTodo: boolean, withAgents: boolean, still: boolean): string[] {
	const segments: (string | undefined)[] = [oddSegment(model)];
	const todo = model.todo;
	if (withTodo && todo && todo.total > 0) segments.push(fg(palette.coral, `todo ${todo.done}/${todo.total}`));
	// Running jobs and running or waiting subagent tasks (S87), the rows the agents card lists.
	const running = (model.agents ?? []).filter(agentLive).length;
	if (withAgents && running > 0) segments.push(`${fg(palette.blue, spinnerAt(still ? undefined : model.spinner))} ${fg(palette.lilac, plural(running, "agent"))}`);
	const changed = model.changes?.length ?? 0;
	if (changed > 0) segments.push(fg(palette.green, `±${plural(changed, "file")}`));
	return segments.filter((segment): segment is string => segment !== undefined);
}

/** Joined segments within `width`: trailing ones drop whole, an ellipsis only when the first alone is too wide. */
function fit(segments: string[], width: number): string | undefined {
	if (segments.length === 0) return undefined;
	for (let count = segments.length; count > 0; count--) {
		const line = INDENT + segments.slice(0, count).join(SEPARATOR);
		if (visibleWidth(line) <= width) return line;
	}
	const [first] = segments;
	return visibleWidth(first) <= width ? first : ellipsize(first, width);
}

export interface StripOptions {
	/** False leaves out `todo d/t`: the todo card shown with the strip has it in its header (S28, S8). */
	todo?: boolean;
	/** False leaves out `N agents`: the agents card shown with the strip lists them (S35, S8). */
	agents?: boolean;
	/** Off holds the agents spinner on its still frame (look-more S2). */
	motion?: MotionMode;
	/** Light paints the strip for a light background (look-more S5); vivid and soft as today. */
	colors?: ColorMode;
}

/** Zero, one or two strip lines for `model`, none wider than `width`. */
export function renderStrip(model: PanelModel, width: number, options: StripOptions = {}): string[] {
	const columns = Math.max(0, Math.floor(width));
	if (columns === 0) return [];
	const warnings = (model.headsUp ?? []).map((warning) => `${warningGlyph(warning.kind)} ${fg(palette.text, warning.text)}`);
	return [fit(statusSegments(model, options.todo !== false, options.agents !== false, options.motion === "off"), columns), fit(warnings, columns)].filter((line): line is string => line !== undefined).map((line) => paint(line, options.colors));
}
