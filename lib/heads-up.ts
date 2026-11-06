import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { GitExec } from "./live-store.ts";
import type { HeadsUpWarning } from "./panel-model.ts";

// Heads-up (S14): things left open in the project. Pure parsers for git output
// and ODD feature documents, plus failure-tolerant readers: a source that
// cannot be read is simply absent, it never raises.

// --- worktrees ---------------------------------------------------------------

/** Forward slashes, no trailing slash; Windows drive paths compare case-insensitively. */
function normalizePath(path: string): string {
	const slashed = path.trim().replaceAll("\\", "/").replace(/\/+$/, "");
	return /^[a-z]:\//i.test(slashed) ? slashed.toLowerCase() : slashed;
}

/**
 * `git worktree list --porcelain` to the worktrees other than the session's:
 * bare and prunable entries are skipped, and the session's own worktree is
 * the one with the longest path containing `cwd`.
 */
export function otherWorktrees(porcelain: string | undefined, cwd: string): string[] {
	const entries: { path: string; usable: boolean }[] = [];
	for (const block of (porcelain ?? "").split(/\r?\n\r?\n/)) {
		const lines = block.split(/\r?\n/);
		const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
		if (!path) continue;
		const usable = !lines.some((line) => line === "bare" || line === "prunable" || line.startsWith("prunable "));
		entries.push({ path, usable });
	}
	const here = normalizePath(cwd);
	const contains = (path: string) => here === normalizePath(path) || here.startsWith(`${normalizePath(path)}/`);
	const current = entries
		.filter((entry) => contains(entry.path))
		.toSorted((a, b) => normalizePath(b.path).length - normalizePath(a.path).length)[0];
	return entries.filter((entry) => entry.usable && entry !== current).map((entry) => entry.path);
}

// --- branches ----------------------------------------------------------------

/** `git branch --format=%(refname:short)` lines, without the current branch and detached entries. */
export function parseBranchList(stdout: string | undefined, current: string | undefined): string[] {
	return (stdout ?? "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((name) => name && !name.startsWith("(") && name !== current);
}

/** origin/HEAD's branch (`refs/remotes/origin/main` → `main`), else main, else master. */
export function defaultBranchFrom(symbolicRef: string | undefined, hasMain: boolean, hasMaster: boolean): string | undefined {
	const remote = symbolicRef?.trim().replace(/^refs\/remotes\//, "").replace(/^origin\//, "");
	if (remote) return remote;
	if (hasMain) return "main";
	return hasMaster ? "master" : undefined;
}

// --- ODD feature documents -----------------------------------------------------

/*
 * Detection rule for unfinished ODD plans (checked against this repo's
 * odd/tasks/fisi-dock.md and Gentle Shell's own odd/tasks/*.md):
 *
 * - The plan is the `## Tasks…` section (a level-2 heading starting with
 *   "Tasks", e.g. "## Tasks" or "## Tasks and routing"), up to the next
 *   level-1 or level-2 heading. A file without it is ignored.
 * - A task is a top-level list item (no indentation) that is a checkbox
 *   (`- [ ] …`, `- [x] …`) or starts with a task ID (`- T3 …`). Indented
 *   sub-steps and other lists (e.g. `- C1 …` commit units) are not tasks.
 * - Checkbox tasks: `[x]` is done, `[ ]` is open, whatever the text says.
 * - Other tasks, first match wins: a done word (done, complete, completed,
 *   dropped, cancelled) means done; a pending word (pending, in progress,
 *   blocked, reopened) means open, so "Commit: pending" is open; a recorded
 *   commit hash ("Commit: 4620955", "commit `bb9b3a258`") means done.
 *   Anything else is open.
 * - A section with no task lines at all is ignored too.
 */

const TASK_SECTION = /^##\s+tasks\b/i;
const NEXT_SECTION = /^#{1,2}\s/;
const CHECKBOX = /^[-*]\s+\[([ xX])\]/;
const TASK_ID = /^[-*]\s+T\d+[a-z]?\b/;
const DONE_WORD = /\b(done|complete|completed|dropped|cancell?ed)\b/i;
const PENDING_WORD = /\b(pending|in[_ ]progress|blocked|reopened)\b/i;
const COMMIT_HASH = /\bcommits?\b[:\s`(]*[0-9a-f]{7,40}\b/i;

/** "done" or "open" for a task line of a `## Tasks` section; undefined when the line is not a task. */
export function classifyTaskLine(line: string): "done" | "open" | undefined {
	const box = CHECKBOX.exec(line);
	if (box) return box[1] === " " ? "open" : "done";
	if (!TASK_ID.test(line)) return undefined;
	if (DONE_WORD.test(line)) return "done";
	if (PENDING_WORD.test(line)) return "open";
	return COMMIT_HASH.test(line) ? "done" : "open";
}

/** Open tasks of one feature document; undefined when it has no recognizable tasks. */
export function countOpenTasks(markdown: string): number | undefined {
	let inTasks = false;
	let tasks = 0;
	let open = 0;
	for (const line of markdown.split(/\r?\n/)) {
		if (TASK_SECTION.test(line)) {
			inTasks = true;
			continue;
		}
		if (NEXT_SECTION.test(line)) inTasks = false;
		if (!inTasks) continue;
		const state = classifyTaskLine(line);
		if (!state) continue;
		tasks++;
		if (state === "open") open++;
	}
	return tasks > 0 ? open : undefined;
}

export interface PlanInfo {
	/** Feature document name without `.md`. */
	name: string;
	open: number;
}

/** Read-only file access for the plan scan; the default reads the disk. */
export interface PlanFiles {
	list(dir: string): Promise<string[]>;
	size(path: string): Promise<number>;
	read(path: string): Promise<string>;
}

const diskFiles: PlanFiles = {
	list: (dir) => readdir(dir),
	size: async (path) => (await stat(path)).size,
	read: (path) => readFile(path, "utf8"),
};

const MAX_PLAN_BYTES = 200 * 1024;

/** Plans in `<cwd>/odd/tasks` with open tasks, by name; undefined when there is no such folder. */
export async function readOddPlans(cwd: string, files: PlanFiles = diskFiles): Promise<PlanInfo[] | undefined> {
	if (!cwd) return undefined;
	const dir = join(cwd, "odd", "tasks");
	let names: string[];
	try {
		names = await files.list(dir);
	} catch {
		return undefined;
	}
	const plans: PlanInfo[] = [];
	for (const name of names.filter((entry) => entry.endsWith(".md")).toSorted()) {
		try {
			const path = join(dir, name);
			if ((await files.size(path)) > MAX_PLAN_BYTES) continue;
			const open = countOpenTasks(await files.read(path));
			if (open) plans.push({ name: name.slice(0, -".md".length), open });
		} catch {
			// An unreadable file is left out.
		}
	}
	return plans;
}

// --- git reader --------------------------------------------------------------

async function gitOutput(exec: GitExec, args: string[]): Promise<string | undefined> {
	try {
		const result = await exec(args);
		return result.code === 0 ? result.stdout : undefined;
	} catch {
		return undefined;
	}
}

/** Other worktrees and local branches not merged into the default branch; each omitted when unreadable. */
export async function readHeadsUpGit(exec: GitExec, cwd: string, branch: string | undefined): Promise<{ worktrees?: string[]; unmerged?: string[] }> {
	const porcelain = await gitOutput(exec, ["worktree", "list", "--porcelain"]);
	// Not a repository (or no git): skip the rest.
	if (porcelain === undefined) return { worktrees: undefined, unmerged: undefined };
	const worktrees = otherWorktrees(porcelain, cwd);
	const exists = async (ref: string) => (await gitOutput(exec, ["rev-parse", "--verify", "--quiet", ref])) !== undefined;
	const symbolicRef = await gitOutput(exec, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
	let target = defaultBranchFrom(symbolicRef, false, false);
	if (target === undefined) {
		const hasMain = await exists("refs/heads/main");
		target = defaultBranchFrom(undefined, hasMain, !hasMain && (await exists("refs/heads/master")));
	}
	const list = target === undefined ? undefined : await gitOutput(exec, ["branch", "--format=%(refname:short)", "--no-merged", target]);
	return { worktrees, unmerged: list === undefined ? undefined : parseBranchList(list, branch) };
}

// --- warnings ----------------------------------------------------------------

export interface HeadsUpInput {
	worktrees?: string[];
	/** Open todo tasks once the run settled; 0 while a run is going. */
	todoLeft?: number;
	ahead?: number;
	unmerged?: string[];
	plans?: PlanInfo[];
}

const folderName = (path: string) => path.split(/[\\/]+/).filter(Boolean).at(-1) ?? path;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The heads-up rows, counts first. Plans come last: there can be many, and the
 * renderer collapses whatever passes its cap, so the unpushed warning (which
 * replaces the session row's ↑N, S8) always stays visible.
 */
export function headsUpWarnings(input: HeadsUpInput): HeadsUpWarning[] {
	const warnings: HeadsUpWarning[] = [];
	const worktrees = input.worktrees ?? [];
	if (worktrees.length === 1) warnings.push({ kind: "worktrees", text: `worktree open: ${folderName(worktrees[0])}` });
	else if (worktrees.length > 1) warnings.push({ kind: "worktrees", text: `${worktrees.length} worktrees open` });
	if (input.todoLeft && input.todoLeft > 0) warnings.push({ kind: "todo", text: `${plural(input.todoLeft, "todo task", "todo tasks")} left` });
	if (input.ahead && input.ahead > 0) warnings.push({ kind: "unpushed", text: `${plural(input.ahead, "commit", "commits")} not pushed` });
	const unmerged = input.unmerged ?? [];
	if (unmerged.length === 1) warnings.push({ kind: "branches", text: `branch not merged: ${unmerged[0]}` });
	else if (unmerged.length > 1) warnings.push({ kind: "branches", text: `${unmerged.length} branches not merged` });
	for (const plan of input.plans ?? []) {
		if (plan.open > 0) warnings.push({ kind: "plan", text: `ODD plan ${plan.name}: ${plan.open} open` });
	}
	return warnings;
}
