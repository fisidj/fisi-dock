import { bold, fg, palette, type Rgb } from "./palette.ts";
import type { McpServerInfo, PanelModel } from "./panel-model.ts";
import { contextColor, usageParts } from "./panel.ts";
import { ellipsize, truncateToWidth, visibleWidth } from "./text.ts";

// Design 07's top row carries only the project path. Model and effort live on
// the prompt line, context and cost in the panel, so nothing repeats (S8).

const ELLIPSIS = "…";

/** The session cwd as Gentle Shell's header shows it: home shortened to ~. */
export function headerPath(cwd: string, home: string | undefined): string {
	if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

/** The last `width` columns of plain text. */
function takeEnd(text: string, width: number): string {
	const points = [...text];
	let out = "";
	for (let index = points.length - 1; index >= 0; index--) {
		if (visibleWidth(points[index] + out) > width) break;
		out = points[index] + out;
	}
	return out;
}

/** Fit a path into `width` columns, cutting the middle so the start and the last folder stay. */
export function fitPath(path: string, width: number): string {
	if (visibleWidth(path) <= width) return path;
	if (width <= 0) return "";
	const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
	const last = cut > 0 ? path.slice(cut) : path;
	const head = width - 1 - visibleWidth(last);
	if (head >= 1) return truncateToWidth(path, head) + ELLIPSIS + last;
	return ELLIPSIS + takeEnd(path, width - 1);
}

const METER_CELLS = 4;
const GAP = "  ";
const MCP_DOT: Record<McpServerInfo["state"], Rgb> = { connected: palette.green, failing: palette.red, unknown: palette.faint };

/**
 * The top row while the rail is hidden (S33): Gentle Shell's narrow header
 * showed model, context and cost; ours shows project · branch, a short context
 * meter, cost and MCP dots. The model and effort are on the prompt frame (S8).
 * Segments drop from the right to fit; the project is cut last.
 */
export function renderNarrowHeader(model: PanelModel, width: number): string[] {
	const columns = Math.max(0, Math.floor(width));
	if (columns === 0) return [];
	const { session } = model;
	const pad = columns >= 2 ? " " : "";
	const project = bold(fg(palette.text, session.project));
	const segments: string[] = [];
	if (session.branch) segments.push(fg(palette.faint, " · ") + fg(palette.green, session.branch));
	if (session.contextPercent !== undefined) {
		const percent = Math.max(0, Math.min(100, session.contextPercent));
		const on = percent > 0 ? Math.max(1, Math.round((percent / 100) * METER_CELLS)) : 0;
		const bar = fg(contextColor(percent), "▰".repeat(on)) + fg(palette.faint, "▱".repeat(METER_CELLS - on));
		segments.push(`${GAP}${bar} ${fg(palette.text, `${Math.round(percent)}%`)}`);
	}
	if (model.footer) {
		const dollars = Number.isFinite(model.footer.cost) ? model.footer.cost : 0;
		// A subscription records tokens but cost 0: tokens and the ≈ estimate instead (S37).
		segments.push(GAP + fg(palette.muted, usageParts(model.footer)?.join("") ?? `$${dollars.toFixed(3)}`));
	}
	if (session.mcp?.length) segments.push(GAP + session.mcp.map((server) => fg(MCP_DOT[server.state] ?? palette.faint, "●")).join(""));
	// S36: a full-width rule in the panel frame gray keeps the conversation below from blending in.
	const rule = fg(palette.frame, "─".repeat(columns));
	for (let count = segments.length; count > 0; count--) {
		const line = pad + project + segments.slice(0, count).join("");
		if (visibleWidth(line) <= columns) return [line, rule];
	}
	return [pad + ellipsize(project, columns - pad.length), rule];
}

/** One muted line with the path, or no line for an empty path or zero width. */
export function renderHeaderLine(path: string, width: number): string[] {
	const columns = Math.max(0, Math.floor(width));
	if (!path || columns === 0) return [];
	// One column of left padding, like the header text start in Gentle Shell's
	// float style; dropped when the width leaves no room for it.
	const pad = columns >= 2 ? " " : "";
	return [pad + fg(palette.muted, fitPath(path, columns - pad.length))];
}
