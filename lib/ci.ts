import { printable } from "./odd-detail.ts";
import type { CiCheck, CiInfo } from "./panel-model.ts";

// CI checks of the branch's last pushed commit (S64, artboard 24 option C):
// pure parsers for `gh run list --json` and `gh run view --json jobs` output.
// gh's shapes are restated here; anything unexpected reads as "unknown" and
// keeps what is shown, never a guessed state.

export interface CiRun {
	/** gh's databaseId, for `gh run view`; absent when gh gave none. */
	id?: number;
	/** The workflow name, printable and bounded. */
	name: string;
	state: CiCheck["state"];
	/** Epoch ms; absent when gh gave no usable time. */
	createdAt?: number;
	startedAt?: number;
	updatedAt?: number;
	failedJob?: string;
	/** Failed only: `gh run view` answered for this id and updatedAt, so failedJob (absent: none named) is not read again (S66). */
	jobRead?: true;
}

/** One commit's runs, one per workflow. */
export interface CiRuns {
	sha: string;
	runs: CiRun[];
	/** Epoch ms of the successful list read that gave these runs (S66). */
	readAt?: number;
}

/** Runs one gh command in the session folder; Pi's exec in the extension. */
export type CiExec = (args: string[]) => Promise<{ stdout: string; code: number }>;

const LIST_LIMIT = 20;
const LIST_FIELDS = "databaseId,workflowName,name,status,conclusion,startedAt,updatedAt,createdAt,headSha";
/** gh names past this many characters are cut (S64). */
const NAME_CAP = 80;
const SHORT_SHA = 7;
/** Past this long without a successful list read, a running check's time and spinner hold (S66). */
const STALE_MS = 90_000;

export function ciListArgs(branch: string): string[] {
	return ["run", "list", "--branch", branch, "--limit", String(LIST_LIMIT), "--json", LIST_FIELDS];
}

export function ciViewArgs(id: number): string[] {
	return ["run", "view", String(id), "--json", "jobs"];
}

const record = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** A gh name as one printable, bounded line (S64, like odd-detail S61). */
function clean(value: unknown): string {
	return typeof value === "string" ? printable(value).replace(/\s+/g, " ").trim().slice(0, NAME_CAP) : "";
}

/** An ISO time from gh as epoch ms; gh's zero time (a run not started) counts as none. */
function time(value: unknown): number | undefined {
	const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
	return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

function parse(stdout: string): unknown {
	try {
		return JSON.parse(stdout);
	} catch {
		return undefined;
	}
}

const PASSED = new Set(["success", "skipped", "neutral"]);
const FAILED = new Set(["failure", "timed_out", "startup_failure", "action_required"]);

/** gh's status and conclusion as one state; a conclusion gh may add later reads as cancelled, never passed or failed. */
function runState(status: unknown, conclusion: unknown): CiCheck["state"] {
	if (status === "completed") return PASSED.has(conclusion as string) ? "passed" : FAILED.has(conclusion as string) ? "failed" : "cancelled";
	// queued, waiting, requested and pending, and any status gh may add later.
	return status === "in_progress" ? "running" : "queued";
}

/** Newest first by createdAt; a tie or a missing time keeps gh's order (newest first). */
const newer = (a: number | undefined, b: number | undefined) => (a ?? -Infinity) > (b ?? -Infinity);

/**
 * `gh run list --json` to the runs of its newest run's commit, one per
 * workflow (the newest by createdAt). Undefined: not gh's list (keep what is
 * shown); null: no runs (no section).
 */
export function ciRunsFromList(stdout: string): CiRuns | null | undefined {
	const list = parse(stdout);
	if (!Array.isArray(list)) return undefined;
	const runs = list.flatMap((value) => {
		const entry = record(value);
		const sha = clean(entry?.headSha);
		if (!entry || !sha) return [];
		const id = typeof entry.databaseId === "number" && Number.isSafeInteger(entry.databaseId) && entry.databaseId > 0 ? entry.databaseId : undefined;
		const times = { createdAt: time(entry.createdAt), startedAt: time(entry.startedAt), updatedAt: time(entry.updatedAt) };
		const run: CiRun = { name: clean(entry.workflowName) || clean(entry.name), state: runState(entry.status, entry.conclusion) };
		if (id !== undefined) run.id = id;
		for (const [key, ms] of Object.entries(times)) if (ms !== undefined) run[key as keyof typeof times] = ms;
		return [{ sha, run }];
	});
	if (runs.length === 0) return null;
	const newest = runs.reduce((best, entry) => (newer(entry.run.createdAt, best.run.createdAt) ? entry : best));
	const byWorkflow = new Map<string, CiRun>();
	for (const { sha, run } of runs) {
		if (sha !== newest.sha) continue;
		const known = byWorkflow.get(run.name);
		if (!known || newer(run.createdAt, known.createdAt)) byWorkflow.set(run.name, run);
	}
	return { sha: newest.sha, runs: [...byWorkflow.values()] };
}

/** `gh run view --json jobs` to `<job> · <first failed step>` of its first failed job (the job alone without a failed step). */
export function failedJob(stdout: string): string | undefined {
	return viewJob(stdout)?.job;
}

/** gh's view as its failed job (absent: none named); undefined when it is not gh's view. */
function viewJob(stdout: string): { job?: string } | undefined {
	const jobs = record(parse(stdout))?.jobs;
	if (!Array.isArray(jobs)) return undefined;
	const job = jobs.map(record).find((entry) => entry?.conclusion === "failure");
	const name = clean(job?.name);
	if (!name) return {};
	const steps = Array.isArray(job?.steps) ? job.steps : [];
	const step = clean(steps.map(record).find((entry) => entry?.conclusion === "failure")?.name);
	return { job: step ? `${name} · ${step}` : name };
}

async function ghOutput(exec: CiExec, args: string[]): Promise<string | undefined> {
	try {
		const result = await exec(args);
		return result.code === 0 ? result.stdout : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The branch's CI runs, each failed one with its failed job, stamped with
 * `now()` once the list read succeeds. A failed run whose view already
 * answered in `previous` for the same id and updatedAt keeps that answer
 * without another `gh run view`; a failed view is retried (S66). Undefined:
 * the read failed or timed out (keep what is shown); null: no runs.
 */
export async function readCi(exec: CiExec, branch: string, previous?: CiRuns, now: () => number = Date.now): Promise<CiRuns | null | undefined> {
	const stdout = await ghOutput(exec, ciListArgs(branch));
	const read = stdout === undefined ? undefined : ciRunsFromList(stdout);
	if (!read) return read;
	const readAt = now();
	const runs: CiRun[] = [];
	for (const run of read.runs) {
		if (run.state !== "failed" || run.id === undefined) {
			runs.push(run);
			continue;
		}
		const known = previous?.runs.find((other) => other.id === run.id && other.state === "failed" && other.updatedAt === run.updatedAt && other.jobRead);
		const view = known ? { job: known.failedJob } : viewJob((await ghOutput(exec, ciViewArgs(run.id))) ?? "");
		if (!view) runs.push(run);
		else runs.push({ ...run, ...(view.job !== undefined ? { failedJob: view.job } : {}), jobRead: true });
	}
	return { sha: read.sha, runs, readAt };
}

/** Whole seconds from `from` to `to`; none when either is unknown. */
const span = (from: number | undefined, to: number | undefined) => (from !== undefined && to !== undefined ? { seconds: Math.max(0, Math.floor((to - from) / 1000)) } : {});

/**
 * What the panel draws for `runs` at `now`: sorted by name, the running time
 * to `now`, the others' durations. Over 90 s after the last successful read a
 * running time stays at that read and its spinner holds (S66).
 */
export function ciView(runs: CiRuns | undefined, now: number): CiInfo | undefined {
	if (!runs?.runs.length) return undefined;
	const stale = runs.readAt !== undefined && now - runs.readAt > STALE_MS;
	const until = stale ? runs.readAt : now;
	const checks = runs.runs
		.map((run): CiCheck => ({
			name: run.name,
			state: run.state,
			...(run.state === "queued" ? {} : span(run.startedAt, run.state === "running" ? until : run.updatedAt)),
			...(run.state === "failed" && run.failedJob !== undefined ? { failedJob: run.failedJob } : {}),
		}))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	const updates = runs.runs.flatMap((run) => (run.updatedAt !== undefined ? [run.updatedAt] : []));
	return { sha: runs.sha.slice(0, SHORT_SHA), checks, ...(updates.length ? { endedAt: Math.max(...updates) } : {}), ...(stale ? { stale: true } : {}) };
}

/** True while a check runs and the last successful read is recent: its spinner turns and its m:ss ticks with the spinner clock. */
export function ciRunning(info: CiInfo | undefined): boolean {
	return info !== undefined && !info.stale && info.checks.some((check) => check.state === "running");
}

/** True while a check runs or waits: gh is read every 30 s instead of every 3 min. */
export function ciLive(info: CiInfo | undefined): boolean {
	return info?.checks.some((check) => check.state === "running" || check.state === "queued") ?? false;
}

const PUSH_TOOLS = new Set(["bash", "bash_background"]);

/** A bash or bash_background call whose command contains `git push`: CI starts soon after (S64). */
export function gitPushTool(toolName: string | undefined, args: unknown): boolean {
	const command = record(args)?.command;
	return PUSH_TOOLS.has(toolName ?? "") && typeof command === "string" && /\bgit\s+push\b/.test(command);
}
