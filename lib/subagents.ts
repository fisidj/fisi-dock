import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { printable } from "./odd-detail.ts";
import type { AgentInfo } from "./panel-model.ts";

// Gentle Shell 4.6.0's subagent tasks (its `subagent_*` tools, extensions/
// gentle-agents.ts) as agent rows (S87). The task store is private to that
// extension, so Fisi Dock reads what reaches it: the status events it
// publishes on pi.events, the arguments and results of the tool calls, and,
// once at session start, the presence activity file it writes for the
// session. Its shapes are restated here, never imported.

/** `gentle-pi:notification:source` (lib/notification-events.ts): `{ source: "subagent", sessionId, parentSessionId, taskId, status, sequence, … }`. */
export const NOTIFICATION_SOURCE_EVENT = "gentle-pi:notification:source";
/** Finished tasks stay this long, the tail of Gentle Shell's finished jobs (lib/jobs-widget.ts JOBS_FINISHED_TTL_MS). */
export const SUBAGENT_FINISHED_TTL_MS = 60_000;

const RUN_TOOL = "subagent_run";
const CONTINUE_TOOL = "subagent_continue";
/** Unmatched calls kept at most; the oldest gives way. */
const PENDING_CAP = 32;
const NAME_CAP = 32;
const TASK_CAP = 120;
const MODEL_CAP = 64;
/** A presence activity file past this size is not read (Gentle Shell marks such files `activity-too-large`). */
const ACTIVITY_SIZE_CAP = 8 * 1024 * 1024;

const TASK_STATUSES = ["queued", "running", "waiting", "completed", "failed", "cancelled", "timed_out"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
const FINISHED = new Set<TaskStatus>(["completed", "failed", "cancelled", "timed_out"]);
const AGENT_STATE: Record<TaskStatus, AgentInfo["state"]> = {
	queued: "queued",
	running: "running",
	waiting: "waiting",
	completed: "done",
	failed: "failed",
	cancelled: "failed",
	timed_out: "failed",
};

const record = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const isStatus = (value: unknown): value is TaskStatus => typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);

/** Model-provided text as one printable, bounded line (S61 rule): escapes, controls and bidi overrides go, whitespace collapses. */
function clean(value: unknown, cap: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = printable(value).replace(/\s+/g, " ").trim().slice(0, cap);
	return text || undefined;
}

const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;

// --- sources ---------------------------------------------------------------

export interface SubagentStatus {
	taskId: string;
	status: TaskStatus;
	sequence: number;
}

/** A subagent status event of this session; undefined for anything else. */
export function subagentStatus(event: unknown, sessionId: string): SubagentStatus | undefined {
	const value = record(event);
	if (!value || value.source !== "subagent" || value.sessionId !== sessionId || value.parentSessionId !== sessionId) return undefined;
	if (!identity(value.taskId) || !isStatus(value.status) || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) return undefined;
	return { taskId: value.taskId, status: value.status, sequence: value.sequence as number };
}

export interface SubagentCall {
	/** subagent_continue only: the task it continues. */
	taskId?: string;
	/** subagent_run only: the agent name. */
	agent?: string;
	/** The task text (run) or the prompt (continue). */
	text?: string;
	label?: string;
	mode?: string;
}

/** The arguments of a `subagent_run` or `subagent_continue` call; undefined for other tools or malformed args. */
export function subagentCall(toolName: unknown, args: unknown): SubagentCall | undefined {
	const value = record(args);
	if (!value) return undefined;
	const optional = (key: string): Record<string, string> => (typeof value[key] === "string" ? { [key]: value[key] as string } : {});
	if (toolName === RUN_TOOL) {
		if (typeof value.agent !== "string" || typeof value.task !== "string") return undefined;
		return { agent: value.agent, text: value.task, ...optional("label"), ...optional("mode") };
	}
	if (toolName === CONTINUE_TOOL) {
		if (typeof value.task_id !== "string") return undefined;
		return { taskId: value.task_id, ...(typeof value.prompt === "string" ? { text: value.prompt } : {}), ...optional("label"), ...optional("mode") };
	}
	return undefined;
}

export interface SubagentDetails {
	taskId: string;
	agent?: string;
	label?: string;
	status?: TaskStatus;
	mode?: string;
	model?: string;
	effort?: string;
	lastStep?: string;
}

/** `details.gentleAgents` of a `subagent_run` / `subagent_continue` result (gentle-agents.ts taskDetails); undefined without a task id. */
export function subagentResult(toolName: unknown, result: unknown): SubagentDetails | undefined {
	if (toolName !== RUN_TOOL && toolName !== CONTINUE_TOOL) return undefined;
	const details = record(record(record(result)?.details)?.gentleAgents);
	if (!details || !identity(details.taskId)) return undefined;
	const text = (key: string, as = key): Record<string, string> => (typeof details[key] === "string" ? { [as]: details[key] as string } : {});
	return {
		taskId: details.taskId,
		...text("agent"),
		...(isStatus(details.status) ? { status: details.status } : {}),
		...text("mode"),
		...text("label"),
		...text("model"),
		...text("thinking", "effort"),
		...text("lastStep"),
	};
}

// --- presence seed (after a reload) --------------------------------------------

/** An unfinished task from the presence activity file (lib/orchestrator-presence.ts RemoteSummary). */
export interface SeedTask {
	id: string;
	agent: string;
	label: string;
	status: TaskStatus;
	model?: string;
	/** Epoch ms, when the file has it. */
	startedAt?: number;
}

/** Gentle Shell's agent home (lib/agent-home.ts): `GENTLE_PI_AGENT_HOME`, else Pi's `PI_CODING_AGENT_DIR`, else `~/.pi/agent`. */
export function agentHomeDir(env: Record<string, string | undefined>, home: string): string {
	return env.GENTLE_PI_AGENT_HOME || env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
}

const ACTIVITY_FILE = /^([a-f0-9]{64})\.([0-9a-f-]{36})\.activity\.json$/;

function seedTask(row: unknown): SeedTask | undefined {
	const summary = record(record(row)?.summary);
	if (!summary || !identity(summary.id) || typeof summary.agent !== "string" || typeof summary.label !== "string" || !isStatus(summary.status) || FINISHED.has(summary.status)) return undefined;
	const startedAt = summary.startedAt;
	return {
		id: summary.id,
		agent: summary.agent,
		label: summary.label,
		status: summary.status,
		...(typeof summary.model === "string" && summary.model ? { model: summary.model } : {}),
		...(typeof startedAt === "number" && Number.isFinite(startedAt) && startedAt > 0 ? { startedAt } : {}),
	};
}

/**
 * The unfinished tasks of `sessionId` in its newest presence activity file,
 * `<agentHome>/gentle-agents/presence/<sha256(sessionId)>.<incarnation>.activity.json`,
 * written by Gentle Shell while tasks run. One bounded read; a missing
 * directory or file, an oversized file or unreadable JSON give [].
 */
export async function readPresenceTasks(agentHome: string, sessionId: string): Promise<SeedTask[]> {
	try {
		const dir = join(agentHome, "gentle-agents", "presence");
		const hash = createHash("sha256").update(sessionId).digest("hex");
		const names = (await fs.readdir(dir)).filter((name) => ACTIVITY_FILE.exec(name)?.[1] === hash);
		let newest: { path: string; mtime: number } | undefined;
		for (const name of names) {
			const path = join(dir, name);
			const stat = await fs.stat(path);
			if (!stat.isFile() || stat.size > ACTIVITY_SIZE_CAP) continue;
			if (!newest || stat.mtimeMs > newest.mtime) newest = { path, mtime: stat.mtimeMs };
		}
		if (!newest) return [];
		const tasks = record(JSON.parse(await fs.readFile(newest.path, "utf8")))?.tasks;
		return Array.isArray(tasks) ? tasks.map(seedTask).filter((task): task is SeedTask => task !== undefined) : [];
	} catch {
		return [];
	}
}

// --- tracker ---------------------------------------------------------------

interface Task {
	id: string;
	/** The row's identity for entrances: the launch call's (`call:<tool call id>`) when one named it, else `task:<id>`. */
	rowId: string;
	/** Creation order across tasks and in-flight calls. */
	order: number;
	status: TaskStatus;
	/** The last event sequence applied; 0 until an event arrives. */
	sequence: number;
	/** The state came from a tool call, not from an event or a result: the next result may set it. */
	provisional: boolean;
	agent?: string;
	text?: string;
	label?: string;
	model?: string;
	effort?: string;
	lastStep?: string;
	/** When the call that launched or continued it started: the time shown until the first running event. */
	calledAt?: number;
	/** A continue call in flight on a task that was not live: how the row was, for when that call makes no run. */
	resumed?: { callId?: string; status: TaskStatus; endedAt?: number; label?: string; text?: string };
	startedAt?: number;
	endedAt?: number;
}

/** A subagent_run or subagent_continue call in flight, not yet matched to a task: a running row of its own. */
interface Pending {
	call: SubagentCall;
	callId?: string;
	order: number;
	at: number;
}

export interface SubagentTracker {
	/** A status event; true when a task of this session changed. */
	status(event: unknown): boolean;
	/** A tool call started: a running row until its task is known; true when a row appeared or changed. */
	call(toolName: unknown, args: unknown, callId?: string): boolean;
	/** A tool call ended; true when a task or an in-flight call's row changed. */
	result(toolName: unknown, result: unknown, isError?: boolean, callId?: string): boolean;
	/** Tasks from the presence file, added only when unknown; true when any was. */
	seed(tasks: SeedTask[]): boolean;
	/** The run settled: no call is in flight, so calls still unmatched go; true when any went. */
	settle(): boolean;
	/** Drops finished tasks older than the tail at `at`; true when any went. */
	prune(at: number): boolean;
	/** The tasks and in-flight calls as agent rows in creation order, finished ones only within the tail at `at`. */
	agents(at: number): AgentInfo[];
}

const LIVE = new Set<TaskStatus>(["running", "waiting"]);

/**
 * Tracks this session's subagent tasks (S87). A tool call is a running row
 * from its start (Pi emits tool_execution_start before the tool runs, and a
 * task-mode call lasts as long as its task), named by its args; the task
 * Gentle Shell then reports takes it over (the call that continues it, else
 * the oldest unmatched run call, else the end carrying the call's id) and
 * keeps its row. Events carry the state and are ordered by sequence per task;
 * the result reconciles by task id with agent, label, model and effort and
 * sets the state while no event has, so a running subagent shows even when its
 * events never arrive. A call whose end names no task (a refused or unknown
 * launch) goes with that end, a refused continue puts its task's row back, and
 * whatever is left goes when the run settles. The running time counts from the
 * first running event, until then from the call.
 */
export function createSubagentTracker(sessionId: string, now: () => number): SubagentTracker {
	const tasks = new Map<string, Task>();
	const pending: Pending[] = [];
	let order = 0;
	const describe = (known: Task, call: SubagentCall | undefined) => {
		if (!call) return;
		if (call.agent !== undefined) known.agent = call.agent;
		if (call.text !== undefined) known.text = call.text;
		known.label = call.label;
	};
	const move = (known: Task, status: TaskStatus) => {
		known.status = status;
		if (status === "running" && known.startedAt === undefined) known.startedAt = now();
		if (FINISHED.has(status)) known.endedAt ??= now();
		else known.endedAt = undefined;
	};
	/** The pending call for task `id`: the end's own call, else the call that continues `id`, else the oldest run call. */
	const pendingFor = (id: string, callId: string | undefined): number => {
		let at = callId === undefined ? -1 : pending.findIndex((entry) => entry.callId === callId);
		if (at < 0) at = pending.findIndex((entry) => entry.call.taskId === id);
		if (at < 0) at = pending.findIndex((entry) => entry.call.taskId === undefined);
		return at;
	};
	/** The task `id`, created when unknown from the pending call that launched it (row, order, time and args carry over), or from nothing. */
	const adopt = (id: string, callId?: string, fromCall = true): Task => {
		const known = tasks.get(id);
		if (known) return known;
		const at = fromCall ? pendingFor(id, callId) : -1;
		const taken = at >= 0 ? pending.splice(at, 1)[0] : undefined;
		const created: Task = {
			id,
			rowId: taken ? `call:${taken.callId ?? `#${taken.order}`}` : `task:${id}`,
			order: taken?.order ?? ++order,
			status: taken ? "running" : "queued",
			sequence: 0,
			provisional: taken !== undefined,
			...(taken ? { calledAt: taken.at } : {}),
		};
		describe(created, taken?.call);
		tasks.set(id, created);
		return created;
	};
	/** Drops the pending call `callId`, else the oldest of `toolName`'s kind; true when one went. */
	const drop = (toolName: unknown, callId: string | undefined): boolean => {
		let at = callId === undefined ? -1 : pending.findIndex((entry) => entry.callId === callId);
		if (at < 0) at = pending.findIndex((entry) => (entry.call.taskId === undefined) === (toolName === RUN_TOOL));
		if (at < 0) return false;
		pending.splice(at, 1);
		return true;
	};
	/** Puts back the row of the task a continue call made run, when that call made no run; any such task without `callId`. */
	const restore = (callId: string | undefined): boolean => {
		for (const known of tasks.values()) {
			const before = known.resumed;
			if (!before || (callId !== undefined && before.callId !== callId)) continue;
			known.resumed = undefined;
			known.provisional = false;
			known.status = before.status;
			known.endedAt = before.endedAt;
			known.label = before.label;
			known.text = before.text;
			return true;
		}
		return false;
	};
	const row = (known: Task): AgentInfo => {
		const startedAt = known.startedAt ?? (LIVE.has(known.status) ? known.calledAt : undefined);
		return {
			id: known.rowId,
			name: clean(known.agent, NAME_CAP) ?? "subagent",
			task: clean(known.label, TASK_CAP) ?? clean(known.text, TASK_CAP) ?? clean(known.lastStep, TASK_CAP) ?? clean(`task ${known.id}`, TASK_CAP) ?? "",
			state: AGENT_STATE[known.status],
			...(startedAt !== undefined ? { startedAt } : {}),
			...(clean(known.model, MODEL_CAP) !== undefined ? { model: clean(known.model, MODEL_CAP) } : {}),
			...(clean(known.effort, NAME_CAP) !== undefined ? { effort: clean(known.effort, NAME_CAP) } : {}),
		};
	};
	const pendingRow = (entry: Pending): AgentInfo => ({
		id: `call:${entry.callId ?? `#${entry.order}`}`,
		name: clean(entry.call.agent, NAME_CAP) ?? "subagent",
		task: clean(entry.call.label, TASK_CAP) ?? clean(entry.call.text, TASK_CAP) ?? (entry.call.taskId !== undefined ? clean(`task ${entry.call.taskId}`, TASK_CAP) : undefined) ?? "",
		state: "running",
		startedAt: entry.at,
	});
	return {
		status(event) {
			const change = subagentStatus(event, sessionId);
			if (!change) return false;
			const known = tasks.get(change.taskId);
			if (known && change.sequence <= known.sequence) return false;
			const current = known ?? adopt(change.taskId);
			current.sequence = change.sequence;
			current.provisional = false;
			current.resumed = undefined;
			move(current, change.status);
			return true;
		},
		call(toolName, args, callId) {
			const call = subagentCall(toolName, args);
			if (!call) return false;
			const known = call.taskId !== undefined ? tasks.get(call.taskId) : undefined;
			if (known) {
				const before = { ...(callId !== undefined ? { callId } : {}), status: known.status, endedAt: known.endedAt, label: known.label, text: known.text };
				describe(known, call);
				// A continuation runs the task again: running until an event or its result says otherwise.
				if (!LIVE.has(known.status)) {
					known.resumed = before;
					known.status = "running";
					known.endedAt = undefined;
					known.calledAt = now();
					known.provisional = true;
				}
				return true;
			}
			if (pending.length >= PENDING_CAP) pending.shift();
			pending.push({ call, ...(callId !== undefined ? { callId } : {}), order: ++order, at: now() });
			return true;
		},
		result(toolName, result, _isError = false, callId) {
			const details = subagentResult(toolName, result);
			// A launch or continuation that made no task (refused, unknown agent or task): its call must not name the next one.
			if (!details) {
				if (toolName === RUN_TOOL) return drop(toolName, callId);
				if (toolName !== CONTINUE_TOOL) return false;
				return (callId !== undefined && restore(callId)) || drop(toolName, callId) || restore(undefined);
			}
			const known = tasks.get(details.taskId);
			const current = known ?? adopt(details.taskId, callId);
			// A known task already took its call; one still pending under this end's id is its own (a continue, or a launch another task's event took first).
			if (known) {
				const at = pendingFor(details.taskId, callId);
				if (at >= 0 && (pending[at].callId === callId || pending[at].call.taskId === details.taskId)) describe(current, pending.splice(at, 1)[0].call);
			}
			if (details.agent !== undefined) current.agent = details.agent;
			if (details.label !== undefined) current.label = details.label;
			if (details.model !== undefined) current.model = details.model;
			if (details.effort !== undefined) current.effort = details.effort;
			if (details.lastStep !== undefined) current.lastStep = details.lastStep;
			// The events own the state once they flow; until then the result's status
			// is the task's: a new task's first state, or the end of a run whose events never came.
			if (details.status !== undefined && (current.sequence === 0 || current.provisional)) move(current, details.status);
			current.provisional = false;
			current.resumed = undefined;
			return true;
		},
		seed(seeds) {
			let added = false;
			for (const seed of seeds) {
				if (tasks.has(seed.id)) continue;
				// Started before Fisi Dock loaded: no call of this session is its.
				const current = adopt(seed.id, undefined, false);
				current.agent = seed.agent;
				current.label = seed.label;
				current.model = seed.model;
				current.startedAt = seed.startedAt;
				current.provisional = false;
				move(current, seed.status);
				added = true;
			}
			return added;
		},
		settle() {
			let any = pending.length > 0;
			pending.length = 0;
			while (restore(undefined)) any = true;
			return any;
		},
		prune(at) {
			let dropped = false;
			for (const [id, known] of tasks) {
				if (known.endedAt !== undefined && at - known.endedAt >= SUBAGENT_FINISHED_TTL_MS) {
					tasks.delete(id);
					dropped = true;
				}
			}
			return dropped;
		},
		agents(at) {
			const rows: { order: number; row: AgentInfo }[] = [];
			for (const known of tasks.values()) {
				if (known.endedAt !== undefined && at - known.endedAt >= SUBAGENT_FINISHED_TTL_MS) continue;
				rows.push({ order: known.order, row: row(known) });
			}
			for (const entry of pending) rows.push({ order: entry.order, row: pendingRow(entry) });
			return rows.sort((a, b) => a.order - b.order).map((entry) => entry.row);
		},
	};
}
