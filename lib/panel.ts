import { ciLive } from "./ci.ts";
import { entranceFlash, entranceText, type EntrancePiece } from "./entrance.ts";
import { type Accent, type ColorMode, DEFAULT_SECTIONS, type DividerLevel, type FrameStyle, type LogoStyle, type MotionMode, type SectionId, type SectionSetting } from "./look.ts";
import { renderLogo } from "./logo.ts";
import { fitDetail } from "./odd-detail.ts";
import { orbAt, orbOf, orbWidth, shimmerText, spinnerAt } from "./orbs.ts";
import type { AgentInfo, ChangeInfo, CiCheck, CiInfo, FooterInfo, HeadsUpWarning, McpServerInfo, OddInfo, PanelModel, RddInfo, RddReview, SessionInfo, SkillInfo, SkillScope, SkillsInfo, TodoInfo, TodoTask } from "./panel-model.ts";
import { shortAgentModel } from "./prompt-line.ts";
import { SKILL_SCOPES } from "./skills.ts";
import { FADE_PEAK, RESET, accentBase, bgCode, bold, dim, fadeAmount, fadedEdge, fg, paint, palette, panelAccent, type Rgb } from "./palette.ts";
import { ellipsize, fitWidth, padEnd, truncateToWidth, visibleWidth } from "./text.ts";

// Pure model-to-lines renderer for the rail (design 07, S2/S8/S9). Gentle Shell
// hides the whole rail when one line is too wide, so every line is cut to fit.
// Colors light (look-more S5): the lines are drawn in vivid and painted for the
// light background once, by each exported renderer (lib/palette.ts paint).

interface Row {
	text: string;
	/** Selected row: highlight background and a pink bar at the left edge. */
	highlight?: boolean;
}

interface Section {
	title: string;
	color: Rgb;
	right?: string;
	rows: Row[];
}

const HIGHLIGHT = bgCode(palette.highlight);
const BAR_CELLS = 10;
/** A right-side value stays only while the left keeps at least this much room. */
const MIN_LEFT = 8;
/** Agents and changed files past this many collapse into one "+N more" row. */
const LIST_CAP = 4;
/** ODD steps past this many collapse into one "+N earlier" row above the latest. */
const ODD_CAP = 6;
/** Heads-up rows: up to this many warnings, else one fewer and a "+N more" row. */
const HEADS_UP_CAP = 5;
/** CI workflows past this many collapse into one "+N more" row (S64). */
const CI_CAP = 6;

const muted = (text: string) => fg(palette.muted, text);
const plainText = (text: string) => fg(palette.text, text);

/** A row's text while it enters (S54): `pieces` in `section`'s entrance colors at `step`; `normal` without one or once it ended. */
const entering = (pieces: EntrancePiece[], section: Rgb, step: number | undefined, normal: string) => entranceText(pieces, section, step) ?? normal;
/** A row glyph's color: the section color during the entrance flash (S54), else its own. */
const glyphColor = (color: Rgb, section: Rgb, step: number | undefined) => (entranceFlash(step) ? section : color);

/** `left` cut to fit, `right` flush right; the right value drops when space runs out. */
function spread(left: string, right: string, width: number): string {
	const rightWidth = visibleWidth(right);
	if (right && width - rightWidth - 1 >= Math.min(visibleWidth(left), MIN_LEFT)) {
		const cut = ellipsize(left, width - rightWidth - 1);
		return padEnd(cut, width - rightWidth) + right;
	}
	return ellipsize(left, width);
}

/** A glyph column (`column` cells wide), one space, then the rest of the row. */
function item(glyph: string, rest: (width: number) => string, width: number, column = 1): string {
	return `${padEnd(glyph, column)} ${rest(width - column - 1)}`;
}

export function formatTokens(count: number): string {
	if (count < 1000) return String(Math.round(count));
	const [value, unit] = count < 1_000_000 ? [count / 1000, "k"] : [count / 1_000_000, "M"];
	return `${value.toFixed(1).replace(/\.0$/, "")}${unit}`;
}

/** An API-price estimate (S37): whole dollars from $10, cents below. */
export function formatEstimate(dollars: number): string {
	const cents = Math.round(Math.max(0, Number.isFinite(dollars) ? dollars : 0) * 100) / 100;
	return `≈$${cents >= 10 ? Math.round(cents) : cents.toFixed(2)}`;
}

/**
 * Tokens and the ≈ estimate as [value, label, value] parts, for a session whose
 * cost is 0 but which used tokens (a subscription, S37); undefined otherwise,
 * and the real cost shows.
 */
export function usageParts(footer: FooterInfo): string[] | undefined {
	const cost = Number.isFinite(footer.cost) ? footer.cost : 0;
	const used = footer.tokens ?? 0;
	if (cost > 0 || !(used > 0)) return undefined;
	const tokens = formatTokens(used);
	return footer.estimate !== undefined ? [tokens, " tok · ", formatEstimate(footer.estimate)] : [tokens, " tok"];
}

export function formatTime(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Elapsed `ms` as m:ss, h:mm:ss from an hour; a start in the future counts as now. */
export function formatElapsed(ms: number): string {
	const total = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
	if (total < 3600) return formatTime(total);
	const minutes = Math.floor(total / 60) % 60;
	return `${Math.floor(total / 3600)}:${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function meter(cells: number, on: number, onColor: Rgb, offColor: Rgb, onGlyph = "▰", offGlyph = "▱"): string {
	const filled = Math.max(0, Math.min(cells, on));
	return fg(onColor, onGlyph.repeat(filled)) + fg(offColor, offGlyph.repeat(Math.max(0, cells - filled)));
}

// The meter wears the session teal and warns as the context fills up.
export function contextColor(percent: number): Rgb {
	if (percent >= 85) return palette.red;
	if (percent >= 60) return palette.amber;
	return palette.teal;
}

// The session section is design session-section/02 (Grouped) without its group
// labels (sidebar-chrome/02): where, usage and connections in that order, one
// muted key column so every value starts at the same place, and only the meter
// readout and the cost flush right.

/** Where the context meter puts its marks: the percents at which its color turns. */
const CONTEXT_MARKS = [60, 85];
/** Session keys (`project`, `context`, …) take this many columns. */
const KEY_CELLS = 9;
/** The meter readout (`5% · 53.5k/1M`) keeps at least this many columns, so the bar does not move with every token. */
const READOUT_CELLS = 13;
/** A bar shorter than this takes its row alone and the readout moves under it. */
const MIN_METER_CELLS = 16;
/** Connection names past this many cells are cut, so the state words keep one column. */
const CONNECTION_NAME_CAP = 12;
/** The rail's mcp rows at most (S5), the `+N more` summary included: artboard 02's three servers plus one, and the summary keeps `+N more` and a count on the 47-column rail. */
const MCP_ROWS = 4;

const sessionKey = (label: string) => muted(label.padEnd(KEY_CELLS));

/**
 * The context meter: one cell per column; filled cells a heavy `━` in `color`,
 * empty ones a thin faint `─`, with a faint `┼` on the cells holding 60% and 85%.
 */
function contextMeter(percent: number, cells: number, color: Rgb): string {
	let filled = 0;
	let empty = "";
	for (let index = 0; index < cells; index++) {
		if (((index + 0.5) / cells) * 100 <= percent) filled++;
		else empty += CONTEXT_MARKS.some((mark) => Math.floor((mark / 100) * cells) === index) ? "┼" : "─";
	}
	return fg(color, "━".repeat(filled)) + fg(palette.faint, empty);
}

/** The context row: the meter, then `5% · 53.5k/1M` (`5% used` without token counts) flush right, or under the bar when the bar would be too short. */
function contextRows(session: SessionInfo, width: number): Row[] {
	const percent = Math.max(0, Math.min(100, session.contextPercent ?? 0));
	const rounded = Math.round(percent);
	const color = contextColor(rounded);
	const used = session.tokensUsed;
	const tokens = used !== undefined && session.tokensMax ? muted(" · ") + plainText(`${formatTokens(used)}/${formatTokens(session.tokensMax)}`) : muted(" used");
	const readout = bold(fg(color, `${rounded}%`)) + tokens;
	const readoutWidth = visibleWidth(readout);
	const cells = width - KEY_CELLS - 1 - Math.max(READOUT_CELLS, readoutWidth);
	if (cells >= MIN_METER_CELLS) return [{ text: sessionKey("context") + padEnd(contextMeter(percent, cells, color), width - KEY_CELLS - readoutWidth) + readout }];
	return [{ text: sessionKey("context") + contextMeter(percent, Math.max(0, width - KEY_CELLS), color) }, { text: " ".repeat(Math.max(0, width - readoutWidth)) + readout }];
}

/** Session cost, or tokens and the ≈ estimate (S37); the review state lives in the RDD section (S50). */
function costText(footer: FooterInfo): string {
	const dollars = Number.isFinite(footer.cost) ? footer.cost : 0;
	const usage = usageParts(footer);
	return usage ? usage.map((part, index) => (index % 2 ? muted(part) : plainText(part))).join("") : plainText(`$${dollars.toFixed(3)}`);
}

/** The profile with the cost flush right; without a profile the cost keeps a row of its own. */
function profileRows(session: SessionInfo, width: number, footer?: FooterInfo): Row[] {
	const cost = footer ? costText(footer) : "";
	if (session.profile) return [{ text: spread(sessionKey("profile") + plainText(session.profile), cost, width) }];
	return footer ? [{ text: ellipsize(sessionKey("cost") + cost, width) }] : [];
}

type ConnectionState = "connected" | "connecting" | "failed" | "unreachable" | "missing";

// One glyph per state, so a state never rests on color alone.
const CONNECTION: Record<ConnectionState, { glyph: string; color: Rgb; word: string }> = {
	connected: { glyph: "●", color: palette.green, word: "connected" },
	connecting: { glyph: "◌", color: palette.amber, word: "connecting" },
	failed: { glyph: "✗", color: palette.red, word: "failed" },
	unreachable: { glyph: "✗", color: palette.red, word: "unreachable" },
	missing: { glyph: "○", color: palette.faint, word: "not installed" },
};

/** Today's MCP states: `unknown` is a server still connecting (or Pi cannot tell), `failing` one with no tools after the grace period. */
const MCP_CONNECTION: Record<McpServerInfo["state"], ConnectionState> = { connected: "connected", unknown: "connecting", failing: "failed" };
/** Which MCP servers keep a row when they do not all fit (S5): problems first. */
const MCP_PRIORITY: ConnectionState[] = ["failed", "connecting", "connected"];

const mcpState = (server: McpServerInfo): ConnectionState => (Object.hasOwn(MCP_CONNECTION, server.state) ? MCP_CONNECTION[server.state] : "connecting");

/**
 * The servers that get a row and, past `cap`, the states of the rest: `cap - 1`
 * rows, failed then connecting then connected, each state in config order (S5).
 */
function cappedServers(servers: McpServerInfo[], cap: number): { shown: McpServerInfo[]; hidden: ConnectionState[] } {
	if (servers.length <= cap) return { shown: servers, hidden: [] };
	const ranked = MCP_PRIORITY.flatMap((state) => servers.filter((server) => mcpState(server) === state));
	return { shown: ranked.slice(0, cap - 1), hidden: ranked.slice(cap - 1).map(mcpState) };
}

/** `+7 more · 2 connecting · 5 connected` under the names: the counts drop from the right until it fits, then `+N more` is cut. */
function mcpSummaryRow(hidden: ConnectionState[], width: number): Row {
	const lead = sessionKey("") + "  ";
	const counts = MCP_PRIORITY.flatMap((state) => {
		const count = hidden.filter((hiddenState) => hiddenState === state).length;
		return count > 0 ? [muted(" · ") + fg(CONNECTION[state].color, `${count} ${CONNECTION[state].word}`)] : [];
	});
	for (let kept = counts.length; kept > 0; kept--) {
		const text = lead + muted(`+${hidden.length} more`) + counts.slice(0, kept).join("");
		if (visibleWidth(text) <= width) return { text };
	}
	return { text: ellipsize(lead + muted(`+${hidden.length} more`), width) };
}

/**
 * The memory row (Engram, lib/memory.ts), then one row per MCP server (S32), or
 * a muted `mcp none configured` without MCP config. Names and state words form
 * their own columns; the gap between them closes to one space when two would
 * not fit; the saved count drops before anything else. Past `mcpCap` servers
 * the last mcp row sums up the ones left out (S5); /dock passes no cap.
 */
function connectionRows(session: SessionInfo, width: number, mcpCap = MCP_ROWS): Row[] {
	const items: { key: string; name: string; state: ConnectionState; tail?: string }[] = [];
	const memory = session.memory;
	if (memory) {
		const state: ConnectionState = Object.hasOwn(CONNECTION, memory.state) ? memory.state : "missing";
		items.push({ key: "memory", name: "engram", state, ...(state === "connected" && memory.saved !== undefined ? { tail: muted(` · ${memory.saved} saved`) } : {}) });
	}
	const { shown, hidden } = cappedServers(session.mcp ?? [], mcpCap);
	shown.forEach((server, index) => {
		items.push({ key: index === 0 ? "mcp" : "", name: server.name, state: mcpState(server) });
	});
	const nameWidth = Math.min(CONNECTION_NAME_CAP, Math.max(0, ...items.map((item) => visibleWidth(item.name))));
	const wordWidth = Math.max(0, ...items.map((item) => CONNECTION[item.state].word.length));
	const gap = KEY_CELLS + 2 + nameWidth + 2 + wordWidth <= width ? "  " : " ";
	const rows = items.map((item): Row => {
		const look = CONNECTION[item.state];
		const off = item.state === "missing";
		const name = fg(off ? palette.muted : palette.text, ellipsize(item.name, nameWidth));
		const lead = `${sessionKey(item.key)}${fg(look.color, look.glyph)} ${padEnd(name, nameWidth)}${gap}${fg(off ? palette.muted : look.color, look.word)}`;
		const whole = item.tail ? lead + item.tail : lead;
		return { text: ellipsize(visibleWidth(whole) <= width ? whole : lead, width) };
	});
	if (hidden.length > 0) rows.push(mcpSummaryRow(hidden, width));
	if (session.mcp?.length === 0) rows.push({ text: ellipsize(sessionKey("mcp") + muted("none configured"), width) });
	return rows;
}

/** Each skill scope's color (skills-view S1): package lilac, user blue, project green. */
const SKILL_COLOR: Record<SkillScope, Rgb> = { package: palette.lilac, user: palette.blue, project: palette.green };
/** The scope word's column in the unfolded rail rows (S2): the longest word and one space. */
const SKILL_SCOPE_CELLS = 8;
/** The unfolded /dock rows' names start this many columns in (S3), under the scope header. */
const SKILL_INDENT = KEY_CELLS + 2;

/** The skills by scope, package then user then project, each in Pi's order; empty scopes left out. */
function skillGroups(list: SkillInfo[]): { scope: SkillScope; skills: SkillInfo[] }[] {
	return SKILL_SCOPES.map((scope) => ({ scope, skills: list.filter((skill) => skill.scope === scope) })).filter((group) => group.skills.length > 0);
}

/** `skills ▸ 25 loaded · 16 package · 9 user` (S1), `▾` unfolded (S2): the scope counts drop from the right until it fits, then the row is cut. */
function skillsHeadRow(skills: SkillsInfo, width: number): Row {
	if (skills.list.length === 0) return { text: ellipsize(sessionKey("skills") + muted("none loaded"), width) };
	const lead = sessionKey("skills") + fg(palette.teal, skills.open ? "▾" : "▸") + " " + bold(plainText(String(skills.list.length))) + muted(" loaded");
	const counts = skillGroups(skills.list).map((group) => muted(" · ") + fg(SKILL_COLOR[group.scope], `${group.skills.length} ${group.scope}`));
	for (let kept = counts.length; kept > 0; kept--) {
		const text = lead + counts.slice(0, kept).join("");
		if (visibleWidth(text) <= width) return { text };
	}
	return { text: ellipsize(lead, width) };
}

/** The rail's unfolded rows of one scope (S2): the scope word, then its names comma-separated, wrapped onto rows aligned under the first name. */
function skillNameRows(scope: SkillScope, skills: SkillInfo[], width: number): Row[] {
	const lead = KEY_CELLS + SKILL_SCOPE_CELLS;
	const room = Math.max(1, width - lead);
	const lines: string[] = [];
	skills.forEach((skill, index) => {
		const token = ellipsize(index < skills.length - 1 ? `${skill.name},` : skill.name, room);
		const last = lines.length - 1;
		if (last >= 0 && visibleWidth(lines[last]) + 1 + visibleWidth(token) <= room) lines[last] += ` ${token}`;
		else lines.push(token);
	});
	return lines.map((line, index) => ({
		text: ellipsize((index === 0 ? sessionKey("") + fg(SKILL_COLOR[scope], scope.padEnd(SKILL_SCOPE_CELLS)) : " ".repeat(lead)) + plainText(line), width),
	}));
}

/** /dock's unfolded rows (S3): each scope's header with its count, then one row per skill, the name and its description muted, cut to the width. */
function skillDescriptionRows(list: SkillInfo[], width: number): Row[] {
	const nameCap = Math.max(8, Math.floor((width - SKILL_INDENT) / 2));
	const nameWidth = Math.min(nameCap, Math.max(0, ...list.map((skill) => visibleWidth(skill.name))));
	return skillGroups(list).flatMap(({ scope, skills }) => [
		{ text: ellipsize(sessionKey("") + fg(SKILL_COLOR[scope], scope) + muted(`  ${skills.length}`), width) },
		...skills.map((skill) => {
			const name = plainText(padEnd(ellipsize(skill.name, nameWidth), nameWidth));
			return { text: ellipsize(" ".repeat(SKILL_INDENT) + name + (skill.description ? `  ${muted(skill.description)}` : ""), width) };
		}),
	]);
}

/** The skills rows (S1-S3): none while unreadable; the head row; unfolded, the names by scope, or with `details` (/dock) one row per skill with its description. */
function skillsRows(session: SessionInfo, width: number, details: boolean): Row[] {
	const skills = session.skills;
	if (!skills) return [];
	const head = skillsHeadRow(skills, width);
	if (!skills.open || skills.list.length === 0) return [head];
	if (details) return [head, ...skillDescriptionRows(skills.list, width)];
	return [head, ...skillGroups(skills.list).flatMap((group) => skillNameRows(group.scope, group.skills, width))];
}

/**
 * `unpushed`: the heads-up already says how many commits are ahead, so ↑N is
 * left out (S8). `mcpCap`: the mcp rows at most (S5). `skillDetails`: unfolded
 * skills get a row each with their description (/dock, skills-view S3).
 */
function sessionSection(session: SessionInfo, width: number, unpushed = false, footer?: FooterInfo, mcpCap = MCP_ROWS, skillDetails = false): Section {
	const ahead = session.ahead && !unpushed ? ` ↑${session.ahead}` : "";
	const branch = session.branch ? `  ${fg(palette.green, session.branch + ahead)}` : "";
	const where: Row = { text: ellipsize(sessionKey("project") + bold(plainText(session.project)) + branch, width) };
	const usage = [...(session.contextPercent !== undefined ? contextRows(session, width) : []), ...profileRows(session, width, footer)];
	return { title: "session", color: palette.teal, rows: [where, ...usage, ...connectionRows(session, width, mcpCap), ...skillsRows(session, width, skillDetails)] };
}

// `!` is one column in every terminal; `⚠` is ambiguous-width and could push a line past the rail.
const WARNING_GLYPH: Record<HeadsUpWarning["kind"], string> = {
	worktrees: bold(fg(palette.red, "!")),
	unpushed: bold(fg(palette.red, "!")),
	branches: bold(fg(palette.red, "!")),
	todo: bold(fg(palette.amber, "!")),
	plan: bold(fg(palette.amber, "!")),
};

/** The colored `!` the heads-up section draws for `kind`. */
export function warningGlyph(kind: HeadsUpWarning["kind"]): string {
	return WARNING_GLYPH[kind] ?? WARNING_GLYPH.worktrees;
}

function headsUpSection(warnings: HeadsUpWarning[], width: number): Section | undefined {
	if (warnings.length === 0) return undefined;
	const shown = warnings.length > HEADS_UP_CAP ? warnings.slice(0, HEADS_UP_CAP - 1) : warnings;
	const rows = shown.map((warning) => ({
		text: item(warningGlyph(warning.kind), (rest) => plainText(ellipsize(warning.text, rest)), width),
	}));
	return { title: "heads-up", color: palette.red, rows: [...rows, ...moreRow(warnings.length - shown.length, width)] };
}

// Blocked waits on something outside the list; dropped will not be done, so it is muted.
const TASK_GLYPH: Record<Exclude<TodoTask["state"], "active">, string> = {
	done: fg(palette.green, "✓"),
	pending: fg(palette.faint, "○"),
	blocked: fg(palette.amber, "◌"),
	dropped: fg(palette.faint, "-"),
};

/** The active task's row: the spinner in the accent's tone `pink` (look-more S4) and the bold title, entering at `entrance` (S54). */
function activeTaskRow(title: string, width: number, spinner?: number, entrance?: number, pink: Rgb = palette.pink): Row {
	const text = (rest: number) => {
		const cut = ellipsize(title, rest);
		return entering([{ text: cut, color: palette.text, bold: true }], palette.coral, entrance, bold(plainText(cut)));
	};
	return { text: item(fg(glyphColor(pink, palette.coral, entrance), spinnerAt(spinner)), text, width), highlight: true };
}

/** One row per task, in list order (S26): /dock, and the rail while the list fits (S58). */
function taskRows(tasks: TodoTask[], width: number, spinner?: number, entrance?: number, pink?: Rgb): Row[] {
	return tasks.map((task) => {
		if (task.state === "active") return activeTaskRow(task.title, width, spinner, entrance, pink);
		const style = task.state === "done" || task.state === "dropped" ? muted : plainText;
		return { text: item(TASK_GLYPH[task.state] ?? TASK_GLYPH.pending, (rest) => style(ellipsize(task.title, rest)), width) };
	});
}

/** The rail shows every task up to this many; past it, a window of RAIL_TASK_WINDOW tasks (S58). */
const RAIL_TASKS = 8;
const RAIL_TASK_WINDOW = 7;

function moreTodoRow(more: number, width: number): Row {
	return { text: item(" ", (rest) => spread(muted(`+${more} more`), `${plainText("/dock")}${muted(" all")}`, rest), width) };
}

/**
 * The rail's task list (S58): every task while they fit RAIL_TASKS rows; past
 * that, the tasks before the window fold into one row, the window starts at the
 * task before the active one (else the first open task, else the last task) and
 * the tasks after it fold into `+N more`.
 */
function railTaskRows(tasks: TodoTask[], width: number, spinner?: number, entrance?: number, pink?: Rgb): Row[] {
	if (tasks.length <= RAIL_TASKS) return taskRows(tasks, width, spinner, entrance, pink);
	const active = tasks.findIndex((task) => task.state === "active");
	const open = tasks.findIndex((task) => task.state === "pending" || task.state === "blocked");
	const anchor = active >= 0 ? active : open >= 0 ? open : tasks.length - 1;
	const start = Math.min(Math.max(0, anchor - 1), tasks.length - RAIL_TASK_WINDOW);
	const end = start + RAIL_TASK_WINDOW;
	const rows: Row[] = [];
	if (start > 0) {
		const label = tasks.slice(0, start).every((task) => task.state === "done") ? `${start} earlier done` : `${start} earlier`;
		rows.push({ text: item(fg(palette.green, "✓"), (rest) => muted(ellipsize(label, rest)), width) });
	}
	rows.push(...taskRows(tasks.slice(start, end), width, spinner, entrance, pink));
	if (end < tasks.length) rows.push(moreTodoRow(tasks.length - end, width));
	return rows;
}

/**
 * Without a todo list or with 0 tasks the side panel still draws it (S94): one
 * muted row, like ODD's ready row (S52). The narrow todo card does not (S28).
 */
function emptyTodoSection(width: number): Section {
	return { title: "todo", color: palette.coral, rows: [{ text: item(fg(palette.faint, "○"), (rest) => muted(ellipsize("no tasks · the list shows while I plan", rest)), width) }] };
}

function todoSection(todo: TodoInfo, width: number, expanded = false, spinner?: number, compact = false, colors?: ColorMode, accent?: Accent): Section | undefined {
	if (todo.total <= 0) return undefined;
	const color = palette.coral;
	const pink = accentBase(accent);
	const right = fg(panelAccent(color, colors), `${todo.done}/${todo.total}`);
	if (expanded && todo.tasks?.length) return { title: "todo", color, right, rows: taskRows(todo.tasks, width, spinner, todo.entrance, pink) };
	if (!compact && todo.tasks?.length) {
		// S58: the listed rail keeps the progress bar, on the title before done/total.
		const cells = Math.min(todo.total, BAR_CELLS);
		const bar = meter(cells, Math.round((todo.done / todo.total) * cells), dim(color, 0.7), dim(color, 0.7));
		return { title: "todo", color, right: `${bar} ${right}`, rows: railTaskRows(todo.tasks, width, spinner, todo.entrance, pink) };
	}
	// Fixed height (S7): done collapses to one row, then active, next and a summary.
	const rows: Row[] = [];
	if (todo.done > 0) {
		const cells = Math.min(todo.total, BAR_CELLS);
		const bar = meter(cells, Math.round((todo.done / todo.total) * cells), dim(color, 0.7), dim(color, 0.7));
		rows.push({ text: spread(`${fg(palette.green, "✓")} ${muted(`${todo.done} done`)}`, bar, width) });
	}
	if (todo.active) rows.push(activeTaskRow(todo.active, width, spinner, todo.entrance, pink));
	if (todo.next) rows.push({ text: item(fg(palette.faint, "○"), (rest) => plainText(ellipsize(todo.next!, rest)), width) });
	if (todo.more > 0) rows.push(moreTodoRow(todo.more, width));
	return { title: "todo", color, right, rows };
}

/**
 * Always drawn (S52): a ready row before the first request, the timeline while
 * it runs, one summary row once it settled (`expanded`, /dock: the timeline).
 * `spacers` false leaves out the `│` rows between steps (short screens, S34);
 * `latestOnly` keeps just the latest step row (the shortest screens, S52).
 */
function oddSection(odd: OddInfo | undefined, width: number, spacers = true, expanded = false, latestOnly = false, doneDetails = true): Section {
	const section = (rows: Row[]): Section => ({ title: "ODD", color: palette.amber, rows });
	if (!odd || odd.steps.length === 0) {
		return section([{ text: item(fg(palette.faint, "○"), (rest) => muted(ellipsize("ready · phases show while I work", rest)), width) }]);
	}
	if (odd.settled && !expanded) {
		const phases = odd.steps.length + Math.max(0, Math.floor(odd.earlier ?? 0));
		const seconds = odd.totalSeconds ?? odd.steps.reduce((sum, step) => sum + step.seconds, 0);
		const right = muted(`${formatTime(seconds)} · ${phases} ${phases === 1 ? "phase" : "phases"}`);
		return section([{ text: item(fg(palette.green, "✓"), (rest) => spread(plainText("last request"), right, rest), width) }]);
	}
	if (latestOnly) return section(oddSection({ steps: odd.steps.slice(-1).map(({ detail: _, ...step }) => step) }, width, false).rows);
	const shown = odd.steps.slice(-ODD_CAP);
	const hidden = odd.steps.length - shown.length + Math.max(0, Math.floor(odd.earlier ?? 0));
	// The active step's orb may be up to 3 cells (S17); every row's label starts after it.
	const column = Math.max(1, ...shown.map((step) => (step.state === "active" ? orbWidth(step.phase) : 1)));
	const rows: Row[] = hidden > 0 ? [{ text: item(" ", (rest) => muted(ellipsize(`+${hidden} earlier`, rest)), width, column) }] : [];
	shown.forEach((step) => {
		if (spacers && rows.length > 0) rows.push({ text: fg(palette.faint, "│") });
		const time = formatTime(step.seconds);
		if (step.state === "active") {
			const orb = bold(fg(glyphColor(orbOf(step.phase)?.color ?? palette.pink, palette.amber, step.entrance), orbAt(step.phase, step.frame)));
			// The entrance (S54) first, then the label's own shine (S49).
			const label = entering([{ text: step.phase, color: palette.muted }], palette.amber, step.entrance, shimmerText(step.phase, step.scan));
			const text = item(orb, (rest) => spread(label, plainText(time), rest), width, column);
			rows.push({ text, highlight: true });
		} else {
			rows.push({ text: item(fg(palette.green, "✓"), (rest) => spread(muted(step.phase), muted(time), rest), width, column) });
		}
		// What the step did (S60): a muted line under its label; `doneDetails` false keeps only the active one.
		const detail = step.detail;
		if (detail && (doneDetails || step.state === "active")) rows.push({ text: item("", (rest) => muted(fitDetail(detail, rest)), width, column) });
	});
	return section(rows);
}

const RDD_LABEL: Record<RddReview["status"], string> = {
	reviewing: "reviewing…",
	fixing: "fixing…",
	waiting: "needs your OK",
	approved: "approved",
	outdated: "outdated · code changed",
	unavailable: "unavailable",
	skipped: "skipped",
};

/** Local HH:MM of epoch `ms`. */
function clockTime(ms: number): string {
	const date = new Date(ms);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** The words a review row shows for `status`. */
export function rddLabel(status: RddReview["status"]): string {
	return RDD_LABEL[status] ?? status;
}

function rddRow(review: RddReview, width: number, spinner?: number): Row {
	const label = rddLabel(review.status);
	const step = review.entrance;
	const glyphFg = (color: Rgb, glyph: string) => fg(glyphColor(color, palette.rose, step), glyph);
	if (review.status === "reviewing" || review.status === "fixing" || review.status === "waiting") {
		const waiting = review.status === "waiting";
		const glyph = waiting ? bold(glyphFg(palette.amber, "!")) : bold(glyphFg(palette.teal, spinnerAt(spinner)));
		const labelColor = waiting ? palette.amber : palette.muted;
		const pieces = [{ text: review.scope, color: palette.text, bold: true }, { text: ` ${label}`, color: labelColor }];
		const text = entering(pieces, palette.rose, step, `${bold(plainText(review.scope))} ${fg(labelColor, label)}`);
		return { text: item(glyph, (rest) => spread(text, plainText(formatTime(review.seconds ?? 0)), rest), width), highlight: true };
	}
	const time = review.endedAt !== undefined && Number.isFinite(review.endedAt) ? muted(clockTime(review.endedAt)) : "";
	if (review.status === "skipped") {
		const text = entering([{ text: `${review.scope} ${label}`, color: palette.muted }], palette.rose, step, muted(`${review.scope} ${label}`));
		return { text: item(glyphFg(palette.faint, "-"), (rest) => spread(text, time, rest), width) };
	}
	const glyph = review.status === "approved" ? glyphFg(palette.green, "✓") : glyphFg(palette.red, "✗");
	const text = entering([{ text: review.scope, color: palette.text }, { text: ` ${label}`, color: palette.muted }], palette.rose, step, `${plainText(review.scope)} ${muted(label)}`);
	return { text: item(glyph, (rest) => spread(text, time, rest), width) };
}

/**
 * The session's reviews (S50, design 15): the switch on the title, one row per
 * review like the ODD timeline, or one line saying what RDD does while there
 * are none. No switch and no reviews (no Gentle AI): no section.
 */
function rddSection(rdd: RddInfo | undefined, mode: FooterInfo["rdd"], width: number, spacers = true, spinner?: number, doneDetails = true, colors?: ColorMode): Section | undefined {
	const reviews = rdd?.reviews ?? [];
	if (reviews.length === 0 && !mode) return undefined;
	const right = mode === "on" ? bold(fg(panelAccent(palette.green, colors), "on")) : mode === "off" ? bold(fg(palette.muted, "off")) : undefined;
	const section = (rows: Row[]): Section => ({ title: "RDD", color: palette.rose, ...(right ? { right } : {}), rows });
	if (reviews.length === 0) {
		// One-column dot (S57): the 🌹 emoji has no fixed width across terminals and broke the frame.
		if (mode === "on") return section([{ text: item(fg(palette.green, "●"), (rest) => muted(ellipsize("watching · reviews high-risk changes", rest)), width) }]);
		return section([{ text: item(fg(palette.faint, "○"), (rest) => muted(ellipsize("off · changes are not reviewed", rest)), width) }]);
	}
	const shown = reviews.slice(-ODD_CAP);
	const hidden = reviews.length - shown.length;
	const rows: Row[] = hidden > 0 ? [{ text: item(" ", (rest) => muted(ellipsize(`+${hidden} earlier`, rest)), width) }] : [];
	for (const review of shown) {
		if (spacers && rows.length > 0) rows.push({ text: fg(palette.faint, "│") });
		rows.push(rddRow(review, width, spinner));
		// What the review is doing or found (S62): a muted line under it; `doneDetails` false keeps only a running one's.
		const detail = review.detail;
		const running = review.status === "reviewing" || review.status === "fixing" || review.status === "waiting";
		if (detail && (doneDetails || running)) rows.push({ text: item("", (rest) => muted(ellipsize(detail, rest)), width) });
	}
	return section(rows);
}

/** A check's duration or running time, muted unless it runs; none when gh gave no times. */
const ciTime = (check: CiCheck, color: (text: string) => string = muted) => (check.seconds !== undefined ? color(formatTime(check.seconds)) : "");

function ciRow(check: CiCheck, width: number, spinner?: number): Row {
	const row = (glyph: string, text: string, right: string): Row => ({ text: item(glyph, (rest) => spread(text, right, rest), width) });
	switch (check.state) {
		case "running":
			return { ...row(bold(fg(palette.blue, spinnerAt(spinner))), `${bold(plainText(check.name))} ${muted("running…")}`, ciTime(check, plainText)), highlight: true };
		case "queued":
			return row(fg(palette.faint, "○"), muted(check.name), muted("queued"));
		case "passed":
			return row(fg(palette.green, "✓"), `${plainText(check.name)} ${muted("passed")}`, ciTime(check));
		case "failed":
			return row(fg(palette.red, "✗"), `${plainText(check.name)} ${fg(palette.red, "failed")}`, ciTime(check));
		default:
			return row(fg(palette.faint, "-"), muted(`${check.name} cancelled`), ciTime(check));
	}
}

/** One muted line under a CI row, aligned with its name. */
const ciLine = (text: string, width: number): Row => ({ text: item("", (rest) => muted(ellipsize(text, rest)), width) });

/**
 * The last pushed commit's checks (S64, design 24 option C): one row per
 * workflow while one runs, waits or failed, a failed one with a muted line
 * naming its job; once all passed, one summary row and a muted line.
 * `details` false leaves out the muted lines (short screens). No runs: no section.
 */
function ciSection(ci: CiInfo | undefined, width: number, details = true, spinner?: number): Section | undefined {
	if (!ci?.checks.length) return undefined;
	const section = (rows: Row[]): Section => ({ title: "CI", color: palette.blue, right: muted(ci.sha), rows });
	const checks = ci.checks;
	if (checks.every((check) => check.state === "passed")) {
		const words = `${checks.length} ${checks.length === 1 ? "check" : "checks"} passed`;
		const ended = ci.endedAt !== undefined && Number.isFinite(ci.endedAt) ? muted(clockTime(ci.endedAt)) : "";
		const rows = [{ text: item(fg(palette.green, "✓"), (rest) => spread(plainText(words), ended, rest), width) }];
		// No known duration: the names alone, never a made-up longest 0:00 (S66).
		const times = checks.flatMap((check) => (check.seconds !== undefined ? [check.seconds] : []));
		const names = checks.map((check) => check.name).join(", ");
		if (details) rows.push(ciLine(times.length ? `${names} · longest ${formatTime(Math.max(...times))}` : names, width));
		return section(rows);
	}
	// Held (S66): a running check shows the still frame while other spinners turn.
	const frame = ci.stale ? undefined : spinner;
	const rows = checks.slice(0, CI_CAP).flatMap((check) => [ciRow(check, width, frame), ...(details && check.failedJob ? [ciLine(check.failedJob, width)] : [])]);
	return section([...rows, ...moreRow(checks.length - CI_CAP, width)]);
}

function moreRow(hidden: number, width: number): Row[] {
	return hidden > 0 ? [{ text: item(" ", (rest) => muted(ellipsize(`+${hidden} more`, rest)), width) }] : [];
}

const AGENT_GLYPH: Record<Exclude<AgentInfo["state"], "running">, [Rgb, string]> = {
	done: [palette.green, "✓"],
	failed: [palette.red, "✗"],
	queued: [palette.faint, "○"],
	// A subagent task asking the user (S87): the amber `!` of RDD's needs-your-OK row.
	waiting: [palette.amber, "!"],
};

/** Running or waiting (S87): listed on the agents card and counted by the strip. */
export const agentLive = (agent: AgentInfo): boolean => agent.state === "running" || agent.state === "waiting";

/** Running (and unknown) agents get the spinner at frame `spinner`; lilac during an entrance flash (S54). */
function agentGlyph(state: AgentInfo["state"], spinner?: number, entrance?: number): string {
	const [color, glyph] = state !== "running" && Object.hasOwn(AGENT_GLYPH, state) ? AGENT_GLYPH[state] : [palette.blue, spinnerAt(spinner)];
	return fg(glyphColor(color, palette.lilac, entrance), glyph);
}

/** An agent's bold name and muted task, entering at `entrance` (S54). */
function agentText(name: string, task: string, entrance?: number): string {
	const pieces = [{ text: name, color: palette.text, bold: true }, { text: ` ${task}`, color: palette.muted }];
	return entering(pieces, palette.lilac, entrance, `${bold(plainText(name))} ${muted(task)}`);
}

const EFFORT_COLOR: Record<string, Rgb> = {
	minimal: palette.amber,
	low: palette.amber,
	medium: palette.blue,
	high: palette.purple,
	xhigh: palette.purple,
	max: palette.purple,
};

const MODEL_FAMILY = /(?:^|-)(opus|sonnet|haiku)(?:-|$)/;

/**
 * An agent's model label (S69, design 19 option C), widest first: the family
 * (`opus`; the short model when it names none) in its effort's color, muted
 * without one, then a muted ` · effort`; the family alone; none. No model: none.
 */
function agentLabels(agent: AgentInfo): string[] {
	if (!agent.model) return [];
	const short = shortAgentModel(agent.model);
	const family = MODEL_FAMILY.exec(short)?.[1] ?? short;
	const name = fg(agent.effort && Object.hasOwn(EFFORT_COLOR, agent.effort) ? EFFORT_COLOR[agent.effort] : palette.muted, family);
	return agent.effort ? [name + muted(` · ${agent.effort}`), name] : [name];
}

/**
 * An agent row's `left` text, then `time` and its model label flush right
 * (S69): the task is cut first, then the effort drops, then the label, then
 * the time, as `spread` drops a right value.
 */
function agentRow(agent: AgentInfo, left: string, time: string, width: number): string {
	const rights = [...agentLabels(agent).map((label) => (time ? `${time} ${label}` : label)), time];
	const fits = rights.find((right) => width - visibleWidth(right) - 1 >= Math.min(visibleWidth(left), MIN_LEFT));
	return spread(left, fits ?? time, width);
}

/** A live agent's time since `startedAt` at `now` (S35); "" for a finished agent, an unknown start or no `now`. */
function agentTime(agent: AgentInfo, now?: number): string {
	return now !== undefined && agentLive(agent) && agent.startedAt !== undefined && Number.isFinite(agent.startedAt) ? plainText(formatElapsed(now - agent.startedAt)) : "";
}

function agentsSection(agents: AgentInfo[], width: number, spinner?: number, cap = LIST_CAP, now?: number): Section | undefined {
	if (agents.length === 0) return undefined;
	const rows = agents.slice(0, cap).map((agent) => ({
		text: item(agentGlyph(agent.state, spinner, agent.entrance), (rest) => agentRow(agent, agentText(agent.name, agent.task, agent.entrance), agentTime(agent, now), rest), width),
		// A task waiting for the user stands out like a review that needs an OK (S87).
		...(agent.state === "waiting" ? { highlight: true } : {}),
	}));
	return { title: "agents", color: palette.lilac, rows: [...rows, ...moreRow(agents.length - cap, width)] };
}

// ASCII `-` for deleted: U+2212 is ambiguous-width. `●` matches the mcp dots, `→` the branch `↑`.
const CHANGE_KIND: Record<ChangeInfo["status"], { glyph: string; color: Rgb; word?: string }> = {
	M: { glyph: "●", color: palette.amber },
	A: { glyph: "+", color: palette.green, word: "new" },
	"?": { glyph: "+", color: palette.green, word: "new" },
	D: { glyph: "-", color: palette.red, word: "deleted" },
	R: { glyph: "→", color: palette.blue, word: "renamed" },
};

/** The bold file name, then its muted folder; the folder is cut first, the name only once no folder fits. */
function fileLabel(name: string, folder: string, width: number): string {
	const nameWidth = visibleWidth(name);
	if (!folder || nameWidth + 2 > width) return bold(plainText(ellipsize(name, width)));
	return `${bold(plainText(name))} ${muted(ellipsize(folder, width - nameWidth - 1))}`;
}

function changeRow(change: ChangeInfo, width: number): Row {
	const kind = CHANGE_KIND[change.status] ?? CHANGE_KIND.M;
	const slash = change.path.lastIndexOf("/");
	const name = change.path.slice(slash + 1);
	const folder = change.path.slice(0, slash + 1);
	// git has no line counts for untracked files: a word says what happened instead of +0 -0.
	const right = kind.word
		? fg(kind.color, kind.word)
		: `${fg(change.added > 0 ? palette.green : palette.muted, `+${change.added}`)} ${fg(change.removed > 0 ? palette.red : palette.muted, `-${change.removed}`)}`;
	return {
		text: item(bold(fg(kind.color, kind.glyph)), (rest) => {
			// Like spread: the right side stays while the name keeps MIN_LEFT columns (or all of a shorter name).
			const room = rest - visibleWidth(right) - 1;
			if (room < Math.min(visibleWidth(name), MIN_LEFT)) return fileLabel(name, folder, rest);
			return spread(fileLabel(name, folder, room), right, rest);
		}, width),
	};
}

/**
 * One row per file (S53, design 17), the most changed first (stable on ties);
 * `[]` is a clean tree, one `✓ everything committed` row.
 */
function changesSection(changes: ChangeInfo[], width: number, cap = LIST_CAP): Section {
	const section = { title: "changes", color: palette.green };
	if (changes.length === 0) return { ...section, rows: [{ text: item(fg(palette.green, "✓"), (rest) => muted(ellipsize("everything committed", rest)), width) }] };
	const size = (change: ChangeInfo) => Math.max(0, change.added) + Math.max(0, change.removed);
	const sorted = [...changes].sort((a, b) => size(b) - size(a));
	const rows = sorted.slice(0, cap).map((change) => changeRow(change, width));
	const hidden = changes.length - rows.length;
	if (hidden > 0) rows.push({ text: item(" ", (rest) => muted(ellipsize(`+${hidden} more · /dock all`, rest)), width) });
	return { ...section, right: muted(`${changes.length} to commit`), rows };
}

function topBorder(section: Section, width: number, colors?: ColorMode): string {
	const frame = palette.frame;
	// Titles wear 75% of the cover title's vividness on their own hue (vivid labels S2, L10), their own color in soft (look settings S4).
	const title = (text: string) => bold(fg(panelAccent(section.color, colors), text));
	const titleWidth = visibleWidth(section.title);
	// "╭─ " title " " fill [" " right " ─"] "╮", with at least one fill dash.
	const bare = 3 + titleWidth + 1 + 1 + 1;
	if (section.right) {
		const right = ` ${section.right} `;
		const fill = width - (3 + titleWidth + 1) - visibleWidth(right) - 2;
		if (fill >= 1) return fg(frame, "╭─ ") + title(section.title) + fg(frame, ` ${"─".repeat(fill)}`) + right + fg(frame, "─╮");
	}
	if (width >= bare) return fg(frame, "╭─ ") + title(section.title) + fg(frame, ` ${"─".repeat(width - bare + 1)}╮`);
	if (width >= 7) return fg(frame, "╭─ ") + title(ellipsize(section.title, width - 6)) + fg(frame, " ─╮");
	return fg(frame, truncateToWidth(`╭${"─".repeat(Math.max(0, width - 2))}╮`, width));
}

function drawSection(section: Section, width: number, colors?: ColorMode, accent?: Accent): string[] {
	const frame = palette.frame;
	const inner = width - 4;
	const side = fg(frame, "│");
	const body = section.rows.map((row) => {
		const text = fitWidth(row.text, inner);
		if (!row.highlight) return `${side} ${text} ${side}`;
		// Cut points end in a full reset; put the row background back after each.
		const lit = text.replaceAll(RESET, RESET + HIGHLIGHT);
		return `${side}${HIGHLIGHT}${fg(accentBase(accent), "▎")}${lit} \x1b[49m${side}`;
	});
	return [topBorder(section, width, colors), ...body, fg(frame, `╰${"─".repeat(Math.max(0, width - 2))}╯`)];
}

/** topBorder's geometry with every frame glyph faded by its column (sidebar-chrome/02). */
function fadedTopBorder(section: Section, width: number, colors?: ColorMode): string {
	const title = (text: string) => bold(fg(panelAccent(section.color, colors), text));
	const titleWidth = visibleWidth(section.title);
	const edge = (text: string, start: number) => fadedEdge(text, start, width);
	const bare = 3 + titleWidth + 1 + 1 + 1;
	if (section.right) {
		const right = ` ${section.right} `;
		const fill = width - (3 + titleWidth + 1) - visibleWidth(right) - 2;
		if (fill >= 1) return edge("╭─ ", 0) + title(section.title) + edge(` ${"─".repeat(fill)}`, 3 + titleWidth) + right + edge("─╮", width - 2);
	}
	if (width >= bare) return edge("╭─ ", 0) + title(section.title) + edge(` ${"─".repeat(width - bare + 1)}╮`, 3 + titleWidth);
	if (width >= 7) {
		const cut = ellipsize(section.title, width - 6);
		return edge("╭─ ", 0) + title(cut) + edge(" ─╮", 3 + visibleWidth(cut));
	}
	return edge(truncateToWidth(`╭${"─".repeat(Math.max(0, width - 2))}╮`, width), 0);
}

/**
 * A rail section (sidebar-chrome/02): drawSection's box with a faded frame. The
 * top and bottom fade by column, the sides by row over the box's full height, so
 * each edge is brightest at its middle and the corners sink into the background.
 */
function drawFaded(section: Section, width: number, colors?: ColorMode, accent?: Accent): string[] {
	const inner = width - 4;
	const height = section.rows.length + 2;
	const body = section.rows.map((row, index) => {
		const side = fg(dim(palette.text, fadeAmount(index + 1, height)), "│");
		const text = fitWidth(row.text, inner);
		if (!row.highlight) return `${side} ${text} ${side}`;
		// Cut points end in a full reset; put the row background back after each.
		const lit = text.replaceAll(RESET, RESET + HIGHLIGHT);
		return `${side}${HIGHLIGHT}${fg(accentBase(accent), "▎")}${lit} \x1b[49m${side}`;
	});
	return [fadedTopBorder(section, width, colors), ...body, fadedEdge(`╰${"─".repeat(Math.max(0, width - 2))}╯`, 0, width)];
}

/** A `─` run `cells` long, brightest at its middle and fading into the background at both ends, like the divider. */
function fadedRule(cells: number): string {
	return fadedEdge("─".repeat(Math.max(0, cells)), 0, cells);
}

/** topBorder's fallbacks without the box: ` title ─── right `, the right value dropping, then the title ellipsized. */
function ruleHeader(section: Section, width: number, colors?: ColorMode): string {
	const title = (text: string) => bold(fg(panelAccent(section.color, colors), text));
	const titleWidth = visibleWidth(section.title);
	// " " title " " rule [" " right] " ", with at least one rule cell.
	const bare = 1 + titleWidth + 1 + 1 + 1;
	if (section.right) {
		const fill = width - (1 + titleWidth + 1) - visibleWidth(section.right) - 2;
		if (fill >= 1) return ` ${title(section.title)} ${fadedRule(fill)} ${section.right} `;
	}
	if (width >= bare) return ` ${title(section.title)} ${fadedRule(width - bare + 1)} `;
	if (width >= 5) return ` ${title(ellipsize(section.title, width - 4))} ${fadedRule(1)} `;
	return fadedRule(width);
}

/** A section with no box (S3): its title on a fading rule, then its rows two cells in, highlighted rows in the boxed rows' columns. */
function drawBare(section: Section, width: number, colors?: ColorMode, accent?: Accent): string[] {
	const inner = width - 4;
	const body = section.rows.map((row) => {
		const text = fitWidth(row.text, inner);
		if (!row.highlight) return `  ${text}  `;
		// Cut points end in a full reset; put the row background back after each.
		const lit = text.replaceAll(RESET, RESET + HIGHLIGHT);
		return ` ${HIGHLIGHT}${fg(accentBase(accent), "▎")}${lit} \x1b[49m `;
	});
	return [ruleHeader(section, width, colors), ...body];
}

/** Every section of the panel in frame style `frames`, color mode `colors` and the highlight bar in `accent`; `gaps` puts a blank row between consecutive no-box sections (S3). */
function drawSections(sections: Section[], width: number, frames: FrameStyle, gaps: boolean, colors?: ColorMode, accent?: Accent): string[] {
	if (frames === "classic") return sections.flatMap((section) => drawSection(section, width, colors, accent));
	if (frames !== "none") return sections.flatMap((section) => drawFaded(section, width, colors, accent));
	return sections.flatMap((section, index) => [...(gaps && index > 0 ? [" ".repeat(width)] : []), ...drawBare(section, width, colors, accent)]);
}

function logoLines(width: number, style?: LogoStyle, accent?: Accent): string[] {
	const lines = renderLogo(width, style, accent);
	const widest = Math.max(0, ...lines.map(visibleWidth));
	// Centered over the sections, at most two columns in.
	const indent = " ".repeat(Math.max(0, Math.min(2, Math.floor((width - widest) / 2))));
	return lines.map((line) => indent + line);
}

export interface PanelOptions {
	/** Every todo task instead of the fixed-height summary (S26); /dock only, the rail stays compact (S7). */
	todoExpanded?: boolean;
	/** /dock only (S35, S5): every agent, changed file and MCP server instead of the first 4, and unfolded skills with their descriptions (skills-view S3). */
	listsExpanded?: boolean;
	/** /dock only (S52): every kept ODD step after the request settled, instead of the summary row. */
	oddExpanded?: boolean;
	/** Rows available on screen (S34, S38, S50, S52, S64, S77): the odd and rdd spacer rows and the muted CI lines, then changes, then an all-passed CI, then a CI that runs, waits or failed, then rdd with all but the latest odd step drop until the panel fits. No limit when absent. */
	maxRows?: number;
	/** The section frames (S3): faded boxes (the default, S6), the classic flat gray box, or no box. With no box, a short screen drops the blank rows between sections before anything else. */
	frames?: FrameStyle;
	/** The section titles' and counters' colors (look settings S4): vivid (the default, S6) or soft, their own pastel as before 0.3.0; light paints every color for a light background (look-more S5). */
	colors?: ColorMode;
	/** Fisi Dock's own pink (look-more S4): the highlight bar, the active todo spinner and the logo's SHELL in the accent; pink (the default) is today's. Section titles keep their hues. */
	accent?: Accent;
	/** The rail logo (look settings S2): the braille wordmark (the default, S6), the bold GENTLESHELL text row, or none, so the panel starts at its first section. */
	logo?: LogoStyle;
	/** The rail divider's brightness (look-more S1), renderRail only: medium (the default, today's), off, subtle or strong. */
	divider?: DividerLevel;
	/** Off draws every animated glyph on one fixed frame (look-more S2, stillModel); on (the default) animates as today. */
	motion?: MotionMode;
	/** The sections after session, in this order, a hidden one never drawn (look-more S6); today's order, all shown, when absent. */
	sections?: readonly SectionSetting[];
	/** The wall clock: each running or waiting agent shows its time since `startedAt` (S35); no times when absent. */
	now?: number;
}

/**
 * `model` as motion off draws it (look-more S2): no spinner frame (the still ⠹), the
 * active ODD step's still orb and muted label, and no entrance, so new rows appear at
 * once in their own colors. Every state keeps its glyph.
 */
export function stillModel(model: PanelModel): PanelModel {
	return {
		...model,
		spinner: undefined,
		todo: model.todo && { ...model.todo, entrance: undefined },
		odd: model.odd && { ...model.odd, steps: model.odd.steps.map((step) => ({ ...step, frame: undefined, scan: undefined, entrance: undefined })) },
		rdd: model.rdd && { ...model.rdd, reviews: model.rdd.reviews.map((review) => ({ ...review, entrance: undefined })) },
		agents: model.agents?.map((agent) => ({ ...agent, entrance: undefined })),
	};
}

interface Shape {
	/** The `│` rows between ODD steps and between RDD reviews. */
	spacers: boolean;
	/** The muted line under each finished ODD step (S60); the active step keeps its own until `rdd` drops. */
	oddDetails: boolean;
	/** The muted line under each finished RDD review (S62); a running review keeps its own while RDD shows. */
	rddDetails: boolean;
	/** The muted lines under the CI rows (S64): a failed check's job, the all-passed summary. */
	ciDetails: boolean;
	/** The changes section. */
	changes: boolean;
	/** The CI section (S64) once every check passed; it drops before a live one (S77). */
	settledCi: boolean;
	/** The CI section while a check runs, waits or failed; it drops after changes and a passed CI (S77). */
	ci: boolean;
	/** The RDD section; without it a running ODD keeps only its latest step (S52). */
	rdd: boolean;
}

/** Full panel first, then one more part left out per step; the logo, session, heads-up, ODD, todo (even empty, S94) and agents never drop (S38, S52). Each step names its sections, so it holds in any order (look-more S6). */
const SHAPES: Shape[] = [
	{ spacers: true, oddDetails: true, rddDetails: true, ciDetails: true, changes: true, settledCi: true, ci: true, rdd: true },
	{ spacers: false, oddDetails: false, rddDetails: false, ciDetails: false, changes: true, settledCi: true, ci: true, rdd: true },
	{ spacers: false, oddDetails: false, rddDetails: false, ciDetails: false, changes: false, settledCi: true, ci: true, rdd: true },
	{ spacers: false, oddDetails: false, rddDetails: false, ciDetails: false, changes: false, settledCi: false, ci: true, rdd: true },
	{ spacers: false, oddDetails: false, rddDetails: false, ciDetails: false, changes: false, settledCi: false, ci: false, rdd: true },
	{ spacers: false, oddDetails: false, rddDetails: false, ciDetails: false, changes: false, settledCi: false, ci: false, rdd: false },
];

/** Light is drawn in vivid, then painted (look-more S5). */
const drawnColors = (colors?: ColorMode): ColorMode | undefined => (colors === "light" ? "vivid" : colors);

/** Every rail line for `model`, none wider than `width` visible columns. */
export function renderPanel(moving: PanelModel, width: number, options: PanelOptions = {}): string[] {
	return panelLines(moving, width, options).map((line) => paint(line, options.colors));
}

/** renderPanel's lines before light paints them. */
function panelLines(moving: PanelModel, width: number, options: PanelOptions): string[] {
	const columns = Math.max(0, Math.floor(width));
	if (columns === 0) return [];
	const model = options.motion === "off" ? stillModel(moving) : moving;
	const inner = columns - 4;
	const unpushed = model.headsUp?.some((warning) => warning.kind === "unpushed") ?? false;
	// A check that runs, waits or failed keeps CI on screen longer (S77).
	const ciUrgent = ciLive(model.ci) || (model.ci?.checks.some((check) => check.state === "failed") ?? false);
	const frames = options.frames ?? "faded";
	const colors = drawnColors(options.colors);
	const accent = options.accent;
	// Session first, then the shown sections in the saved order (look-more S6).
	const order = (options.sections ?? DEFAULT_SECTIONS).filter((section) => section.shown).map((section) => section.id);
	const draw = (shape: Shape, gaps: boolean) => {
		const parts: Record<SectionId, () => Section | undefined> = {
			"heads-up": () => model.headsUp && headsUpSection(model.headsUp, inner),
			odd: () => oddSection(model.odd, inner, shape.spacers, options.oddExpanded, !shape.rdd, shape.oddDetails),
			rdd: () => (shape.rdd ? rddSection(model.rdd, model.footer?.rdd, inner, shape.spacers, model.spinner, shape.rddDetails, colors) : undefined),
			ci: () => ((ciUrgent ? shape.ci : shape.settledCi) ? ciSection(model.ci, inner, shape.ciDetails, model.spinner) : undefined),
			agents: () => model.agents && agentsSection(model.agents, inner, model.spinner, options.listsExpanded ? Infinity : LIST_CAP, options.now),
			todo: () => (model.todo && todoSection(model.todo, inner, options.todoExpanded, model.spinner, false, colors, accent)) || emptyTodoSection(inner),
			changes: () => (shape.changes ? model.changes && changesSection(model.changes, inner, options.listsExpanded ? Infinity : LIST_CAP) : undefined),
		};
		const sections = [sessionSection(model.session, inner, unpushed, model.footer, options.listsExpanded ? Infinity : MCP_ROWS, options.listsExpanded), ...order.map((id) => (Object.hasOwn(parts, id) ? parts[id]() : undefined))].filter((section): section is Section => section !== undefined);
		return [...logoLines(columns, options.logo, accent), ...drawSections(sections, columns, frames, gaps, colors, accent)];
	};
	const limit = options.maxRows !== undefined && Number.isFinite(options.maxRows) ? Math.max(0, Math.floor(options.maxRows)) : Infinity;
	// No-box sections give up their blank rows first, then the panel shrinks as usual.
	const steps: [Shape, boolean][] = [...(frames === "none" ? [[SHAPES[0], true] as [Shape, boolean]] : []), ...SHAPES.map((shape): [Shape, boolean] => [shape, frames !== "none"])];
	let lines: string[] = [];
	for (const [shape, gaps] of steps) {
		lines = draw(shape, gaps);
		if (lines.length <= limit) break;
	}
	return lines.map((line) => truncateToWidth(line, columns));
}

/** A divider cell dimmer than this share is drawn blank. */
const DIVIDER_FLOOR = 0.02;

/** The divider's brightest share per level (look-more S1): medium is the box frames' FADE_PEAK, as before; off draws none. */
export const DIVIDER_PEAKS: Readonly<Record<DividerLevel, number>> = { off: 0, subtle: 0.2, medium: FADE_PEAK, strong: 0.55 };

/** Row `index` of `rows`' divider cell (sidebar-chrome): a `│` at most `peak` bright, at the middle, that fades into the background at the top and bottom. */
function dividerCell(index: number, rows: number, peak: number): string {
	const amount = fadeAmount(index, rows, peak);
	return amount < DIVIDER_FLOOR ? " " : fg(dim(palette.text, amount), "│");
}

/**
 * The wide rail (sidebar-chrome): the divider between the chat and the panel in
 * the first column, a blank so it never touches a box side, then the panel two
 * columns narrower. With `maxRows` the rail fills those rows, so the divider
 * spans the screen even under a short panel.
 */
export function renderRail(model: PanelModel, width: number, options: PanelOptions = {}): string[] {
	const columns = Math.max(0, Math.floor(width));
	if (columns < 3) return renderPanel(model, columns, options);
	const panel = panelLines(model, columns - 2, options);
	const screen = options.maxRows !== undefined && Number.isFinite(options.maxRows) ? Math.floor(options.maxRows) : 0;
	const rows = Math.max(panel.length, screen);
	// Off keeps the blank column, so the panel never moves (look-more S1).
	const peak = DIVIDER_PEAKS[options.divider ?? "medium"] ?? FADE_PEAK;
	return Array.from({ length: rows }, (_, index) => paint(`${dividerCell(index, rows, peak)} ${padEnd(panel[index] ?? "", columns - 2)}`, options.colors));
}

/**
 * The panel's todo section alone, framed to `width` (S28): narrow screens show it
 * above the prompt. Compact, fixed height even with a task list (S7); [] without a todo.
 * `spinner` is the active row's frame (PanelModel.spinner); motion off holds the still
 * frame and plays no entrance (look-more S2). `accent` paints the bar and the spinner (look-more S4).
 */
export function renderTodoCard(todo: TodoInfo | undefined, width: number, spinner?: number, colors?: ColorMode, motion?: MotionMode, accent?: Accent): string[] {
	const columns = Math.max(0, Math.floor(width));
	const still = motion === "off";
	const shown = still && todo ? { ...todo, entrance: undefined } : todo;
	const section = columns > 0 && shown ? todoSection(shown, columns - 4, false, still ? undefined : spinner, true, drawnColors(colors), accent) : undefined;
	if (!section) return [];
	return drawSection(section, columns, drawnColors(colors), accent).map((line) => paint(truncateToWidth(line, columns), colors));
}

/** Agent names past this many cells are cut, so the tasks keep one column. */
const AGENT_NAME_CAP = 12;

/**
 * The live agents alone, framed to `width` (S35): narrow screens show it
 * above the todo card. One row per running or waiting agent (the ones the
 * strip counts): spinner at frame `spinner` (the `!` of a waiting task, S87),
 * name, task and the time since `startedAt` at `now`, left out when the start
 * is unknown. Up to 4 rows, then `+N more`. Queued and finished agents are
 * not listed; [] when nothing runs. Motion off holds the still frame and plays no
 * entrance (look-more S2).
 */
export function renderAgentsCard(agents: AgentInfo[] | undefined, width: number, moving: number | undefined, now: number, colors?: ColorMode, motion?: MotionMode): string[] {
	const columns = Math.max(0, Math.floor(width));
	const still = motion === "off";
	const spinner = still ? undefined : moving;
	const running = (agents ?? []).filter(agentLive).map((agent) => (still ? { ...agent, entrance: undefined } : agent));
	if (columns === 0 || running.length === 0) return [];
	const inner = columns - 4;
	const shown = running.slice(0, LIST_CAP);
	const nameWidth = Math.min(AGENT_NAME_CAP, Math.max(...shown.map((agent) => visibleWidth(agent.name))));
	const rows: Row[] = shown.map((agent) => {
		const name = padEnd(ellipsize(agent.name, nameWidth), nameWidth);
		const time = agentTime(agent, now);
		return { text: item(agentGlyph(agent.state, spinner, agent.entrance), (rest) => agentRow(agent, agentText(name, agent.task, agent.entrance), time, rest), inner) };
	});
	const hidden = running.length - shown.length;
	if (hidden > 0) rows.push({ text: item(" ", (rest) => spread(muted(`+${hidden} more`), `${plainText("/dock")}${muted(" all")}`, rest), inner) });
	const drawn = drawnColors(colors);
	const section: Section = { title: "agents", color: palette.lilac, right: fg(panelAccent(palette.lilac, drawn), String(running.length)), rows };
	return drawSection(section, columns, drawn).map((line) => paint(truncateToWidth(line, columns), colors));
}

/** The panel width the rail draws it at in Gentle Shell fisi/custom's 58-column rail. */
export const DOCK_WIDTH = 55;
/** /dock's widest panel (S59): it fills a phone; a wider screen centers it at this width. */
export const DOCK_MAX_WIDTH = 80;
/** Blank rows above the /dock panel: the rail starts under Gentle Shell's top row and the gap under it (S59). */
export const DOCK_TOP_ROWS = 2;

/** One /dock row, padded to `width` with plain spaces: the overlay replaces the cells under it, so the panel keeps its own colors (S59). */
function boxed(text: string, width: number): string {
	return padEnd(text, width);
}

/** How /dock draws its panel: the rail's look (S3). */
export type DockOptions = Pick<PanelOptions, "frames" | "colors" | "accent" | "logo" | "motion" | "sections" | "now">;

export interface DockView {
	lines: string[];
	/** The first panel row shown, clamped to what can scroll. */
	offset: number;
}

/**
 * The full side panel over the whole screen (S59): exactly as the rail draws
 * it, at the screen width minus one column each side (at most DOCK_MAX_WIDTH,
 * centered), no frame and no colors of its own, so it looks as on the PC. A `height`-row window
 * starting at panel row `offset` (S23 B); the last row says how to close it and,
 * while the panel is taller than the screen, how to scroll. Every row is
 * exactly `width` columns and there are always `height` rows.
 */
export function renderDock(model: PanelModel, width: number, height: number, offset = 0, options: DockOptions = {}): DockView {
	const columns = Math.max(0, Math.floor(width));
	const rows = Math.max(0, Math.floor(height));
	if (columns === 0 || rows === 0) return { lines: [], offset: 0 };
	const inner = Math.max(0, Math.min(DOCK_MAX_WIDTH, columns - 2));
	const left = " ".repeat(Math.floor((columns - inner) / 2));
	const right = " ".repeat(columns - inner - left.length);
	const panel = inner > 0 ? panelLines(model, inner, { todoExpanded: true, listsExpanded: true, oddExpanded: true, frames: options.frames, colors: options.colors, accent: options.accent, logo: options.logo, motion: options.motion, sections: options.sections, now: options.now }) : [];
	const body = panel.map((line) => left + padEnd(truncateToWidth(line, inner), inner) + right);
	// The top margin gives way first on a screen too short for it and two rows.
	const topRows = Math.min(DOCK_TOP_ROWS, Math.max(0, rows - 3));
	const room = rows - 1 - topRows;
	const last = Math.max(0, body.length - room);
	const at = Math.max(0, Math.min(last, Math.floor(Number.isFinite(offset) ? offset : 0)));
	const shown = body.slice(at, at + room);
	const hint = left + padEnd(spread(muted("Esc to close"), last > 0 ? muted("↑↓ scroll") : "", inner), inner) + right;
	const lines = [...Array<string>(topRows).fill(""), ...shown, ...Array<string>(room - shown.length).fill(""), hint];
	return { lines: lines.map((line) => paint(boxed(truncateToWidth(line, columns), columns), options.colors)), offset: at };
}

/** Cheap change key for the rail memo: any drawn value change changes it. */
export function panelDigest(model: PanelModel): string {
	return `fisi-dock/panel:${JSON.stringify(model)}`;
}
