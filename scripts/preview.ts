// Prints the panel with the sample model, for comparing against designs 07
// and 08 (47 columns: the official rail; at 55 the panel draws the 08 logo).
//   node scripts/preview.ts [width]                  ANSI to stdout (default 47)
//   node scripts/preview.ts [width] --html <file>    self-contained HTML page
//   node scripts/preview.ts [width] --strip          the narrow-screen strip instead (S23)
//   node scripts/preview.ts [width] --dock           the /dock screen, todo expanded (S25, S26, S59; default 64)
//   node scripts/preview.ts [width] --header         the narrow-screen top row (S33; default 64)
//   node scripts/preview.ts [width] --rows <n>       the panel for a screen <n> rows tall (S34; the rail gets n - 2)

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { samplePanelModel, type PanelModel } from "../lib/panel-model.ts";
import { renderNarrowHeader } from "../lib/header.ts";
import { renderDock, renderPanel } from "../lib/panel.ts";
import { renderStrip } from "../lib/strip.ts";

const BACKGROUND = "#161616";
const FOREGROUND = "#e1e1e1";

interface Style {
	fg?: string;
	bg?: string;
	bold?: boolean;
}

const hex = (r: string, g: string, b: string) => `#${[r, g, b].map((channel) => Number(channel).toString(16).padStart(2, "0")).join("")}`;

function applySgr(style: Style, params: string[]): Style {
	const next = { ...style };
	for (let index = 0; index < params.length; index++) {
		const code = params[index] === "" ? 0 : Number(params[index]);
		if (code === 0) {
			delete next.fg;
			delete next.bg;
			delete next.bold;
		} else if (code === 1) next.bold = true;
		else if (code === 22) delete next.bold;
		else if (code === 39) delete next.fg;
		else if (code === 49) delete next.bg;
		else if ((code === 38 || code === 48) && params[index + 1] === "2") {
			const color = hex(params[index + 2], params[index + 3], params[index + 4]);
			if (code === 38) next.fg = color;
			else next.bg = color;
			index += 4;
		}
	}
	return next;
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[char]};`);

function lineToHtml(line: string): string {
	let style: Style = {};
	let html = "";
	for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
		const sgr = /^\x1b\[([0-9;]*)m$/.exec(part);
		if (sgr) {
			style = applySgr(style, sgr[1].split(";"));
			continue;
		}
		if (!part) continue;
		const css = [style.fg && `color:${style.fg}`, style.bg && `background:${style.bg}`, style.bold && "font-weight:700"].filter(Boolean).join(";");
		html += css ? `<span style="${css}">${escapeHtml(part)}</span>` : escapeHtml(part);
	}
	return html;
}

function toHtml(lines: string[], width: number): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fisi Dock panel preview (${width} columns)</title>
<style>
  body { margin: 0; padding: 24px; background: ${BACKGROUND}; color: ${FOREGROUND}; }
  pre { margin: 0; font: 14px/1.25 "Cascadia Mono", Consolas, monospace; }
</style>
</head>
<body>
<pre>${lines.map(lineToHtml).join("\n")}</pre>
</body>
</html>
`;
}

const args = process.argv.slice(2);
const htmlFlag = args.indexOf("--html");
const htmlFile = htmlFlag >= 0 ? args[htmlFlag + 1] : undefined;
if (htmlFlag >= 0 && !htmlFile) {
	console.error("usage: node scripts/preview.ts [width] [--strip | --dock | --header] [--rows <n>] [--html <file>]");
	process.exit(1);
}
const rowsFlag = args.indexOf("--rows");
const rows = rowsFlag >= 0 ? Number(args[rowsFlag + 1]) : undefined;
if (rowsFlag >= 0 && !(Number(rows) > 0)) {
	console.error("usage: node scripts/preview.ts [width] [--strip | --dock | --header] [--rows <n>] [--html <file>]");
	process.exit(1);
}
// The sample with MCP servers in the session section (S32): connected, failing, still connecting.
const sampleModel: PanelModel = {
	...samplePanelModel,
	session: {
		...samplePanelModel.session,
		mcp: [
			{ name: "engram", state: "connected" },
			{ name: "context7", state: "failing" },
			{ name: "github", state: "unknown" },
		],
	},
	// A 4.6.0 subagent task next to the jobs (S87), with its model and effort.
	agents: [...(samplePanelModel.agents ?? []), { id: "task:a1b2c3", name: "writer", task: "pin the Node version", state: "running", model: "anthropic/claude-opus-5-5", effort: "high" }],
	footer: { cost: 0.012, rdd: "on" },
};
// The sample todo with its full task list, which only /dock draws.
const dockModel: PanelModel = {
	...sampleModel,
	todo: {
		...samplePanelModel.todo!,
		tasks: [
			{ title: "Read the failing CI log", state: "done" },
			{ title: "Pin the Node version in ci.yml", state: "done" },
			{ title: "Rerun the workflow", state: "done" },
			{ title: "Confirm CI is green", state: "active" },
			{ title: "Commit workflow fix", state: "pending" },
			{ title: "Ask an admin to unlock the branch", state: "blocked" },
			{ title: "Push and open the PR", state: "pending" },
		],
	},
};

const dock = args.includes("--dock");
const header = args.includes("--header");
const widthArg = args.find((arg, index) => /^\d+$/.test(arg) && (htmlFlag < 0 || index !== htmlFlag + 1) && (rowsFlag < 0 || index !== rowsFlag + 1));
const width = widthArg ? Number(widthArg) : dock ? 64 : header ? 64 : 47;
const lines = dock
	? renderDock(dockModel, width, 1000).lines
	: header
		? renderNarrowHeader(sampleModel, width)
		: args.includes("--strip")
			? renderStrip(sampleModel, width)
			: renderPanel(sampleModel, width, { maxRows: rows === undefined ? undefined : Math.max(0, rows - 2) });

if (htmlFile) {
	mkdirSync(dirname(htmlFile), { recursive: true });
	writeFileSync(htmlFile, toHtml(lines, width));
	console.log(htmlFile);
} else {
	process.stdout.write(`${lines.join("\x1b[0m\n")}\x1b[0m\n`);
}
