import type { ColorMode } from "./look.ts";
import { bold, fg, paint, palette } from "./palette.ts";
import { ellipsize, visibleWidth } from "./text.ts";

// The startup header in place of Gentle Shell's rose (design
// gentle-shell-redesign/08 "start screen"): one framed card with the shell and
// its version, where the session is, the five commands to begin with, and a tip.

/** The card's columns, borders included, when the screen has room. */
export const WELCOME_CARD_WIDTH = 63;
/** Below this the frame and command rows go; the title and ready lines stay. */
const MIN_CARD_WIDTH = 34;
/** A border and two spaces on each side. */
const SIDE = 3;

const COMMANDS: [string, string][] = [
	["Resume session", "/resume"],
	["New session", "/new"],
	["Changelog", "/changelog"],
	["Shortcuts", "/hotkeys"],
	["Quit", "/quit"],
];
const BRAND = "with Fisi Dock";
const TIP = "Tip: alt+k opens the command palette.";

/** `version` is Gentle Shell's, `dockVersion` Fisi Dock's own. */
export type WelcomeInfo = { version?: string; dockVersion?: string; project: string; branch?: string };

const text = (value: string) => fg(palette.text, value);
const muted = (value: string) => fg(palette.muted, value);
const frame = (value: string) => fg(palette.frame, value);

/**
 * `Gentle Shell <version>`, and `with Fisi Dock <dockVersion>` on the right:
 * when they do not both fit, Fisi Dock's version goes first, then the brand.
 */
function titleRow({ version, dockVersion }: WelcomeInfo, width: number): string {
	const title = version ? `Gentle Shell ${version}` : "Gentle Shell";
	if (visibleWidth(title) > width) return bold(text(ellipsize(title, width)));
	const styled = bold(text("Gentle Shell")) + (version ? muted(` ${version}`) : "");
	const room = width - visibleWidth(title) - 2;
	const versioned = dockVersion ? `${BRAND} ${dockVersion}` : BRAND;
	if (visibleWidth(versioned) <= room) return styled + " ".repeat(room + 2 - visibleWidth(versioned)) + fg(palette.pink, BRAND) + (dockVersion ? muted(` ${dockVersion}`) : "");
	return BRAND.length <= room ? styled + " ".repeat(room + 2 - BRAND.length) + fg(palette.pink, BRAND) : styled;
}

/** `Ready in <project> on <branch>.`; cut whole when it does not fit. */
function readyRow({ project, branch }: WelcomeInfo, width: number): string {
	const line = branch ? `Ready in ${project} on ${branch}.` : `Ready in ${project}.`;
	if (visibleWidth(line) > width) return muted(ellipsize(line, width));
	return muted("Ready in ") + text(project) + (branch ? muted(" on ") + text(branch) : "") + muted(".");
}

/** The welcome card for `width` columns, centered; title and ready lines alone when narrow. Light `colors` paints it for a light background (look-more S5). */
export function renderWelcomeCard(info: WelcomeInfo, width: number, colors?: ColorMode): string[] {
	return cardLines(info, width).map((line) => paint(line, colors));
}

function cardLines(info: WelcomeInfo, width: number): string[] {
	const columns = Math.max(0, Math.floor(width));
	if (columns < 1) return [];
	if (columns < MIN_CARD_WIDTH) return [titleRow(info, columns), readyRow(info, columns)];

	const cardWidth = Math.min(WELCOME_CARD_WIDTH, columns);
	const inner = cardWidth - 2 * SIDE;
	const indent = " ".repeat((columns - cardWidth) >> 1);
	const row = (content = "") => `${indent}${frame("│")}  ${content}${" ".repeat(Math.max(0, inner - visibleWidth(content)))}  ${frame("│")}`;
	const command = ([label, name]: [string, string]) => bold(text(label)) + " ".repeat(inner - label.length - name.length) + text(name);
	const tip = ellipsize(TIP, columns - indent.length - 1);
	return [
		"",
		`${indent}${frame(`╭${"─".repeat(cardWidth - 2)}╮`)}`,
		row(),
		row(titleRow(info, inner)),
		row(),
		row(readyRow(info, inner)),
		row(),
		...COMMANDS.map((entry) => row(command(entry))),
		row(),
		`${indent}${frame(`╰${"─".repeat(cardWidth - 2)}╯`)}`,
		tip === TIP ? `${indent} ${bold(text("Tip:"))} ${text("alt+k")} ${muted("opens the command palette.")}` : `${indent} ${muted(tip)}`,
	];
}

/**
 * Gentle Shell's version for this agent home, from the `provisioned` record in its
 * config.json (the folder above the agent home): `4.6.0-main.dd37ffe` reads `4.6.0-main`.
 */
export function shellVersion(configText: string | undefined, agentHome: string): string | undefined {
	if (configText === undefined) return undefined;
	let config: unknown;
	try {
		config = JSON.parse(configText);
	} catch {
		return undefined;
	}
	const provisioned = (config as { provisioned?: Record<string, { gentlePi?: unknown }> } | null)?.provisioned;
	const version = provisioned?.[agentHome]?.gentlePi;
	if (typeof version !== "string") return undefined;
	const match = /^(\d+\.\d+\.\d+)(-[0-9A-Za-z]+)?/.exec(version);
	return match ? match[1] + (match[2] ?? "") : undefined;
}
