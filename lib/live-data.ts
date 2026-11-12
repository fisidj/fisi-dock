import { ciRunning, ciView, type CiRuns } from "./ci.ts";
import { entranceSteps } from "./entrance.ts";
import { headsUpWarnings, type PlanInfo } from "./heads-up.ts";
import { SHIMMER_STEP_MS } from "./orbs.ts";
import type { AgentInfo, ChangeInfo, McpServerInfo, MemoryInfo, OddInfo, PanelModel, SessionInfo, SkillInfo, TodoInfo, TodoTask } from "./panel-model.ts";
import { rddLabel } from "./panel.ts";
import { rddLive, rddView, type RddRow } from "./rdd.ts";

// Pure mappers from the sources Fisi Dock reads (Pi context, session entries,
// Gentle Shell's pi.events payloads, git output) to the panel model. Gentle
// Shell's shapes are restated here, never imported: an update that changes them
// only makes a mapper return nothing, it cannot break module loading.

const record = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const count = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);

// --- session ---------------------------------------------------------------

export function projectName(cwd: string): string {
	const parts = cwd.split(/[\\/]+/).filter(Boolean);
	return parts.at(-1) ?? "";
}

/** `git rev-parse --abbrev-ref HEAD` output; a detached HEAD has no branch. */
export function parseBranch(stdout: string | undefined): string | undefined {
	const name = stdout?.trim();
	return name && name !== "HEAD" ? name : undefined;
}

/** `git rev-list --count @{upstream}..HEAD` output; anything but a count means no upstream. */
export function parseAhead(stdout: string | undefined): number | undefined {
	const text = stdout?.trim() ?? "";
	return /^\d+$/.test(text) ? Number(text) : undefined;
}

/** Pi's ContextUsage: tokens and percent are null right after compaction. */
export function sessionUsage(usage: { tokens: number | null; contextWindow: number; percent: number | null } | undefined): Pick<SessionInfo, "contextPercent" | "tokensUsed" | "tokensMax"> {
	const value = record(usage);
	const percent = count(value?.percent);
	const tokens = count(value?.tokens);
	const window = count(value?.contextWindow);
	if (percent === undefined) return {};
	return { contextPercent: percent, ...(tokens !== undefined && window ? { tokensUsed: tokens, tokensMax: window } : {}) };
}

/** Same rule as Gentle Shell's sessionCost: the sum of assistant message costs. */
export function sessionCost(entries: readonly unknown[]): number {
	let total = 0;
	for (const entry of Array.isArray(entries) ? entries : []) {
		const message = record(record(entry)?.message);
		if (record(entry)?.type !== "message" || message?.role !== "assistant") continue;
		total += count(record(record(message.usage)?.cost)?.total) ?? 0;
	}
	// Float sums drift (0.0125 + 0.002); the footer shows three decimals anyway.
	return Math.round(total * 1e9) / 1e9;
}

/** Tokens of the same assistant messages (S37): usage.totalTokens, else its four parts. */
export function sessionTokens(entries: readonly unknown[]): number {
	let total = 0;
	for (const entry of Array.isArray(entries) ? entries : []) {
		const message = record(record(entry)?.message);
		if (record(entry)?.type !== "message" || message?.role !== "assistant") continue;
		const usage = record(message.usage);
		total += count(usage?.totalTokens) ?? ["input", "output", "cacheRead", "cacheWrite"].reduce((sum, key) => sum + (count(usage?.[key]) ?? 0), 0);
	}
	return total;
}

// --- todo ------------------------------------------------------------------

export interface TodoTaskLike {
	id?: number;
	title: string;
	status: string;
}

export interface TodoStateLike {
	tasks: TodoTaskLike[];
}

const TODO_TOOL = "todo";
const TODO_DETAILS_KEY = "gentleTodo";

function todoState(value: unknown): TodoStateLike | undefined {
	const tasks = record(value)?.tasks;
	return Array.isArray(tasks) ? { tasks: tasks as TodoTaskLike[] } : undefined;
}

/** Gentle Todo's replay rule: the last successful `todo` tool result on the branch. */
export function todoStateFromEntries(entries: readonly unknown[]): TodoStateLike | undefined {
	let state: TodoStateLike | undefined;
	for (const entry of Array.isArray(entries) ? entries : []) {
		const message = record(record(entry)?.message);
		if (record(entry)?.type !== "message" || message?.role !== "toolResult" || message.toolName !== TODO_TOOL || message.isError === true) continue;
		state = todoState(record(message.details)?.[TODO_DETAILS_KEY]) ?? state;
	}
	return state;
}

/** Pi's tool_execution_end for Gentle Todo carries the full snapshot in details. */
export function todoStateFromToolEnd(event: { toolName?: string; isError?: boolean; result?: unknown }): TodoStateLike | undefined {
	if (event?.toolName !== TODO_TOOL || event.isError) return undefined;
	return todoState(record(record(event.result)?.details)?.[TODO_DETAILS_KEY]);
}

const TASK_STATES: Record<string, TodoTask["state"]> = { done: "done", in_progress: "active", blocked: "blocked", dropped: "dropped" };

export function todoFromState(state: TodoStateLike | undefined): TodoInfo | undefined {
	const tasks = (todoState(state)?.tasks ?? []).filter((task) => record(task) && typeof task.title === "string");
	if (tasks.length === 0) return undefined;
	const done = tasks.filter((task) => task.status === "done").length;
	const open = tasks.filter((task) => task.status !== "done" && task.status !== "dropped").length;
	const active = tasks.find((task) => task.status === "in_progress")?.title;
	const next = tasks.find((task) => task.status === "pending")?.title;
	const shown = (active !== undefined ? 1 : 0) + (next !== undefined ? 1 : 0);
	const list = tasks.map((task) => ({ title: task.title, state: (Object.hasOwn(TASK_STATES, task.status) && TASK_STATES[task.status]) || "pending" }));
	return { done, total: tasks.length, ...(active !== undefined ? { active } : {}), ...(next !== undefined ? { next } : {}), more: Math.max(0, open - shown), tasks: list };
}

/**
 * Gentle Todo's progress event ({ sessionId, done, total, current }) arrives
 * before the tool result. It moves the counts and the active task right away;
 * the full snapshot from the tool result follows. Other sessions and malformed
 * payloads leave `previous` as it is. The event has no titles: the task list
 * stays only while its counts and active task still match, never guessed.
 */
export function todoFromProgress(event: unknown, sessionId: string, previous: TodoInfo | undefined): TodoInfo | undefined {
	const value = record(event);
	const done = count(value?.done);
	const total = count(value?.total);
	if (!value || value.sessionId !== sessionId || done === undefined || total === undefined) return previous;
	if (total === 0) return undefined;
	const active = typeof value.current === "string" && value.current ? value.current : undefined;
	const next = previous?.next !== undefined && previous.next !== active ? previous.next : undefined;
	const shown = (active !== undefined ? 1 : 0) + (next !== undefined ? 1 : 0);
	const list = previous?.tasks;
	const same = list !== undefined && list.length === total && list.filter((task) => task.state === "done").length === done && list.find((task) => task.state === "active")?.title === active;
	return { done, total, ...(active !== undefined ? { active } : {}), ...(next !== undefined ? { next } : {}), more: Math.max(0, total - done - shown), ...(same ? { tasks: list } : {}) };
}

// --- Gentle Shell events -----------------------------------------------------

function forSession(event: unknown, sessionId: string): Record<string, unknown> | undefined {
	const value = record(event);
	return value && value.sessionId === sessionId ? record(value.snapshot) : undefined;
}

/**
 * `gentle-ai:jobs-sidebar` ({ sessionId, snapshot: { jobs } }) to agent rows.
 * Undefined means "not for us or malformed": keep what is shown.
 */
export function agentsFromJobs(event: unknown, sessionId: string): AgentInfo[] | undefined {
	const jobs = forSession(event, sessionId)?.jobs;
	if (!Array.isArray(jobs)) return undefined;
	const valid = jobs.every((job) => {
		const value = record(job);
		return value && typeof value.id === "string" && value.id.length > 0 && typeof value.label === "string";
	});
	if (!valid) return undefined;
	return jobs.map((job: { id: string; label: string; startedAt?: unknown; status?: unknown }) => ({
		name: job.id,
		task: job.label,
		// 4.5.0 adds finished tails: exited/stopped are done, failed is failed.
		state: job.status === undefined ? "running" : job.status === "failed" ? "failed" : "done",
		...(typeof job.startedAt === "number" && Number.isFinite(job.startedAt) ? { startedAt: job.startedAt } : {}),
	}));
}

// Gentle Shell's REVIEW_SIDEBAR_LABELS (lib/review-sidebar-state.ts), minus
// "unknown", which says nothing worth a footer slot.
const REVIEW_LABELS: Record<string, string> = {
	reviewing: "Reviewers running…",
	in_review: "Review in progress",
	checking: "Updating…",
	approved: "Approved · finalizing…",
	closed: "✓ Approved",
	correction: "Fixing findings…",
	declined: "Skipped for this change",
	invalidated: "Outdated · code changed",
	unavailable: "Review unavailable",
	ready: "Not reviewed yet",
	consent: "Needs your consent",
	forecast: "Preparing reviewers…",
};

/**
 * `gentle-ai:review-sidebar` to footer text. Undefined: not for this session,
 * keep the current text. Null: ours, but nothing to show.
 */
export function reviewText(event: unknown, sessionId: string): string | null | undefined {
	const snapshot = forSession(event, sessionId);
	if (!snapshot) return undefined;
	const state = snapshot.state;
	return typeof state === "string" && Object.hasOwn(REVIEW_LABELS, state) ? REVIEW_LABELS[state] : null;
}

// --- git -------------------------------------------------------------------

function changeStatus(code: string): ChangeInfo["status"] | undefined {
	if (code === "??") return "?";
	if (code === "!!") return undefined;
	if (code.includes("R")) return "R";
	if (code.includes("D")) return "D";
	if (code[0] === "A" || code[0] === "C") return "A";
	return "M";
}

/**
 * `git status --porcelain=v1 -z` and `git diff --numstat -z HEAD` to changes.
 * The -z forms keep spaces and non-ASCII in paths unquoted. Untracked and
 * binary files count 0 lines.
 */
export function parseGitChanges(status: string, numstat: string): ChangeInfo[] {
	const lines = new Map<string, { added: number; removed: number }>();
	const stats = numstat.split("\0");
	for (let index = 0; index < stats.length; index++) {
		const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(stats[index]);
		if (!match) continue;
		let path = match[3];
		// A rename leaves the path empty and lists old then new as the next fields.
		if (path === "") {
			path = stats[index + 2] ?? "";
			index += 2;
		}
		const added = match[1] === "-" ? 0 : Number(match[1]);
		const removed = match[2] === "-" ? 0 : Number(match[2]);
		if (path) lines.set(path, { added, removed });
	}
	const changes: ChangeInfo[] = [];
	const fields = status.split("\0");
	for (let index = 0; index < fields.length; index++) {
		const field = fields[index];
		if (field.length < 4) continue;
		const code = field.slice(0, 2);
		const path = field.slice(3);
		// Renames and copies carry the original path as the next field.
		if (code.includes("R") || code.includes("C")) index++;
		const kind = changeStatus(code);
		if (!kind) continue;
		changes.push({ status: kind, path, ...(lines.get(path) ?? { added: 0, removed: 0 }) });
	}
	return changes;
}

// --- model -----------------------------------------------------------------

export interface LiveParts {
	project: string;
	/** The RDD switch for the session folder (S85), from `gentle-ai review mode status`; undefined until read. */
	rdd?: "on" | "off";
	branch?: string;
	ahead?: number;
	usage?: Pick<SessionInfo, "contextPercent" | "tokensUsed" | "tokensMax">;
	/** Gentle Shell's agent-model profile label (S99), from lib/profile.ts readSessionProfile. */
	profile?: string;
	todo?: TodoInfo;
	odd?: OddInfo;
	agents?: AgentInfo[];
	changes?: ChangeInfo[];
	/** Heads-up sources (S14). */
	worktrees?: string[];
	unmerged?: string[];
	plans?: PlanInfo[];
	/** True from agent_settled until the next request starts. */
	runSettled?: boolean;
	/** Undefined until the session entries were read once. */
	cost?: number;
	/** Session tokens and their API-price estimate (S37), shown while the cost is 0. */
	tokens?: number;
	estimate?: number;
	review?: string;
	/** The session's RDD reviews (S50), from lib/rdd.ts reduceReviews. */
	reviews?: RddRow[];
	/** CI runs of the branch's last pushed commit (S64), from lib/ci.ts readCi; undefined: no section. */
	ci?: CiRuns;
	/** Configured MCP servers and their state (S32); [] without MCP config, undefined until the config was read. */
	mcp?: McpServerInfo[];
	/** Engram from gentle-engram's mem_* tools and calls (lib/memory.ts); undefined while Pi's tool list cannot be read. */
	memory?: MemoryInfo;
	/** The skills Pi loaded (skills-view S4, lib/skills.ts); undefined while Pi's command list cannot be read. */
	skills?: SkillInfo[];
	/** /skills unfolded the skills row (S2). */
	skillsOpen?: boolean;
	/** The running spinner's frame from the wall clock (S31); drawn only while something runs. */
	spinner?: number;
}

/**
 * True while the panel draws a running spinner (S31): a running agent, an
 * active todo task while a run is active, or a review that runs or waits for
 * the user (S50; its m:ss ticks with the spinner), or a running CI check
 * (S64, the same). A task left in progress after the run settled shows the
 * still frame (L61).
 */
export function runsSpinner(model: PanelModel, runActive = true): boolean {
	const todo = model.todo;
	const activeTask = runActive && todo !== undefined && todo.total > 0 && (todo.active !== undefined || (todo.tasks?.some((task) => task.state === "active") ?? false));
	return activeTask || (model.agents?.some((agent) => agent.state === "running") ?? false) || rddLive(model.rdd) || ciRunning(model.ci);
}

// --- row entrance (S54) -----------------------------------------------------

/** A row that plays the entrance when it appears: its identity, the text the shine crosses and, for agents, its start. */
export interface EntranceRow {
	key: string;
	text: string;
	startedAt?: number;
}

/** The agents card pads names to this many cells (panel.ts AGENT_NAME_CAP), so the shine crosses the padding too. */
const AGENT_NAME_CELLS = 12;

const agentRow = (key: string, agent: AgentInfo): EntranceRow => ({
	key,
	text: `${agent.name.padEnd(AGENT_NAME_CELLS)} ${agent.task}`,
	...(agent.startedAt !== undefined ? { startedAt: agent.startedAt } : {}),
});

const oddKey = (odd: OddInfo, index: number) => `odd:${Math.max(0, Math.floor(odd.earlier ?? 0)) + index}:${odd.steps[index].phase}`;

/**
 * Rows that enter when they appear (S54): running agents (jobs by name, as
 * their start times), the active todo task, the active ODD step and every RDD
 * review. Changes, heads-up, the strip and the header never do.
 */
export function entranceRows(parts: LiveParts): EntranceRow[] {
	const rows: EntranceRow[] = [];
	for (const agent of parts.agents ?? []) if (agent.state === "running") rows.push(agentRow(`job:${agent.id ?? agent.name}`, agent));
	if (parts.todo?.active !== undefined) rows.push({ key: `todo:${parts.todo.active}`, text: parts.todo.active });
	const odd = parts.odd;
	odd?.steps.forEach((step, index) => {
		if (step.state === "active" && !odd.settled) rows.push({ key: oddKey(odd, index), text: step.phase });
	});
	(parts.reviews ?? []).forEach((review, index) => rows.push({ key: `rdd:${index}:${review.startedAt}`, text: `${review.scope} ${rddLabel(review.status)}` }));
	return rows;
}

/** The entrance step at `now` of a row that appeared at `at`; undefined once it is over. */
function entranceAt(at: number | undefined, text: string, now: number): number | undefined {
	if (at === undefined || !Number.isFinite(at)) return undefined;
	const step = Math.max(0, Math.floor((now - at) / SHIMMER_STEP_MS));
	return step < entranceSteps(text) ? step : undefined;
}

/** True while any row plays its entrance: a clock keeps repainting at the entrance step. */
export function hasEntrance(model: PanelModel): boolean {
	return (
		model.todo?.entrance !== undefined ||
		(model.agents?.some((agent) => agent.entrance !== undefined) ?? false) ||
		(model.odd?.steps.some((step) => step.entrance !== undefined) ?? false) ||
		(model.rdd?.reviews.some((review) => review.entrance !== undefined) ?? false)
	);
}

/** `parts` with each entering row's step at `now`, from when it appeared (`appeared`, by entranceRows key). */
function withEntrances(parts: LiveParts, now: number, appeared: ReadonlyMap<string, number>): LiveParts {
	if (appeared.size === 0) return parts;
	const step = (row: EntranceRow) => entranceAt(appeared.get(row.key), row.text, now);
	const agents = <T extends AgentInfo & { id?: string }>(list: T[] | undefined, key: (agent: T) => string): T[] | undefined =>
		list?.map((agent) => {
			const at = agent.state === "running" ? step(agentRow(key(agent), agent)) : undefined;
			return at === undefined ? agent : { ...agent, entrance: at };
		});
	const todoStep = parts.todo?.active !== undefined ? step({ key: `todo:${parts.todo.active}`, text: parts.todo.active }) : undefined;
	const odd = parts.odd;
	return {
		...parts,
		agents: agents(parts.agents, (agent) => `job:${agent.id ?? agent.name}`),
		todo: todoStep === undefined ? parts.todo : { ...parts.todo!, entrance: todoStep },
		odd: odd && {
			...odd,
			steps: odd.steps.map((entry, index) => {
				const at = entry.state === "active" && !odd.settled ? step({ key: oddKey(odd, index), text: entry.phase }) : undefined;
				return at === undefined ? entry : { ...entry, entrance: at };
			}),
		},
	};
}

/**
 * The panel model for the live parts; `now` times the running reviews and the
 * entrances of the rows in `appeared` (S54: entranceRows key -> epoch ms it appeared).
 */
export function sessionSnapshot(parts: LiveParts, now: number = Date.now(), appeared: ReadonlyMap<string, number> = new Map()): PanelModel {
	const model = snapshotOf(withEntrances(parts, now, appeared), now);
	if (!model.rdd || appeared.size === 0) return model;
	const reviews = model.rdd.reviews.map((review, index) => {
		const row = parts.reviews![index];
		const at = entranceAt(appeared.get(`rdd:${index}:${row.startedAt}`), `${row.scope} ${rddLabel(row.status)}`, now);
		return at === undefined ? review : { ...review, entrance: at };
	});
	return { ...model, rdd: { reviews } };
}

function snapshotOf(parts: LiveParts, now: number): PanelModel {
	const session: SessionInfo = {
		project: parts.project,
		...(parts.branch !== undefined ? { branch: parts.branch } : {}),
		...(parts.ahead !== undefined ? { ahead: parts.ahead } : {}),
		...parts.usage,
		...(parts.profile ? { profile: parts.profile } : {}),
		...(parts.mcp ? { mcp: parts.mcp } : {}),
		...(parts.memory ? { memory: parts.memory } : {}),
		...(parts.skills ? { skills: { list: parts.skills, ...(parts.skillsOpen ? { open: true } : {}) } } : {}),
	};
	const todo = parts.todo;
	const openTodo = todo ? todo.more + (todo.active !== undefined ? 1 : 0) + (todo.next !== undefined ? 1 : 0) : 0;
	const headsUp = headsUpWarnings({
		worktrees: parts.worktrees,
		todoLeft: parts.runSettled ? openTodo : 0,
		ahead: parts.ahead,
		unmerged: parts.unmerged,
		plans: parts.plans,
	});
	// Gentle Shell's background jobs; the renderer caps the rows.
	const agents = parts.agents;
	const rdd = rddView(parts.reviews, now);
	const ci = ciView(parts.ci, now);
	const model: PanelModel = {
		session,
		...(headsUp.length > 0 ? { headsUp } : {}),
		...(parts.todo ? { todo: parts.todo } : {}),
		...(parts.odd && parts.odd.steps.length > 0 ? { odd: parts.odd } : {}),
		...(agents ? { agents } : {}),
		...(parts.changes ? { changes: parts.changes } : {}),
		...(rdd ? { rdd } : {}),
		...(ci ? { ci } : {}),
		...(parts.cost !== undefined ? { footer: { cost: parts.cost, ...(parts.tokens ? { tokens: parts.tokens } : {}), ...(parts.tokens && parts.estimate !== undefined ? { estimate: parts.estimate } : {}), ...(parts.review ? { review: parts.review } : {}), ...(parts.rdd ? { rdd: parts.rdd } : {}) } } : {}),
	};
	// Only a drawn spinner carries its frame, so an idle panel's digest never ticks.
	return parts.spinner !== undefined && runsSpinner(model, parts.runSettled === false) ? { ...model, spinner: parts.spinner } : model;
}
