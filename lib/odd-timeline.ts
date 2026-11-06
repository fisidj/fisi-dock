import { actionDetail, addAction, oddAction, stepSummary, type OddAction, type StepActions } from "./odd-detail.ts";
import { inferOddPhase, oddPhase, type OddPhase } from "./odd-inference.ts";
import { orbFrameIndex, SHIMMER_STEP_MS, shimmerStepIndex, type OrbMotion } from "./orbs.ts";
import type { OddInfo, OddStep } from "./panel-model.ts";

// The ODD phase timeline of one request (S6): every phase change closes the
// running step and opens the next, in occurrence order. Times come from an
// injected clock, so the reducer and the tracker run the same under tests.

/** Steps kept and drawn; older ones only count toward "+N earlier" (S7). */
export const ODD_STEP_CAP = 6;
/** The tick under potato motion, where only the seconds move. */
const STILL_TICK_MS = 1000;

interface TimedStep {
	phase: OddPhase;
	/** Milliseconds from the clock. */
	start: number;
	/** Set once the step is closed. */
	end?: number;
	/** What the step did (S60), bounded. */
	acts?: StepActions;
}

export interface Timeline {
	steps: readonly TimedStep[];
	/** Closed steps dropped past the cap. */
	earlier: number;
}

export function emptyTimeline(): Timeline {
	return { steps: [], earlier: 0 };
}

function closeLast(steps: readonly TimedStep[], now: number): TimedStep[] {
	const last = steps.at(-1);
	return last && last.end === undefined ? [...steps.slice(0, -1), { ...last, end: Math.max(last.start, now) }] : [...steps];
}

/** Opens `phase` as the active step; the same phase as the active step changes nothing. */
export function enterPhase(timeline: Timeline, phase: OddPhase, now: number): Timeline {
	const last = timeline.steps.at(-1);
	if (last && last.end === undefined && last.phase === phase) return timeline;
	const steps = [...closeLast(timeline.steps, now), { phase, start: now }];
	const dropped = Math.max(0, steps.length - ODD_STEP_CAP);
	return { steps: steps.slice(dropped), earlier: timeline.earlier + dropped };
}

/** Records `action` on the active step (S60); without one, nothing changes. */
export function recordAction(timeline: Timeline, action: OddAction): Timeline {
	const last = timeline.steps.at(-1);
	if (!last || last.end !== undefined) return timeline;
	return { ...timeline, steps: [...timeline.steps.slice(0, -1), { ...last, acts: addAction(last.acts, action) }] };
}

/** Closes the active step, if any. */
export function endRun(timeline: Timeline, now: number): Timeline {
	const last = timeline.steps.at(-1);
	return last && last.end === undefined ? { ...timeline, steps: closeLast(timeline.steps, now) } : timeline;
}

/** The panel's odd section at `now`, or undefined while the timeline is empty. */
export function timelineView(timeline: Timeline, now: number): OddInfo | undefined {
	if (timeline.steps.length === 0) return undefined;
	const steps: OddStep[] = timeline.steps.map((step) => {
		const active = step.end === undefined;
		// The active step says what its last tool is doing, a done one sums up what it did (S60).
		const detail = active ? step.acts && actionDetail(step.acts.last) : stepSummary(step.acts);
		return {
			phase: step.phase,
			state: active ? "active" : "done",
			seconds: Math.max(0, Math.floor(((step.end ?? now) - step.start) / 1000)),
			...(detail ? { detail } : {}),
		};
	});
	return timeline.earlier > 0 ? { steps, earlier: timeline.earlier } : { steps };
}

// Gentle Shell's process-wide OddPhaseRegistry (lib/odd-phase.ts). It holds the
// current phase per Pi session id, from gentle_odd_phase reports and its own
// tool inference, and is cleared at agent_start, agent_settled and shutdown. It
// has no change event, so Fisi Dock samples get(sessionId) on its own triggers.
export const ODD_REGISTRY_KEY = Symbol.for("gentle-pi.odd-phase-registry");

/** The registry's phase for `sessionId`; undefined when absent, empty or malformed. */
export function registryPhase(sessionId: string, scope: object = globalThis): OddPhase | undefined {
	try {
		const registry = (scope as Record<symbol, unknown>)[ODD_REGISTRY_KEY] as { get?: unknown } | undefined;
		if (!registry || typeof registry.get !== "function") return undefined;
		return oddPhase(registry.get(sessionId));
	} catch {
		return undefined;
	}
}

export interface OddTrackerOptions {
	sessionId: string;
	now(): number;
	/** Called with the new view whenever the timeline may have changed. */
	onChange(view: OddInfo | undefined): void;
	/** The session folder; action paths under it are shown relative (S60). */
	cwd?: string;
	/** Where the registry lives; globalThis in Pi. */
	scope?: object;
	/** True while this session's subagents still run: agent_end then keeps the active step open (S91). */
	busy?(): boolean;
	/** Gentle Shell's animation level, read at each new request; quality when absent. */
	motion?(): OrbMotion;
	setInterval?(tick: () => void, ms: number): unknown;
	clearInterval?(handle: unknown): void;
}

export interface OddTracker {
	/** agent_start: a new request after a settled run, else a continuation. */
	runStart(): void;
	toolStart(event: { toolName?: string; args?: unknown }): void;
	/** Reads the registry again (turn events, tool ends). */
	sample(): void;
	/** agent_end: closes the active step, or holds it open while `busy` (S91). */
	runEnd(): void;
	/** The subagents changed: a step held past agent_end closes once none runs (S91). */
	busyChanged(): void;
	/** agent_settled: the request is over (the view says so, S52); the next agent_start starts afresh. */
	runSettled(): void;
	view(): OddInfo | undefined;
	dispose(): void;
}

/**
 * One session's timeline. The registry wins whenever it names a phase; the
 * tool-event fallback applies only while it has named none in this request.
 * While a step is active a single timer recomputes the view every shine step
 * (75 ms, S49), so the label shine, the orb frame (from the clock, S17) and the
 * live seconds move; potato motion keeps a 1 s tick. It stops at run end and on dispose.
 */
export function createOddTracker(options: OddTrackerOptions): OddTracker {
	const scope = options.scope ?? globalThis;
	const startTimer = options.setInterval ?? ((tick: () => void, ms: number) => {
		const handle = setInterval(tick, ms);
		(handle as { unref?(): void }).unref?.();
		return handle;
	});
	const stopTimer = options.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
	let timeline = emptyTimeline();
	/** The request's first phase start, kept when its step drops past the cap (S52). */
	let firstStart: number | undefined;
	let running = false;
	let settled = true;
	let registrySeen = false;
	/** agent_end came while subagents ran; the step stays open until they finish or the run settles (S91). */
	let held = false;
	let timer: unknown;
	let timerMs = 0;
	let disposed = false;
	let motion: OrbMotion = "quality";
	const readMotion = () => {
		try {
			motion = options.motion?.() ?? "quality";
		} catch {
			motion = "quality";
		}
	};

	/** The view with the active step's orb frame and shine step at `now`; once settled, the request's wall time. */
	const view = (): OddInfo | undefined => {
		const now = options.now();
		const info = timelineView(timeline, now);
		if (!info) return info;
		if (settled) {
			const last = timeline.steps.at(-1)!;
			const totalSeconds = Math.max(0, Math.floor(((last.end ?? now) - (firstStart ?? timeline.steps[0].start)) / 1000));
			return { ...info, settled: true, totalSeconds };
		}
		const steps = info.steps.map((step) => {
			if (step.state !== "active") return step;
			const scan = shimmerStepIndex(now, motion);
			return { ...step, frame: orbFrameIndex(step.phase, now, motion), ...(scan === undefined ? {} : { scan }) };
		});
		return { ...info, steps };
	};
	const emit = () => {
		if (!disposed) options.onChange(view());
	};
	const clearTimer = () => {
		if (timer === undefined) return;
		stopTimer(timer);
		timer = undefined;
	};
	const enter = (phase: OddPhase | undefined) => {
		if (!phase || !running) return;
		timeline = enterPhase(timeline, phase, options.now());
		firstStart ??= timeline.steps[0].start;
		const ms = motion === "potato" ? STILL_TICK_MS : SHIMMER_STEP_MS;
		if (timer !== undefined && timerMs === ms) return;
		clearTimer();
		timerMs = ms;
		timer = startTimer(tick, ms);
	};
	const fromRegistry = (): OddPhase | undefined => {
		const phase = registryPhase(options.sessionId, scope);
		if (phase) registrySeen = true;
		return phase;
	};
	const tick = () => {
		if (disposed) return;
		enter(fromRegistry());
		emit();
	};
	const isBusy = () => {
		try {
			return options.busy?.() === true;
		} catch {
			return false;
		}
	};
	const stop = () => {
		held = false;
		if (!running) return false;
		running = false;
		timeline = endRun(timeline, options.now());
		clearTimer();
		return true;
	};

	return {
		runStart() {
			if (disposed) return;
			if (settled) {
				timeline = emptyTimeline();
				firstStart = undefined;
				registrySeen = false;
				readMotion();
			}
			settled = false;
			running = true;
			held = false;
			enter(fromRegistry());
			emit();
		},
		toolStart(event) {
			if (disposed || !running) return;
			const registry = fromRegistry();
			enter(registry ?? (registrySeen ? undefined : inferOddPhase(event?.toolName ?? "", event?.args)));
			const action = oddAction(event?.toolName ?? "", event?.args, options.cwd);
			if (action) timeline = recordAction(timeline, action);
			emit();
		},
		sample: tick,
		runEnd() {
			if (disposed) return;
			if (running && isBusy()) {
				held = true;
				return;
			}
			if (stop()) emit();
		},
		busyChanged() {
			if (disposed || !held || isBusy()) return;
			if (stop()) emit();
		},
		runSettled() {
			if (disposed) return;
			stop();
			settled = true;
			emit();
		},
		view,
		dispose() {
			disposed = true;
			running = false;
			clearTimer();
		},
	};
}
