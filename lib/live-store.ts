import { entranceRows, hasEntrance, parseAhead, parseBranch, parseGitChanges, runsSpinner, sessionSnapshot, type LiveParts } from "./live-data.ts";
import { SHIMMER_STEP_MS, SPINNER_MS, spinnerFrameIndex, type OrbMotion } from "./orbs.ts";
import type { AgentInfo, PanelModel } from "./panel-model.ts";
import { panelDigest } from "./panel.ts";

// The live panel state between refresh triggers. Frames only read the cached
// model and digest; adapters write through update(), which reports whether
// anything drawn changed so the caller can request a repaint.

export interface LiveStore {
	model(): PanelModel;
	digest(): string;
	/** Merge `patch`; true when the panel model changed. */
	update(patch: Partial<LiveParts>): boolean;
	/** True while a run is active (agent_start until agent_settled). */
	runActive(): boolean;
	/** True while a running spinner is drawn (S31, L61). */
	spinning(): boolean;
	/** True while a row plays its entrance (S54). */
	entering(): boolean;
	/** Fisi Dock's first reads are done: rows shown now stay still, rows that appear from here on enter (S54). */
	loaded(): void;
}

export interface LiveStoreOptions {
	/** Gentle Shell's animation level, read when a row appears; potato rows never enter (S54). */
	motion?(): OrbMotion;
}

/**
 * Gives each running agent of `agents` without its own start time the time it
 * was first seen running (S35), kept in `seen` under `prefix` + its id or
 * name (job ids). Names that left the list are forgotten, so one that comes
 * back starts again. Queued and finished agents get none.
 */
function stampStarts<T extends AgentInfo & { id?: string }>(agents: T[] | undefined, seen: Map<string, number>, prefix: string, at: number): T[] | undefined {
	if (!agents) return agents;
	const key = (agent: T) => prefix + (agent.id ?? agent.name);
	const keys = new Set(agents.map(key));
	for (const known of [...seen.keys()]) if (known.startsWith(prefix) && !keys.has(known)) seen.delete(known);
	return agents.map((agent) => {
		if (agent.startedAt !== undefined || agent.state !== "running") return agent;
		const since = seen.get(key(agent)) ?? at;
		seen.set(key(agent), since);
		return { ...agent, startedAt: since };
	});
}

/**
 * `now` stamps when a running agent without a start time was first seen (S35),
 * when a row that can enter appeared (S54), and times the running reviews and
 * the entrances on each update (S50).
 */
export function createLiveStore(project: string, now: () => number = () => Date.now(), options: LiveStoreOptions = {}): LiveStore {
	let parts: LiveParts = { project };
	let model = sessionSnapshot(parts, now());
	let digest = panelDigest(model);
	const seen = new Map<string, number>();
	/** Rows that can enter, by entranceRows key: when they appeared, or undefined for a row that stays still. */
	const appeared = new Map<string, number | undefined>();
	let loadedAt: number | undefined;
	const animated = () => {
		try {
			return options.motion?.() !== "potato";
		} catch {
			return true;
		}
	};
	/** Rows that left are forgotten, so one that comes back enters again. */
	const stampEntrances = (next: LiveParts, at: number): Map<string, number> => {
		const rows = entranceRows(next);
		const keys = new Set(rows.map((row) => row.key));
		for (const known of [...appeared.keys()]) if (!keys.has(known)) appeared.delete(known);
		for (const row of rows) {
			if (appeared.has(row.key)) continue;
			// Before load, or an agent that started before Fisi Dock loaded: already there.
			const old = loadedAt === undefined || (row.startedAt !== undefined && row.startedAt < loadedAt);
			appeared.set(row.key, old || !animated() ? undefined : at);
		}
		const entering = new Map<string, number>();
		for (const [key, since] of appeared) if (since !== undefined) entering.set(key, since);
		return entering;
	};
	return {
		model: () => model,
		digest: () => digest,
		runActive: () => parts.runSettled === false,
		spinning: () => runsSpinner(model, parts.runSettled === false),
		entering: () => hasEntrance(model),
		loaded() {
			loadedAt ??= now();
		},
		update(patch) {
			const at = now();
			const nextParts = { ...parts, ...patch };
			if ("agents" in patch) nextParts.agents = stampStarts(patch.agents, seen, "job:", at);
			const nextModel = sessionSnapshot(nextParts, at, stampEntrances(nextParts, at));
			const nextDigest = panelDigest(nextModel);
			parts = nextParts;
			if (nextDigest === digest) return false;
			model = nextModel;
			digest = nextDigest;
			return true;
		},
	};
}

export interface SpinnerClockOptions {
	now(): number;
	/** Called with the spinner frame to show at each step. */
	onFrame(frame: number): void;
	/** Gentle Shell's animation level, read each time work starts; quality when absent. */
	motion?(): OrbMotion;
	setInterval?(tick: () => void, ms: number): unknown;
	clearInterval?(handle: unknown): void;
}

export interface SpinnerClock {
	/** Whether a spinner is drawn now and whether a row plays its entrance (S54); starts, retimes or stops the timer on a change. */
	sync(running: boolean, entering?: boolean): void;
	dispose(): void;
}

/**
 * The running spinner's wall clock (S31). While something runs, one timer
 * reports the frame at the spinner rate; the frame comes from `now`, never
 * from a count. While a row enters (S54) the same timer runs at the entrance
 * step instead, so every step is painted. Nothing running or entering, potato
 * motion or dispose: no timer.
 */
export function createSpinnerClock(options: SpinnerClockOptions): SpinnerClock {
	const startTimer = options.setInterval ?? ((tick: () => void, ms: number) => {
		const handle = setInterval(tick, ms);
		(handle as { unref?(): void }).unref?.();
		return handle;
	});
	const stopTimer = options.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
	let running = false;
	let disposed = false;
	let timer: unknown;
	let timerMs = SPINNER_MS;
	let motion: OrbMotion = "quality";
	const frame = () => options.onFrame(spinnerFrameIndex(options.now(), motion));
	const stop = () => {
		if (timer !== undefined) stopTimer(timer);
		timer = undefined;
	};
	return {
		sync(spinning, entering = false) {
			const next = spinning || entering;
			const ms = entering ? SHIMMER_STEP_MS : SPINNER_MS;
			if (disposed || (next === running && (!next || ms === timerMs))) return;
			const starting = next && !running;
			running = next;
			timerMs = ms;
			if (!running) return stop();
			if (starting) {
				try {
					motion = options.motion?.() ?? "quality";
				} catch {
					motion = "quality";
				}
			}
			stop();
			// The timer first: onFrame may call sync again with the same state, which is then a no-op.
			if (motion !== "potato") timer = startTimer(frame, ms);
			if (starting) frame();
		},
		dispose() {
			disposed = true;
			running = false;
			stop();
		},
	};
}

/** Runs one git command in the session cwd; Pi's exec in the extension. */
export type GitExec = (args: string[]) => Promise<{ stdout: string; code: number }>;

async function gitOutput(exec: GitExec, args: string[]): Promise<string | undefined> {
	try {
		const result = await exec(args);
		return result.code === 0 ? result.stdout : undefined;
	} catch {
		return undefined;
	}
}

/** Branch, ahead count and uncommitted changes; each one is omitted when its command fails. */
export async function readGit(exec: GitExec): Promise<Pick<LiveParts, "branch" | "ahead" | "changes">> {
	const branch = parseBranch(await gitOutput(exec, ["rev-parse", "--abbrev-ref", "HEAD"]));
	const ahead = parseAhead(await gitOutput(exec, ["rev-list", "--count", "@{upstream}..HEAD"]));
	const status = await gitOutput(exec, ["status", "--porcelain=v1", "-z"]);
	// A repository without commits has no HEAD to diff against: files, no counts.
	const numstat = status === undefined ? undefined : await gitOutput(exec, ["diff", "--numstat", "-z", "HEAD"]);
	return { branch, ahead, changes: status === undefined ? undefined : parseGitChanges(status, numstat ?? "") };
}

/**
 * Wraps `run` so it never overlaps itself. Triggers that arrive while a run is
 * in flight collapse into one more run after it. Failures are swallowed.
 */
export function createSerialRefresh(run: () => Promise<void>): () => void {
	let running = false;
	let again = false;
	const start = (): void => {
		if (running) {
			again = true;
			return;
		}
		running = true;
		again = false;
		let pending: Promise<void>;
		try {
			pending = run();
		} catch (error) {
			pending = Promise.reject(error);
		}
		pending
			.catch(() => {})
			.finally(() => {
				running = false;
				if (again) start();
			});
	};
	return start;
}
