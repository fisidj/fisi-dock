import { ellipsize, visibleWidth } from "./text.ts";

// What each ODD step is doing (S60, artboard 22 option C): every tool call the
// agent starts becomes an action; the active step shows its last one, a done
// step a summary of all of them. Built from the same tool_execution_start
// event that infers the phase, so nothing here is guessed from prose.

export interface OddAction {
	kind: "edit" | "write" | "read" | "search" | "run" | "agent";
	/** A path relative to the session folder, a search pattern, a command, or `agent · label`. */
	target: string;
}

/**
 * One muted line: `text`, then `tail`, which is never cut (` · 2 files`, S61).
 * `keepEnd` cuts the middle of `text` so a path's end stays visible.
 */
export interface OddDetail {
	text: string;
	keepEnd?: boolean;
	tail?: string;
}

/** One step's actions, kept small however many tools it runs. */
export interface StepActions {
	last: OddAction;
	/** Distinct edited paths, at most PATH_CAP; `editsPast` once another distinct one came. */
	edits: string[];
	editsPast?: boolean;
	/** Deepest folder shared by every edited path, "" when none. */
	editFolder?: string;
	reads: string[];
	readsPast?: boolean;
	searches: number;
	runs: number;
	lastRun?: string;
	lastAgent?: string;
}

/** Distinct paths kept per kind; past it a step says `256+ files` (S61). */
const PATH_CAP = 256;
const TARGET_CAP = 200;

const KIND_OF: Record<string, OddAction["kind"]> = {
	edit: "edit",
	write: "write",
	read: "read",
	grep: "search",
	find: "search",
	bash: "run",
	bash_background: "run",
	subagent_run: "agent",
};

function stringArg(args: unknown, key: string): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === "string" ? value : undefined;
}

// Tool arguments come from the model and reach the terminal as panel text, so
// the sequences a terminal would act on go (S61): OSC strings (titles,
// hyperlinks) and CSI/escape sequences first, then every C0/C1 control, DEL
// and bidi override that is left. Whitespace controls become spaces.
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
const ESCAPE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])?/g;
const WHITESPACE = /[\t\n\v\f\r]/g;
const CONTROL = /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Safe to print: escape sequences and control characters removed; CI names from gh use it too (S64). */
export function printable(text: string): string {
	return text.replace(OSC, "").replace(ESCAPE, "").replace(WHITESPACE, " ").replace(CONTROL, "");
}

/** First line, printable. */
const firstLine = (text: string) => printable(text.trim().split(/\r?\n/)[0]);

/** First line, printable, runs of spaces collapsed, bounded. */
function oneLine(text: string): string {
	return firstLine(text).replace(/\s+/g, " ").trim().slice(0, TARGET_CAP);
}

const slashes = (path: string) => path.replaceAll("\\", "/");
/** Windows drive (`E:/`) and UNC (`//server/share`) paths compare without case; POSIX paths do not (S61). */
const caseless = (path: string) => /^([A-Za-z]:\/|\/\/[^/])/.test(path);

function relativePath(path: string, cwd: string | undefined): string {
	const target = slashes(path.trim());
	if (!cwd) return target;
	const root = slashes(cwd.trim()).replace(/\/+$/, "");
	if (!root) return target;
	const prefix = `${root}/`;
	const inside = caseless(root) ? target.toLowerCase().startsWith(prefix.toLowerCase()) : target.startsWith(prefix);
	return inside ? target.slice(prefix.length) : target;
}

/** A leading `cd <dir> &&` only says where the command runs. */
function dropLeadingCd(command: string): string {
	return command.replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*&&\s*/, "");
}

/** The action a tool call stands for, or undefined for tools that do not touch the work (todo, phase reports, questions). */
export function oddAction(toolName: string, args: unknown, cwd?: string): OddAction | undefined {
	const kind = KIND_OF[toolName.replace(/^mcp__.+?__/, "")];
	if (!kind) return undefined;
	let target: string | undefined;
	if (kind === "edit" || kind === "write" || kind === "read") {
		const path = stringArg(args, "path") ?? stringArg(args, "file_path");
		// Relative first, bounded after: a long absolute path still loses its session folder.
		target = path && relativePath(firstLine(path), cwd);
	} else if (kind === "search") {
		target = stringArg(args, "pattern");
	} else if (kind === "run") {
		const command = stringArg(args, "command");
		target = command && dropLeadingCd(oneLine(command));
	} else {
		const agent = stringArg(args, "agent");
		const what = stringArg(args, "label") ?? stringArg(args, "task");
		const label = what && oneLine(what);
		target = agent && `${oneLine(agent).replace(/^gentle-ai-/, "")}${label ? ` · ${label}` : ""}`;
	}
	target = target && oneLine(target);
	return target ? { kind, target } : undefined;
}

/** The active step's line: what its last tool is doing. */
export function actionDetail(action: OddAction): OddDetail {
	switch (action.kind) {
		case "edit":
			return { text: `editing ${action.target}`, keepEnd: true };
		case "write":
			return { text: `writing ${action.target}`, keepEnd: true };
		case "read":
			return { text: `reading ${action.target}`, keepEnd: true };
		case "search":
			return { text: `searching "${action.target}"` };
		case "run":
			return { text: `running ${action.target}` };
		case "agent":
			return { text: action.target };
	}
}

const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");

function sharedFolder(a: string, b: string): string {
	const left = a.split("/");
	const right = b.split("/");
	let shared = 0;
	while (shared < left.length - 1 && shared < right.length - 1 && left[shared] === right[shared]) shared++;
	return shared === 0 ? "" : `${left.slice(0, shared).join("/")}/`;
}

/** `list` with `path` added while under the cap; `past` once a distinct path no longer fits. */
function remember(list: string[], past: boolean | undefined, path: string): { list: string[]; past?: boolean } {
	if (list.includes(path)) return { list, past };
	return list.length < PATH_CAP ? { list: [...list, path], past } : { list, past: true };
}

/** `acts` with `action` recorded; a new record when `acts` is undefined. */
export function addAction(acts: StepActions | undefined, action: OddAction): StepActions {
	const base: StepActions = acts ?? { last: action, edits: [], reads: [], searches: 0, runs: 0 };
	const next: StepActions = { ...base, last: action };
	if (action.kind === "edit" || action.kind === "write") {
		const { list, past } = remember(base.edits, base.editsPast, action.target);
		next.edits = list;
		if (past) next.editsPast = true;
		// Every edited path narrows the folder, kept or not, so it stays right past the cap.
		next.editFolder = base.edits.length === 0 ? folderOf(action.target) : sharedFolder(base.editFolder ?? "", action.target);
	} else if (action.kind === "read") {
		const { list, past } = remember(base.reads, base.readsPast, action.target);
		next.reads = list;
		if (past) next.readsPast = true;
	} else if (action.kind === "search") {
		next.searches = base.searches + 1;
	} else if (action.kind === "run") {
		next.runs = base.runs + 1;
		next.lastRun = action.target;
	} else {
		next.lastAgent = action.target;
	}
	return next;
}

/** `256 files`, or `256+ files` once distinct paths went past the cap. */
const files = (list: readonly string[], past: boolean | undefined) => `${list.length}${past ? "+" : ""} ${list.length === 1 && !past ? "file" : "files"}`;
const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/** A done step's line: edits first, then the last agent, then commands, then reads; undefined without actions. */
export function stepSummary(acts: StepActions | undefined): OddDetail | undefined {
	if (!acts) return undefined;
	const edited = acts.edits.length;
	if (edited === 1 && !acts.editsPast) return { text: `edited ${acts.edits[0]}`, keepEnd: true };
	if (edited > 1) {
		const count = files(acts.edits, acts.editsPast);
		return acts.editFolder ? { text: `edited ${acts.editFolder}`, keepEnd: true, tail: ` · ${count}` } : { text: `edited ${count}` };
	}
	if (acts.lastAgent) return { text: acts.lastAgent };
	if (acts.lastRun) return acts.runs > 1 ? { text: `ran ${acts.lastRun}`, tail: ` · +${acts.runs - 1} more` } : { text: `ran ${acts.lastRun}` };
	const read = acts.reads.length;
	if (read === 1 && !acts.readsPast && acts.searches === 0) return { text: `read ${acts.reads[0]}`, keepEnd: true };
	const parts = [read > 0 ? `read ${files(acts.reads, acts.readsPast)}` : "", acts.searches > 0 ? plural(acts.searches, "search", "searches") : ""].filter(Boolean);
	return parts.length > 0 ? { text: parts.join(" · ") } : undefined;
}

/** The whole line, uncut. */
export function detailText(detail: OddDetail): string {
	return `${detail.text}${detail.tail ?? ""}`;
}

/** Room `text` needs at least before its tail is worth keeping whole. */
const MIN_TEXT = 8;

/**
 * `detail` in at most `width` columns. The tail stays whole while `text` keeps
 * MIN_TEXT columns; then only `text` is cut. A `keepEnd` text keeps its first
 * word and its end, from a folder boundary when one fits (`editing …/tables/row.ts`);
 * any other text is cut at the end. Too narrow for that, the whole line is cut at the end.
 */
export function fitDetail(detail: OddDetail, width: number): string {
	const columns = Math.max(0, Math.floor(width));
	const whole = detailText(detail);
	if (visibleWidth(whole) <= columns) return whole;
	const tail = detail.tail ?? "";
	const room = columns - visibleWidth(tail);
	if (room < MIN_TEXT) return ellipsize(whole, columns);
	return fitText(detail.text, room, detail.keepEnd) + tail;
}

function fitText(text: string, width: number, keepEnd: boolean | undefined): string {
	if (visibleWidth(text) <= width) return text;
	const space = text.indexOf(" ");
	if (!keepEnd || space < 0) return ellipsize(text, width);
	const lead = `${text.slice(0, space + 1)}…`;
	const room = width - visibleWidth(lead);
	if (room < 4) return ellipsize(text, width);
	const chars = [...text.slice(space + 1)];
	let end = "";
	for (let index = chars.length - 1; index >= 0 && visibleWidth(chars[index] + end) <= room; index--) end = chars[index] + end;
	// Start at a folder boundary, unless that would leave only the slash.
	const slash = end.indexOf("/");
	return lead + (slash >= 0 && slash < end.length - 1 ? end.slice(slash) : end);
}
