import { ciLive } from "./ci.ts";
import { entranceFlash, entranceText, type EntrancePiece } from "./entrance.ts";
import { renderLogo } from "./logo.ts";
import { fitDetail } from "./odd-detail.ts";
import { orbAt, orbOf, orbWidth, shimmerText, spinnerAt } from "./orbs.ts";
import type { AgentInfo, ChangeInfo, CiCheck, CiInfo, FooterInfo, HeadsUpWarning, McpServerInfo, OddInfo, PanelModel, RddInfo, RddReview, SessionInfo, TodoInfo, TodoTask } from "./panel-model.ts";
import { shortAgentModel } from "./prompt-line.ts";
import { RESET, bgCode, bold, dim, fg, palette, type Rgb } from "./palette.ts";
import { ellipsize, padEnd, truncateToWidth, visibleWidth } from "./text.ts";

// Pure model-to-lines renderer for the rail (design 07, S2/S8/S9). Gentle Shell
// hides the whole rail when one line is too wide, so every line is cut to fit.

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

/** Where the context line puts its marks: the percents at which its color turns. */
const CONTEXT_MARKS = [60, 85];

/**
 * The thin context line (S55): one cell per column; a filled cell wears the color of
 * its own position, an empty one is faint, with `┼` on the empty cells at the marks.
 */
function contextLine(percent: number, cells: number): string {
	let line = "";
	for (let index = 0; index < cells; index++) {
		const at = ((index + 0.5) / cells) * 100;
		if (at <= percent) line += fg(contextColor(at), "━");
		else line += fg(palette.faint, CONTEXT_MARKS.some((mark) => Math.abs(at - mark) < 100 / cells / 2) ? "┼" : "━");
	}
	return line;
}

const sessionKey = (label: string) => muted(label.padEnd(9));

/** Session cost, or tokens and the ≈ estimate (S37); the review state lives in the RDD section (S50). */
function costRow(footer: FooterInfo, width: number): Row {
	const dollars = Number.isFinite(footer.cost) ? footer.cost : 0;
	const usage = usageParts(footer);
	const cost = usage ? usage.map((part, index) => (index % 2 ? muted(part) : plainText(part))).join("") : plainText(`$${dollars.toFixed(3)}`);
	return { text: ellipsize(sessionKey("cost") + cost, width) };
}

const MCP_DOT: Record<McpServerInfo["state"], Rgb> = { connected: palette.green, failing: palette.red, unknown: palette.faint };

/** One dot and name per server, in order; the ones that do not fit drop from the right as `+N` (S32). */
function mcpRow(servers: McpServerInfo[], width: number): Row {
	const room = width - 9;
	const items = servers.map((server) => `${fg(MCP_DOT[server.state] ?? palette.faint, "●")} ${plainText(server.name)}`);
	const more = (count: number) => (count < items.length ? muted(` +${items.length - count}`) : "");
	const row = (shown: string): Row => ({ text: ellipsize(sessionKey("mcp") + shown, width) });
	for (let count = items.length; count > 0; count--) {
		const line = items.slice(0, count).join(" ") + more(count);
		if (visibleWidth(line) <= room) return row(line);
	}
	// Not even the first one fits whole: its name is cut.
	return row(ellipsize(items[0], Math.max(0, room - visibleWidth(more(1)))) + more(1));
}

/** `unpushed`: the heads-up already says how many commits are ahead, so ↑N is left out (S8). */
function sessionSection(session: SessionInfo, width: number, unpushed = false, footer?: FooterInfo): Section {
	const key = sessionKey;
	const rows: Row[] = [];
	const ahead = session.ahead && !unpushed ? ` ↑${session.ahead}` : "";
	const branch = session.branch ? ` ${fg(palette.green, session.branch + ahead)}` : "";
	rows.push({ text: ellipsize(key("project") + bold(plainText(session.project)) + branch, width) });
	if (session.contextPercent !== undefined) {
		const percent = Math.max(0, Math.min(100, session.contextPercent));
		const rounded = Math.round(percent);
		rows.push({ text: spread(muted("context"), bold(fg(contextColor(rounded), `${rounded}%`)) + muted(" used"), width) });
		rows.push({ text: contextLine(percent, width) });
	}
	if (session.profile) rows.push({ text: ellipsize(key("profile") + plainText(session.profile), width) });
	if (footer) rows.push(costRow(footer, width));
	if (session.mcp?.length) rows.push(mcpRow(session.mcp, width));
	return { title: "session", color: palette.teal, rows };
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

/** The active task's row: the spinner and the bold title, entering at `entrance` (S54). */
function activeTaskRow(title: string, width: number, spinner?: number, entrance?: number): Row {
	const text = (rest: number) => {
		const cut = ellipsize(title, rest);
		return entering([{ text: cut, color: palette.text, bold: true }], palette.coral, entrance, bold(plainText(cut)));
	};
	return { text: item(fg(glyphColor(palette.pink, palette.coral, entrance), spinnerAt(spinner)), text, width), highlight: true };
}

/** One row per task, in list order (S26): /dock, and the rail while the list fits (S58). */
function taskRows(tasks: TodoTask[], width: number, spinner?: number, entrance?: number): Row[] {
	return tasks.map((task) => {
		if (task.state === "active") return activeTaskRow(task.title, width, spinner, entrance);
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
function railTaskRows(tasks: TodoTask[], width: number, spinner?: number, entrance?: number): Row[] {
	if (tasks.length <= RAIL_TASKS) return taskRows(tasks, width, spinner, entrance);
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
	rows.push(...taskRows(tasks.slice(start, end), width, spinner, entrance));
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

function todoSection(todo: TodoInfo, width: number, expanded = false, spinner?: number, compact = false): Section | undefined {
	if (todo.total <= 0) return undefined;
	const color = palette.coral;
	const right = fg(color, `${todo.done}/${todo.total}`);
	if (expanded && todo.tasks?.length) return { title: "todo", color, right, rows: taskRows(todo.tasks, width, spinner, todo.entrance) };
	if (!compact && todo.tasks?.length) {
		// S58: the listed rail keeps the progress bar, on the title before done/total.
		const cells = Math.min(todo.total, BAR_CELLS);
		const bar = meter(cells, Math.round((todo.done / todo.total) * cells), dim(color, 0.7), dim(color, 0.7));
		return { title: "todo", color, right: `${bar} ${right}`, rows: railTaskRows(todo.tasks, width, spinner, todo.entrance) };
	}
	// Fixed height (S7): done collapses to one row, then active, next and a summary.
	const rows: Row[] = [];
	if (todo.done > 0) {
		const cells = Math.min(todo.total, BAR_CELLS);
		const bar = meter(cells, Math.round((todo.done / todo.total) * cells), dim(color, 0.7), dim(color, 0.7));
		rows.push({ text: spread(`${fg(palette.green, "✓")} ${muted(`${todo.done} done`)}`, bar, width) });
	}
	if (todo.active) rows.push(activeTaskRow(todo.active, width, spinner, todo.entrance));
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
function rddSection(rdd: RddInfo | undefined, mode: FooterInfo["rdd"], width: number, spacers = true, spinner?: number, doneDetails = true): Section | undefined {
	const reviews = rdd?.reviews ?? [];
	if (reviews.length === 0 && !mode) return undefined;
	const right = mode === "on" ? bold(fg(palette.green, "on")) : mode === "off" ? bold(fg(palette.muted, "off")) : undefined;
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

function agentsSection(agents: AgentInfo[], width: number, spinner?: number, cap = LIST_CAP): Section | undefined {
	if (agents.length === 0) return undefined;
	const rows = agents.slice(0, cap).map((agent) => ({
		text: item(agentGlyph(agent.state, spinner, agent.entrance), (rest) => agentRow(agent, agentText(agent.name, agent.task, agent.entrance), "", rest), width),
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

function topBorder(section: Section, width: number): string {
	const frame = palette.frame;
	const title = (text: string) => bold(fg(section.color, text));
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

function drawSection(section: Section, width: number): string[] {
	const frame = palette.frame;
	const inner = width - 4;
	const side = fg(frame, "│");
	const body = section.rows.map((row) => {
		const text = padEnd(ellipsize(row.text, inner), inner);
		if (!row.highlight) return `${side} ${text} ${side}`;
		// Cut points end in a full reset; put the row background back after each.
		const lit = text.replaceAll(RESET, RESET + HIGHLIGHT);
		return `${side}${HIGHLIGHT}${fg(palette.pink, "▎")}${lit} \x1b[49m${side}`;
	});
	return [topBorder(section, width), ...body, fg(frame, `╰${"─".repeat(Math.max(0, width - 2))}╯`)];
}

function logoLines(width: number): string[] {
	const lines = renderLogo(width);
	const widest = Math.max(0, ...lines.map(visibleWidth));
	const indent = " ".repeat(Math.max(0, Math.min(2, width - widest)));
	return lines.map((line) => indent + line);
}

export interface PanelOptions {
	/** Every todo task instead of the fixed-height summary (S26); /dock only, the rail stays compact (S7). */
	todoExpanded?: boolean;
	/** /dock only (S35): every agent and changed file instead of the first 4. */
	listsExpanded?: boolean;
	/** /dock only (S52): every kept ODD step after the request settled, instead of the summary row. */
	oddExpanded?: boolean;
	/** Rows available on screen (S34, S38, S50, S52, S64, S77): the odd and rdd spacer rows and the muted CI lines, then changes, then an all-passed CI, then a CI that runs, waits or failed, then rdd with all but the latest odd step drop until the panel fits. No limit when absent. */
	maxRows?: number;
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

/** Full panel first, then one more part left out per step; the logo, session, heads-up, ODD, todo (even empty, S94) and agents never drop (S38, S52). */
const SHAPES: Shape[] = [
	{ spacers: true, oddDetails: true, rddDetails: true, ciDetails: true, changes: true, settledCi: true, ci: true, rdd: true },
	{ spacers: false, oddDetails: false, rddDetails: false, ciDetails: false, changes: true, settledCi: true, ci: true, rdd: true },
	{ spacers: false, oddDetails: false, rddDetails: false, ciDetails: false, changes: false, settledCi: true, ci: true, rdd: true },
	{ spacers: false, oddDetails: false, rddDetails: false, ciDetails: false, changes: false, settledCi: false, ci: true, rdd: true },
	{ spacers: false, oddDetails: false, rddDetails: false, ciDetails: false, changes: false, settledCi: false, ci: false, rdd: true },
	{ spacers: false, oddDetails: false, rddDetails: false, ciDetails: false, changes: false, settledCi: false, ci: false, rdd: false },
];

/** Every rail line for `model`, none wider than `width` visible columns. */
export function renderPanel(model: PanelModel, width: number, options: PanelOptions = {}): string[] {
	const columns = Math.max(0, Math.floor(width));
	if (columns === 0) return [];
	const inner = columns - 4;
	const unpushed = model.headsUp?.some((warning) => warning.kind === "unpushed") ?? false;
	// A check that runs, waits or failed keeps CI on screen longer (S77).
	const ciUrgent = ciLive(model.ci) || (model.ci?.checks.some((check) => check.state === "failed") ?? false);
	const draw = (shape: Shape) => {
		const sections = [
			sessionSection(model.session, inner, unpushed, model.footer),
			model.headsUp && headsUpSection(model.headsUp, inner),
			oddSection(model.odd, inner, shape.spacers, options.oddExpanded, !shape.rdd, shape.oddDetails),
			shape.rdd ? rddSection(model.rdd, model.footer?.rdd, inner, shape.spacers, model.spinner, shape.rddDetails) : undefined,
			(ciUrgent ? shape.ci : shape.settledCi) ? ciSection(model.ci, inner, shape.ciDetails, model.spinner) : undefined,
			model.agents && agentsSection(model.agents, inner, model.spinner, options.listsExpanded ? Infinity : LIST_CAP),
			(model.todo && todoSection(model.todo, inner, options.todoExpanded, model.spinner)) || emptyTodoSection(inner),
			shape.changes ? model.changes && changesSection(model.changes, inner, options.listsExpanded ? Infinity : LIST_CAP) : undefined,
		].filter((section): section is Section => section !== undefined);
		return [...logoLines(columns), ...sections.flatMap((section) => drawSection(section, columns))];
	};
	const limit = options.maxRows !== undefined && Number.isFinite(options.maxRows) ? Math.max(0, Math.floor(options.maxRows)) : Infinity;
	let lines: string[] = [];
	for (const shape of SHAPES) {
		lines = draw(shape);
		if (lines.length <= limit) break;
	}
	return lines.map((line) => truncateToWidth(line, columns));
}

/**
 * The panel's todo section alone, framed to `width` (S28): narrow screens show it
 * above the prompt. Compact, fixed height even with a task list (S7); [] without a todo.
 * `spinner` is the active row's frame (PanelModel.spinner).
 */
export function renderTodoCard(todo: TodoInfo | undefined, width: number, spinner?: number): string[] {
	const columns = Math.max(0, Math.floor(width));
	const section = columns > 0 && todo ? todoSection(todo, columns - 4, false, spinner, true) : undefined;
	if (!section) return [];
	return drawSection(section, columns).map((line) => truncateToWidth(line, columns));
}

/** Agent names past this many cells are cut, so the tasks keep one column. */
const AGENT_NAME_CAP = 12;

/**
 * The live agents alone, framed to `width` (S35): narrow screens show it
 * above the todo card. One row per running or waiting agent (the ones the
 * strip counts): spinner at frame `spinner` (the `!` of a waiting task, S87),
 * name, task and the time since `startedAt` at `now`, left out when the start
 * is unknown. Up to 4 rows, then `+N more`. Queued and finished agents are
 * not listed; [] when nothing runs.
 */
export function renderAgentsCard(agents: AgentInfo[] | undefined, width: number, spinner: number | undefined, now: number): string[] {
	const columns = Math.max(0, Math.floor(width));
	const running = (agents ?? []).filter(agentLive);
	if (columns === 0 || running.length === 0) return [];
	const inner = columns - 4;
	const shown = running.slice(0, LIST_CAP);
	const nameWidth = Math.min(AGENT_NAME_CAP, Math.max(...shown.map((agent) => visibleWidth(agent.name))));
	const rows: Row[] = shown.map((agent) => {
		const name = padEnd(ellipsize(agent.name, nameWidth), nameWidth);
		const time = agent.startedAt !== undefined && Number.isFinite(agent.startedAt) ? plainText(formatElapsed(now - agent.startedAt)) : "";
		return { text: item(agentGlyph(agent.state, spinner, agent.entrance), (rest) => agentRow(agent, agentText(name, agent.task, agent.entrance), time, rest), inner) };
	});
	const hidden = running.length - shown.length;
	if (hidden > 0) rows.push({ text: item(" ", (rest) => spread(muted(`+${hidden} more`), `${plainText("/dock")}${muted(" all")}`, rest), inner) });
	const section: Section = { title: "agents", color: palette.lilac, right: fg(palette.lilac, String(running.length)), rows };
	return drawSection(section, columns).map((line) => truncateToWidth(line, columns));
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
export function renderDock(model: PanelModel, width: number, height: number, offset = 0): DockView {
	const columns = Math.max(0, Math.floor(width));
	const rows = Math.max(0, Math.floor(height));
	if (columns === 0 || rows === 0) return { lines: [], offset: 0 };
	const inner = Math.max(0, Math.min(DOCK_MAX_WIDTH, columns - 2));
	const left = " ".repeat(Math.floor((columns - inner) / 2));
	const right = " ".repeat(columns - inner - left.length);
	const panel = inner > 0 ? renderPanel(model, inner, { todoExpanded: true, listsExpanded: true, oddExpanded: true }) : [];
	const body = panel.map((line) => left + padEnd(truncateToWidth(line, inner), inner) + right);
	// The top margin gives way first on a screen too short for it and two rows.
	const topRows = Math.min(DOCK_TOP_ROWS, Math.max(0, rows - 3));
	const room = rows - 1 - topRows;
	const last = Math.max(0, body.length - room);
	const at = Math.max(0, Math.min(last, Math.floor(Number.isFinite(offset) ? offset : 0)));
	const shown = body.slice(at, at + room);
	const hint = left + padEnd(spread(muted("Esc to close"), last > 0 ? muted("↑↓ scroll") : "", inner), inner) + right;
	const lines = [...Array<string>(topRows).fill(""), ...shown, ...Array<string>(room - shown.length).fill(""), hint];
	return { lines: lines.map((line) => boxed(truncateToWidth(line, columns), columns)), offset: at };
}

/** Cheap change key for the rail memo: any drawn value change changes it. */
export function panelDigest(model: PanelModel): string {
	return `fisi-dock/panel:${JSON.stringify(model)}`;
}
