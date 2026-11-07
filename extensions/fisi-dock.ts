import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ciLive, gitPushTool, readCi, type CiRuns } from "../lib/ci.ts";
import { dockStatePath, readDockEnabled, readDockTheme, writeDockEnabled } from "../lib/dock-state.ts";
import { headerPath, renderHeaderLine, renderNarrowHeader } from "../lib/header.ts";
import { readHeadsUpGit, readOddPlans } from "../lib/heads-up.ts";
import {
	agentsFromJobs,
	projectName,
	sessionCost,
	sessionTokens,
	sessionUsage,
	todoFromProgress,
	todoFromState,
	todoStateFromEntries,
	todoStateFromToolEnd,
	type LiveParts,
} from "../lib/live-data.ts";
import { createLiveStore, createSerialRefresh, createSpinnerClock, readGit, type LiveStore } from "../lib/live-store.ts";
import { MCP_GRACE_MS, mcpConfigPaths, mcpServerStates, readMcpServerNames } from "../lib/mcp.ts";
import { readSessionProfile } from "../lib/profile.ts";
import { createOddTracker, type OddTracker } from "../lib/odd-timeline.ts";
import { readOrbMotion } from "../lib/orbs.ts";
import { renderAgentsCard, renderDock, renderPanel, renderTodoCard } from "../lib/panel.ts";
import { estimateSessionCost, registryPrices, type ModelFinder } from "../lib/pricing.ts";
import { createWaveClock, type WaveClock } from "../lib/label-wave.ts";
import { createPromptBox, type EditorHost, type PromptBoxInstall } from "../lib/prompt-box.ts";
import { renderPromptLine } from "../lib/prompt-line.ts";
import { reduceReviews, reviewSnapshot, withTrail, type RddRow } from "../lib/rdd.ts";
import { createReviewModeReader, gentleAiBinary, REVIEW_MODE_TIMEOUT_MS } from "../lib/rdd-mode.ts";
import { trailEnd, trailStart, type ReviewTrail } from "../lib/rdd-detail.ts";
import { createSlotTakeover, EMPTIED_PARTS, emptyPart, railOwnsHost, SIDEBAR_STATE } from "../lib/slot.ts";
import { renderStrip } from "../lib/strip.ts";
import { agentHomeDir, createSubagentTracker, NOTIFICATION_SOURCE_EVENT, readPresenceTasks } from "../lib/subagents.ts";
import { frameUserLines, installUserFrame, USER_FRAME_HOOK } from "../lib/user-frame.ts";
import { renderWelcomeCard, shellVersion } from "../lib/welcome-card.ts";

const WIDGET_KEY = "fisi-dock";
const PROMPT_LINE_KEY = "fisi-dock-prompt-line";
const STRIP_KEY = "fisi-dock-strip";
const STATUS_SLOT = "footer";
/** The welcome card takes the startup header back at most this many times per session (S1). */
const WELCOME_RECLAIMS = 5;
/** A header call Pi dropped is tried again this often, this many times (S1). */
const WELCOME_RETRY_MS = 50;
const WELCOME_TRIES = 40;
const HEADER_SLOT = "header";
/** Pi's theme while Fisi Dock is on (themes/Fisi-Dock.json) (S95). */
const FISI_DOCK_THEME = "Fisi-Dock";
// Off puts back the theme in use before /fisi-dock on (S7); without one, or when it
// is gone, Gentle Shell's own theme: gentle-pi's DEFAULT_THEME_NAME
// (scripts/install-tui-mode-setting.mjs, themes/Gentleman-Cute.json).
const GENTLE_SHELL_THEME = "Gentleman-Cute";
const OFF_NOTICE = "Fisi Dock is off · /fisi-dock on turns it back on";
const USAGE_NOTICE = "Usage: /fisi-dock on | off (alone: pick on or off)";
// Gentle Shell's permission mode (S84): its lib/yolo-session-policy.ts answers
// this pi.events request with an adapter (readSnapshot/readMode, observe,
// dispose), the same discovery its own /gentle:customize uses; nothing is
// imported. The mode is `normal`, `auto`, `yolo` or `super-yolo`.
const HOST_UI_CHANNEL = "gentle:yolo:host-ui";

// Gentle Shell's pi.events channels (lib/shell-todo.ts, lib/jobs-sidebar-state.ts,
// lib/review-sidebar-state.ts), restated so nothing is imported from it.
const TODO_PROGRESS_EVENT = "gentle-pi:todo:progress";
const JOBS_SIDEBAR_EVENT = "gentle-ai:jobs-sidebar";
const REVIEW_SIDEBAR_EVENT = "gentle-ai:review-sidebar";
const GIT_TIMEOUT_MS = 3_000;
/** Idle sessions re-read git, plans and MCP state this often (S34a). */
const IDLE_REFRESH_MS = 10_000;
/** gh talks to GitHub, so it gets more time than git. */
const GH_TIMEOUT_MS = 15_000;
/** CI (S64): gh is read this often while a check runs or waits, and every CI_IDLE_MS otherwise. */
const CI_LIVE_MS = 30_000;
const CI_IDLE_MS = 180_000;
/** Reads after a bash `git push` ends: the runs take a moment to show up in gh. */
const CI_PUSH_DELAYS_MS = [5_000, 20_000];
/** Bash calls whose start said `git push`, by toolCallId, kept until they end; at the cap the oldest gives way (S66). */
const PUSH_CALLS_CAP = 32;

type Host = { terminal?: unknown; requestRender(): void };
type Keys = { matches(data: string, keybinding: string): boolean };
/** Gentle Shell's YoloUiAdapter, the members Fisi Dock uses, restated. */
type ModeAdapter = {
	readSnapshot?(): Promise<{ mode?: unknown } | undefined>;
	readMode?(): Promise<unknown>;
	observe(refresh: () => void): () => void;
	dispose(): void;
};

function isModeAdapter(value: unknown): value is ModeAdapter {
	if (!value || typeof value !== "object") return false;
	const adapter = value as Partial<ModeAdapter>;
	return typeof adapter.observe === "function" && typeof adapter.dispose === "function" && (typeof adapter.readSnapshot === "function" || typeof adapter.readMode === "function");
}

/** Rows the overlay may use when the terminal does not say (36: the phone pane, L51). */
const DOCK_FALLBACK_ROWS = 36;
/** Screen rows above the rail panel that are not its own: Gentle Shell's top row and the gap under it. */
const RAIL_TOP_ROWS = 2;

/** The terminal height in rows, or undefined when the terminal does not say. */
function terminalRows(tui: Host): number | undefined {
	const value = Math.floor(Number((tui.terminal as { rows?: unknown } | undefined)?.rows));
	return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The /dock overlay: the live panel, scrolled with the selection keys when it
 * is taller than the screen; Esc (Pi's cancel binding) closes it.
 */
function dockOverlay(session: LiveSession, tui: Host, keys: Keys, done: () => void) {
	let offset = 0;
	const rows = () => terminalRows(tui) ?? DOCK_FALLBACK_ROWS;
	const is = (data: string, keybinding: string) => attempt(() => keys.matches(data, keybinding)) === true;
	const scroll = (step: number) => {
		offset = Math.max(0, offset + step);
	};
	return {
		render: (width: number) => {
			const view = renderDock(session.store.model(), width, rows(), offset);
			offset = view.offset;
			return view.lines;
		},
		handleInput: (data: string) => {
			if (is(data, "tui.select.cancel") || data === "\x1b") return done();
			const page = Math.max(1, rows() - 2);
			const step = is(data, "tui.select.up") ? -1 : is(data, "tui.select.down") ? 1 : is(data, "tui.select.pageUp") ? -page : is(data, "tui.select.pageDown") ? page : 0;
			if (step === 0) return;
			scroll(step);
			tui.requestRender();
		},
		// The wheel, or a finger swipe on a phone terminal, scrolls the panel (S59).
		// Every other pointer event stops here, so a tap never reaches the
		// conversation behind the dock.
		handleMouse: (event: { type?: string; wheelDelta?: number }) => {
			if (event.type !== "wheel" || !event.wheelDelta) return { handled: true, render: false };
			scroll(Math.trunc(event.wheelDelta));
			return { handled: true, render: true };
		},
		invalidate() {},
	};
}

const LOADED_MARKER = Symbol.for("fisi-dock");

function setLoaded(loaded: boolean): void {
	(globalThis as Record<symbol, unknown>)[LOADED_MARKER] = loaded;
}

function attempt<T>(read: () => T): T | undefined {
	try {
		return read();
	} catch {
		return undefined;
	}
}

interface LiveSession {
	store: LiveStore;
	/** The session working directory, or "" when unreadable. */
	cwd: string;
	/** ODD phase timeline of the current request. */
	odd: OddTracker;
	wave: WaveClock;
	setHost(host: Host | undefined): void;
	/** Patch Pi's user message class once one is on screen (S45); repaints once when it does. */
	frameUsers(): void;
	/** Pi's user message, boxed only while Gentle Shell's sidebar state is on the host (S45). */
	frameUser(render: (width: number) => string[], width: number): string[];
	/** Context usage, cost, tokens and the ≈ estimate: cheap reads of Pi state. */
	readPi(): void;
	/** The todo snapshot replayed from the session branch. */
	readTodo(): void;
	readGit(): void;
	/** Unfinished plans in the project's odd/tasks (heads-up). */
	readPlans(): void;
	/** MCP server names from Pi's mcp.json files, then their state (S32). */
	readMcp(): void;
	/** Asks Gentle Shell for its permission-mode adapter once, then re-reads the mode (S84). */
	readMode(): void;
	/** Reads the RDD switch with `gentle-ai review mode status` (S85); one call at a time, a failure keeps the last known mode. */
	readRddMode(): void;
	/** Seeds the unfinished subagent tasks from Gentle Shell's presence activity file once (S87, after a reload). */
	readSubagents(): void;
	/** Gentle Shell's live permission mode, undefined until known. */
	permissionMode(): string | undefined;
	/** A run settled (true) or a new request started (false): todo-left warning. */
	setSettled(settled: boolean): void;
	/** A tool started: the review trail (S62). */
	toolStart(event: { toolName?: string; toolCallId?: string; args?: unknown }): void;
	toolEnd(event: { toolName?: string; toolCallId?: string; args?: unknown; isError?: boolean; result?: unknown }): void;
	dispose(): void;
}

/**
 * Live data for one session. Every source is optional: a failing read leaves
 * its field out. Reads happen on triggers, never per frame; a change repaints.
 */
function startLive(pi: ExtensionAPI, ctx: ExtensionContext): LiveSession {
	const sessionId = attempt(() => ctx.sessionManager.getSessionId()) ?? "";
	const cwd = attempt(() => ctx.sessionManager.getCwd()) ?? attempt(() => ctx.cwd) ?? "";
	const store = createLiveStore(projectName(cwd), Date.now, { motion: () => readOrbMotion(process.env, homedir()) });
	const startedAt = Date.now();
	let host: Host | undefined;
	let disposed = false;
	let reviews: RddRow[] = [];
	// What the current review is doing (S62), from the review tools the agent
	// calls; consumed once its row finishes, so the next review starts clean.
	let trail: ReviewTrail | undefined;
	const followTrail = (next: ReviewTrail | undefined) => {
		if (next === trail) return;
		trail = next;
		const rows = withTrail(reviews, trail);
		if (rows === reviews) return;
		reviews = rows;
		apply({ reviews });
	};
	const apply = (patch: Partial<LiveParts>) => {
		if (disposed) return;
		const wasRunning = store.runActive();
		// A turn starting or ending repaints even when the drawn model stays, so the strip follows it.
		if (store.update(patch) || store.runActive() !== wasRunning) attempt(() => host?.requestRender());
		// A run starting or settling may leave the drawn model as it was and still
		// start or stop the todo spinner (L61), so this runs on every patch.
		spinner.sync(store.spinning(), store.entering());
	};
	// Running spinners (S31): a wall-clock timer only while one is drawn; each
	// new frame changes the store digest, so the rail memo and the strip repaint.
	// A running or waiting review keeps it going too, so its m:ss ticks (S50),
	// and a row's entrance runs it at the entrance step until it ends (S54).
	const spinner = createSpinnerClock({
		now: Date.now,
		motion: () => readOrbMotion(process.env, homedir()),
		onFrame: (frame) => apply({ spinner: frame }),
	});
	// The prompt label's color wave (S90): by the clock, only while Gentle Shell scans its label.
	const wave = createWaveClock({
		now: Date.now,
		motion: () => readOrbMotion(process.env, homedir()),
		requestRender: () => attempt(() => host?.requestRender()),
	});
	const on = (channel: string, handler: (data: unknown) => void) =>
		attempt(() => pi.events.on(channel, (data) => void attempt(() => handler(data))));
	// Agents (S35, S87): Gentle Shell's background jobs from its jobs snapshot,
	// then this session's subagent tasks, tracked from its status events, the
	// subagent_run/subagent_continue calls and results, and the presence file at
	// start. Finished tasks fold after the jobs' tail, on the next event, tool
	// end, turn end or idle tick; no timer of their own.
	const subagents = createSubagentTracker(sessionId, Date.now);
	let jobs: LiveParts["agents"];
	/** The ODD tracker's hook, set once it exists: a step held past agent_end closes when no subagent runs (S91). */
	let agentsChanged = () => {};
	const subagentsBusy = () => subagents.agents(Date.now()).some((task) => task.state === "running" || task.state === "queued" || task.state === "waiting");
	const syncAgents = () => {
		const tasks = subagents.agents(Date.now());
		apply({ agents: jobs === undefined && tasks.length === 0 ? undefined : [...(jobs ?? []), ...tasks] });
		agentsChanged();
	};
	const pruneAgents = () => {
		if (subagents.prune(Date.now())) syncAgents();
	};
	const unsubscribe = [
		on(TODO_PROGRESS_EVENT, (data) => apply({ todo: todoFromProgress(data, sessionId, store.model().todo) })),
		on(JOBS_SIDEBAR_EVENT, (data) => {
			const agents = agentsFromJobs(data, sessionId);
			if (agents === undefined) return;
			jobs = agents;
			syncAgents();
		}),
		on(NOTIFICATION_SOURCE_EVENT, (data) => {
			if (subagents.status(data)) syncAgents();
		}),
		// One RDD row per review of this session (S50).
		on(REVIEW_SIDEBAR_EVENT, (data) => {
			const snapshot = reviewSnapshot(data, sessionId);
			if (!snapshot) return;
			const next = reduceReviews(reviews, snapshot, Date.now(), trail);
			if (next === reviews) return;
			reviews = next;
			if (next.at(-1)?.endedAt !== undefined) trail = undefined;
			apply({ reviews });
		}),
	];
	// Each orb-frame tick only rebuilds this small view; the store digest
	// changes when the shown orb frame or m:ss changes, and only then is a
	// repaint requested. Gentle Shell's animation level is read per request.
	const odd = createOddTracker({
		sessionId,
		cwd: cwd || undefined,
		now: Date.now,
		motion: () => readOrbMotion(process.env, homedir()),
		busy: subagentsBusy,
		onChange: (view) => apply({ odd: view }),
	});
	agentsChanged = () => odd.busyChanged();
	// CI (S64): gh for the branch of the last git read, serialized like git. A
	// failed or timed-out read keeps what is shown; a read with no runs, or no
	// branch, removes the section. A known branch different from the last one
	// clears the runs and reads the new branch's; a git read whose branch command
	// failed is no change, so the branch, the runs and their schedule stay (S66).
	let branch: string | undefined;
	let gitRead = false;
	let ciRuns: CiRuns | undefined;
	let ciReadAt = Date.now();
	const ci = createSerialRefresh(async () => {
		if (disposed || !cwd) return;
		const at = branch;
		const read = at === undefined ? null : await readCi((args) => pi.exec("gh", args, { cwd, timeout: GH_TIMEOUT_MS }), at, ciRuns);
		ciReadAt = Date.now();
		if (disposed || read === undefined || branch !== at) return;
		ciRuns = read ?? undefined;
		apply({ ci: ciRuns });
	});
	const git = createSerialRefresh(async () => {
		if (disposed || !cwd) return;
		const exec = (args: string[]) => pi.exec("git", args, { cwd, timeout: GIT_TIMEOUT_MS });
		const session = await readGit(exec);
		apply(session);
		const first = !gitRead;
		const moved = session.branch !== undefined && session.branch !== branch;
		gitRead = true;
		if (moved) branch = session.branch;
		if (moved && ciRuns) {
			ciRuns = undefined;
			apply({ ci: undefined });
		}
		if (first || moved) ci();
		if (!disposed) apply(await readHeadsUpGit(exec, cwd, session.branch));
	});
	// RDD switch (S85): official Gentle Shell publishes no idle mode, so Gentle
	// AI's read-only status command answers, at session start and after each
	// turn, through its own serial reader (never two calls in flight). No
	// binary, a failed, timed-out or unreadable read: the last known mode stays,
	// unknown at first, so the section waits for a review event.
	const rddBinary = attempt(() => gentleAiBinary(process.env, { homedir: attempt(() => homedir()) }));
	const rddMode = createReviewModeReader({
		exec: (command, args) => pi.exec(command, args, { ...(cwd ? { cwd } : {}), timeout: REVIEW_MODE_TIMEOUT_MS }),
		binary: rddBinary,
		cwd,
		onMode: (mode) => {
			if (!disposed) apply({ rdd: mode });
		},
	});
	const ciTimer = setInterval(() => {
		if (disposed || !gitRead) return;
		if (ciLive(store.model().ci) || Date.now() - ciReadAt >= CI_IDLE_MS) ci();
	}, CI_LIVE_MS);
	(ciTimer as { unref?(): void }).unref?.();
	const pushCalls = new Set<string>();
	const pushTimers = new Set<ReturnType<typeof setTimeout>>();
	const afterPush = () => {
		for (const ms of CI_PUSH_DELAYS_MS) {
			const timer = setTimeout(() => {
				pushTimers.delete(timer);
				ci();
			}, ms);
			timer.unref?.();
			pushTimers.add(timer);
		}
	};
	const plans = createSerialRefresh(async () => {
		if (disposed || !cwd) return;
		apply({ plans: await readOddPlans(cwd) });
	});
	// MCP (S32): names from the config files, state from Pi's tool list, which is
	// cheap to read, so every Pi read refreshes it. Pi connects the servers.
	let mcpNames: string[] | undefined;
	const mcpState = () => {
		if (!mcpNames) return;
		apply({ mcp: mcpServerStates(mcpNames, attempt(() => pi.getAllTools()), Date.now() - startedAt >= MCP_GRACE_MS) });
	};
	const mcp = createSerialRefresh(async () => {
		if (disposed) return;
		mcpNames = await readMcpServerNames(mcpConfigPaths(cwd, attempt(() => homedir()) ?? "", process.env));
		if (!mcpNames) apply({ mcp: undefined });
		mcpState();
	});
	// User message box (S45): Pi's class is patched as soon as one user message
	// is in the tree (a new session has none until the first prompt), retried on
	// setHost, agent_start, turn_start and message_end. The patch is per class,
	// so once it lands this session stops walking the tree and repaints once to
	// box the messages already on screen.
	let framed = false;
	const frameUsers = () => {
		if (framed || disposed || !host) return;
		const tui = host;
		if (attempt(() => installUserFrame(tui)) !== true) return;
		framed = true;
		attempt(() => tui.requestRender());
	};
	// Agent-model profile (S99): an in-process read of Gentle Shell's registries,
	// with the Pi reads and on the idle refresh, so a /gentle:profiles switch or
	// clear shows within one tick.
	const readProfile = () => apply({ profile: attempt(() => readSessionProfile(sessionId)) });
	// Idle refresh (S34a): with no run active and our panel, strip or header on
	// screen (Gentle Shell's sidebar state on the host terminal), git changes,
	// heads-up git data, plans and MCP state are re-read. Through the same serial
	// helpers as the run triggers, so reads never overlap.
	const idle = setInterval(() => {
		if (disposed || store.runActive()) return;
		if (!(host?.terminal as Record<symbol, unknown> | undefined)?.[SIDEBAR_STATE]) return;
		git();
		plans();
		mcpState();
		readProfile();
		pruneAgents();
	}, IDLE_REFRESH_MS);
	(idle as { unref?(): void }).unref?.();
	// Permission mode (S84): Gentle Shell answers the request synchronously
	// within the emit; a reply after that, or a second one, is disposed unused.
	// The mode is read through the adapter, never guessed; the adapter's
	// observers report a change (/gentle:mode, /gentle:yolo), and each turn end
	// re-reads it too. No answer (no Gentle Shell, an older one): no mode.
	let modeAdapter: ModeAdapter | undefined;
	let unobserveMode: (() => void) | undefined;
	let permissionMode: string | undefined;
	const readModeNow = createSerialRefresh(async () => {
		const adapter = modeAdapter;
		if (!adapter || disposed) return;
		const snapshot = adapter.readSnapshot ? await adapter.readSnapshot() : { mode: await adapter.readMode!() };
		if (disposed || adapter !== modeAdapter) return;
		const next = typeof snapshot?.mode === "string" ? snapshot.mode : undefined;
		if (next === permissionMode) return;
		permissionMode = next;
		attempt(() => host?.requestRender());
	});
	const readMode = () => {
		if (disposed) return;
		if (modeAdapter) return readModeNow();
		const respond = (value: unknown) => {
			if (disposed || modeAdapter || !isModeAdapter(value)) {
				attempt(() => (value as ModeAdapter | undefined)?.dispose?.());
				return;
			}
			modeAdapter = value;
			unobserveMode = attempt(() => value.observe(() => readModeNow()));
			readModeNow();
		};
		attempt(() => (pi.events as { emit?(channel: string, data: unknown): void }).emit?.(HOST_UI_CHANNEL, { context: ctx, respond }));
	};
	return {
		store,
		cwd,
		odd,
		wave,
		setHost: (next) => {
			host = next;
			frameUsers();
		},
		frameUsers,
		// Boxed only with Gentle Shell (its sidebar state on the host terminal), like
		// every other Fisi Dock part; before any widget has rendered there is no
		// host yet, so Pi's own lines show until the first frame.
		frameUser: (render, width) => {
			const terminal = attempt(() => host?.terminal as Record<symbol, unknown> | undefined);
			return terminal?.[SIDEBAR_STATE] ? frameUserLines(render, width) : render(width);
		},
		readPi: () => {
			const entries = attempt(() => ctx.sessionManager.getEntries());
			// Subscriptions (claude-bridge) record tokens at cost 0 (S37): the
			// estimate prices them with Pi's registry (ModelRegistry.find -> Model.cost).
			// SAFETY: Pi's ModelRegistry has find(provider, id) returning a Model with `cost`, the only
			// member ModelFinder uses; registryPrices also tolerates a missing or failing find.
			const prices = registryPrices(attempt(() => ctx.modelRegistry as unknown as ModelFinder));
			apply({
				usage: attempt(() => sessionUsage(ctx.getContextUsage())) ?? {},
				cost: entries === undefined ? undefined : attempt(() => sessionCost(entries)),
				tokens: entries === undefined ? undefined : attempt(() => sessionTokens(entries)),
				estimate: entries === undefined ? undefined : attempt(() => estimateSessionCost(entries, prices)),
			});
			readProfile();
			mcpState();
		},
		readTodo: () => {
			const manager = ctx.sessionManager as { getBranch?(): unknown[]; getEntries(): unknown[] };
			apply({ todo: attempt(() => todoFromState(todoStateFromEntries(manager.getBranch?.() ?? manager.getEntries()))) });
		},
		readGit: git,
		readPlans: plans,
		readMcp: mcp,
		readMode,
		readRddMode: rddMode,
		// One bounded read of this session's presence activity file (S87): tasks
		// still running when Fisi Dock loaded (a /reload) show from it; events
		// that arrived first win, and a missing or unreadable file changes nothing.
		readSubagents: () => {
			const home = agentHomeDir(process.env, attempt(() => homedir()) ?? "");
			void readPresenceTasks(home, sessionId).then((tasks) => {
				if (!disposed && subagents.seed(tasks)) syncAgents();
			}).catch(() => {});
		},
		permissionMode: () => permissionMode,
		setSettled: (settled) => {
			apply({ runSettled: settled });
			// No tool call is in flight once the run settled: a subagent call still unmatched is stale (S87).
			if (settled && attempt(() => subagents.settle()) === true) syncAgents();
		},
		toolStart: (event) => {
			attempt(() => followTrail(trailStart(trail, event?.toolName ?? "", event?.args)));
			// A subagent_run / subagent_continue: a running row from its start, by its call id, until
			// Gentle Shell names its task (S87); its args name the task reported next.
			const callId = typeof event?.toolCallId === "string" ? event.toolCallId : undefined;
			if (attempt(() => subagents.call(event?.toolName, event?.args, callId)) === true) syncAgents();
			// Pi's tool end has no arguments: a `git push` is remembered by its call id.
			if (typeof event?.toolCallId === "string" && attempt(() => gitPushTool(event.toolName, event.args))) {
				// Bounded, and a new push is never ignored: the oldest id gives way (S66).
				if (pushCalls.size >= PUSH_CALLS_CAP) pushCalls.delete(pushCalls.values().next().value!);
				pushCalls.add(event.toolCallId);
			}
		},
		toolEnd: (event) => {
			const pushed = (typeof event?.toolCallId === "string" && pushCalls.delete(event.toolCallId)) || attempt(() => gitPushTool(event?.toolName, event?.args)) === true;
			if (pushed && !disposed) afterPush();
			const state = attempt(() => todoStateFromToolEnd(event));
			if (state) apply({ todo: todoFromState(state) });
			attempt(() => followTrail(trailEnd(trail, event?.toolName ?? "", (event?.result as { details?: unknown } | undefined)?.details, event?.isError)));
			// The subagent result names the task id and its agent, label, model and effort; one without a task id ends its call (S87).
			if (attempt(() => subagents.result(event?.toolName, event?.result, event?.isError, typeof event?.toolCallId === "string" ? event.toolCallId : undefined)) === true) syncAgents();
		},
		dispose: () => {
			clearInterval(idle);
			clearInterval(ciTimer);
			for (const timer of pushTimers) clearTimeout(timer);
			pushTimers.clear();
			pushCalls.clear();
			odd.dispose();
			spinner.dispose();
			wave.dispose();
			disposed = true;
			attempt(() => unobserveMode?.());
			attempt(() => modeAdapter?.dispose());
			modeAdapter = undefined;
			host = undefined;
			for (const off of unsubscribe) attempt(() => off?.());
		},
	};
}

/**
 * Fisi Dock: a side panel for Gentle Shell. It replaces the parts in Gentle
 * Shell's fullscreen rail Status slot and top header row, empties its other
 * rail sections and its status bar, and gives the originals back on dispose.
 * Without Gentle Shell (no shared sidebar state) it paints nothing.
 */
export default function fisiDock(pi: ExtensionAPI): void {
	// `/fisi-dock off` (S95) is remembered in a state file outside the
	// repository; while off Fisi Dock stays dormant and Gentle Shell keeps
	// everything, from the start of each session.
	const statePath = () => dockStatePath(process.env, attempt(() => homedir()) ?? "");
	let enabled = readDockEnabled(statePath());
	// Says Fisi Dock is loaded (S24). Globals survive /reload, so the marker
	// follows the session: a removed (or dormant) Fisi Dock never leaves it set.
	setLoaded(enabled);
	let release: (() => void) | undefined;
	let live: LiveSession | undefined;
	// The prompt box (S88): Gentle Shell's editor factory wrapped while this session runs.
	let promptBox: PromptBoxInstall | undefined;
	// Gives Pi's startup header back when the welcome card holds it.
	let dropWelcome: (() => void) | undefined;

	// The startup header is the welcome card instead of Gentle Shell's rose (S1).
	// Gentle Shell sets its banner a little after session_start, and Pi disposes
	// the header it replaces, so a card disposed by someone else takes the slot
	// back on the next microtask (a few times per session, never a loop). Pi drops
	// a call made before its own header exists, so that one is tried again.
	const installWelcome = (ctx: ExtensionContext, session: LiveSession) => {
		const home = agentHomeDir(process.env, attempt(() => homedir()) ?? "");
		const version = shellVersion(attempt(() => readFileSync(join(dirname(home), "config.json"), "utf8")), home);
		let card: object | undefined;
		let reclaims = 0;
		let tries = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const install = () => {
			timer = undefined;
			if (live !== session) return;
			attempt(() =>
				ctx.ui.setHeader(() => {
					const component = {
						render: (width: number) => {
							const { project, branch } = session.store.model().session;
							return renderWelcomeCard({ version, project, branch }, width);
						},
						invalidate() {},
						dispose: () => {
							if (card !== component) return;
							card = undefined;
							if (live === session && reclaims++ < WELCOME_RECLAIMS) queueMicrotask(install);
						},
					};
					card = component;
					return component;
				}),
			);
			if (!card && tries++ < WELCOME_TRIES) timer = setTimeout(install, WELCOME_RETRY_MS);
		};
		install();
		return () => {
			if (timer) clearTimeout(timer);
			timer = undefined;
			if (!card) return;
			card = undefined;
			attempt(() => ctx.ui.setHeader(undefined));
		};
	};

	const stop = () => {
		// Only our own hook: after /reload a newer Fisi Dock may already own it.
		const scope = globalThis as Record<symbol, unknown>;
		if (live && scope[USER_FRAME_HOOK] === live.frameUser) delete scope[USER_FRAME_HOOK];
		// Gentle Shell's factory back, only while ours is still the current one.
		attempt(() => promptBox?.restore());
		promptBox = undefined;
		attempt(() => dropWelcome?.());
		dropWelcome = undefined;
		const done = release;
		release = undefined;
		done?.();
		live?.dispose();
		live = undefined;
	};

	// Narrow screens (S23 B): the full panel over everything, on demand. It reads
	// the same live store as the rail, so it updates while open.
	pi.registerCommand("dock", {
		description: "Show the full Fisi Dock panel over the screen (for narrow screens without the side rail); Esc closes it",
		handler: async (_args, ctx) => {
			if (!enabled) {
				attempt(() => ctx.ui.notify(OFF_NOTICE, "info"));
				return;
			}
			const session = live;
			if (!session || !ctx.hasUI) {
				attempt(() => ctx.ui.notify("Fisi Dock: no live session to show yet", "info"));
				return;
			}
			await ctx.ui.custom<void>(
				(tui, _theme, keybindings, done) => {
					session.setHost(tui as Host);
					// SAFETY: Pi's KeybindingsManager has matches(data, keybinding): boolean, the only member Keys uses.
					return dockOverlay(session, tui as Host, keybindings as unknown as Keys, () => done());
				},
				{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "center" } },
			);
		},
	});

	// Fisi Dock's whole session: live data, the prompt box and its widgets, which
	// take Gentle Shell's rail parts and top row over. Run at session_start and
	// by `/fisi-dock on`; stop() undoes all of it.
	const start = (ctx: ExtensionContext) => {
		const session = startLive(pi, ctx);
		live = session;
		dropWelcome = installWelcome(ctx, session);
		// Pi's patched user message render asks this hook; without it, Pi's own lines.
		(globalThis as Record<symbol, unknown>)[USER_FRAME_HOOK] = session.frameUser;
		session.readPi();
		session.readTodo();
		session.readGit();
		session.readPlans();
		session.readMcp();
		session.readMode();
		session.readRddMode();
		session.readSubagents();
		// Rows already there now (replayed todo, running jobs) stay still; new ones enter (S54).
		session.store.loaded();
		// Permission mode, model and effort (S84, S88): `SUPER-YOLO · opus-5.5 · high`,
		// the mode only when it is not normal, read per frame.
		const labels = () => {
			const model = ctx.model;
			return { mode: session.permissionMode(), modelId: model?.id, effort: model?.reasoning ? pi.getThinkingLevel() : undefined };
		};
		// The prompt box (S88): with Gentle Shell's marked editor factory installed,
		// a wrapper factory creates its editor and closes its panel-chrome rows into
		// a box with the labels on the top rule, only while Gentle Shell's sidebar
		// state is on the host (wide or narrow). Gentle Shell installs its editor in
		// its own session_start, so when it is not there yet the check runs again
		// on a microtask and at each turn end (which also follows a Gentle Shell
		// reinstall); never a timer. Without Gentle Shell, or with someone else's
		// editor, nothing is installed and the line below stays the fallback.
		const box = createPromptBox(ctx.ui as unknown as EditorHost, {
			painting: (tui) => Boolean(((tui as Host).terminal as Record<symbol, unknown> | undefined)?.[SIDEBAR_STATE]),
			labels,
			waveAt: () => live?.wave.at(),
			onScanning: (scanning) => live?.wave.report(scanning),
		});
		promptBox = box;
		if (!box.ensure()) {
			queueMicrotask(() => {
				if (promptBox === box) box.ensure();
			});
		}
		// The same labels under Gentle Shell's prompt (design 07 input bar, S84):
		// an additive line below the editor, shown only when Gentle Shell's shared
		// sidebar state proves Gentle Shell is loaded, and only while the box above
		// does not already carry them (S88). Gentle Shell's own status bar, which
		// showed the same, is emptied (S84, EMPTIED_PARTS).
		ctx.ui.setWidget(
			PROMPT_LINE_KEY,
			(tui: Host) => ({
				render: (width: number) => {
					const terminal = tui.terminal as Record<symbol, unknown> | undefined;
					// Only with Gentle Shell; neither of our top rows (wide or narrow) shows the model.
					if (live !== session || !terminal?.[SIDEBAR_STATE] || box.boxed()) return [];
					return renderPromptLine(labels(), width);
				},
				invalidate() {},
			}),
			{ placement: "belowEditor" },
		);
		// Narrow screens (S23): whenever Gentle Shell is loaded but its rail does not
		// own the screen (narrow fullscreen, regular mode, Status moved), the panel
		// is not visible, so a one or two line strip above the prompt stands in,
		// followed by Fisi Dock's agents card (S35) and todo card (S28). The card
		// headers have the agent count and `d/t`, so the strip leaves those
		// segments out while a card shows (S8). Agent times tick on the spinner's
		// repaints; the second is part of the memo key while agents run.
		ctx.ui.setWidget(
			STRIP_KEY,
			(tui: Host) => {
				session.setHost(tui);
				let drawn: { key: string; lines: string[] } | undefined;
				return {
					render: (width: number) => {
						const terminal = tui.terminal as Record<symbol, unknown> | undefined;
						if (live !== session || !terminal?.[SIDEBAR_STATE] || railOwnsHost(terminal)) return [];
						const model = session.store.model();
						const now = Date.now();
						const running = model.agents?.some((agent) => agent.state === "running") ?? false;
						const key = `${width}:${session.store.digest()}:${running ? Math.floor(now / 1000) : ""}`;
						if (drawn?.key !== key) {
							const agents = renderAgentsCard(model.agents, width, model.spinner, now);
							const todo = renderTodoCard(model.todo, width, model.spinner);
							drawn = { key, lines: [...renderStrip(model, width, { todo: todo.length === 0, agents: agents.length === 0 }), ...agents, ...todo] };
						}
						return drawn.lines;
					},
					invalidate() {},
				};
			},
			{ placement: "aboveEditor" },
		);
		ctx.ui.setWidget(WIDGET_KEY, (tui: Host) => {
			// Live content; the panel paints with its own design palette, not Pi
			// theme roles. Frames read the cached digest and reuse the last lines.
			session.setHost(tui);
			let drawn: { key: string; lines: string[] } | undefined;
			// Short screens (S34b, S38): the panel fits the rows under the top row, so the
			// rows are part of the memo key and of the digest Gentle Shell caches on.
			const maxRows = () => {
				const rows = terminalRows(tui);
				return rows === undefined ? undefined : Math.max(0, rows - RAIL_TOP_ROWS);
			};
			const rail = {
				digest: () => `${session.store.digest()}:${maxRows() ?? ""}`,
				render: (width: number) => {
					const rows = maxRows();
					const key = `${width}:${rows ?? ""}:${session.store.digest()}`;
					if (drawn?.key !== key) drawn = { key, lines: renderPanel(session.store.model(), width, { maxRows: rows }) };
					return drawn.lines;
				},
				// Gentle Shell main wraps rail parts in its own card on a transparent surface:
				// it would take our first row as the card title and clip every row two columns
				// short, cutting our right border. Loose rows skip the card and are only
				// clipped to the rail, wider than we draw. The 4.6.0 release never asks.
				cardGroups: (width: number) => ({ groups: [], loose: rail.render(width).map((_, index) => index) }),
				invalidate() {},
			};
			// The top row shows only the path (S4) while our panel is on screen. In
			// narrow fullscreen it is the only status row, so it carries project,
			// branch, context, cost and MCP dots in our style (S33) instead of
			// Gentle Shell's. Without Gentle Shell's sidebar state it stays Gentle Shell's.
			const path = headerPath(session.cwd, attempt(() => homedir()));
			/** Pi TUI's TuiMouseEventResult, passed back untouched (pi-tui types are not a dependency here). */
			type MouseResult = object;
			type HeaderPart = { render?(width: number): string[]; digest?(): string; handleMouse?(event: unknown): MouseResult | undefined };
			const gentleHeader = () => headerSlot.original() as HeaderPart | undefined;
			const mode = () => (railOwnsHost(tui.terminal) ? "wide" : (tui.terminal as Record<symbol, unknown> | undefined)?.[SIDEBAR_STATE] ? "narrow" : "gentle");
			const header = {
				digest: () => {
					const current = mode();
					if (current === "wide") return `fisi:${path}`;
					return current === "narrow" ? `fisi-narrow:${session.store.digest()}` : `gs:${attempt(() => gentleHeader()?.digest?.()) ?? ""}`;
				},
				render: (width: number) => {
					const current = mode();
					if (current === "wide") return renderHeaderLine(path, width);
					return current === "narrow" ? renderNarrowHeader(session.store.model(), width) : (attempt(() => gentleHeader()?.render?.(width)) ?? []);
				},
				invalidate() {},
				// Gentle Shell's header opens /gentle:usage on click; ours have nothing to click.
				handleMouse: (event: unknown) => (mode() === "gentle" ? attempt(() => gentleHeader()?.handleMouse?.(event)) : undefined),
			};
			const headerSlot = createSlotTakeover(HEADER_SLOT, header);
			// Gentle Shell's todo, jobs and agents sections and its status bar are
			// emptied the same way (S83, S84): only the panel shows in the rail, and
			// the line under the prompt is the one place with the mode, model and effort.
			const slots = [createSlotTakeover(STATUS_SLOT, rail), headerSlot, ...EMPTIED_PARTS.map((key) => createSlotTakeover(key, emptyPart()))];
			const reassert = () => {
				if (slots.map((slot) => slot.assert(tui.terminal)).some(Boolean)) tui.requestRender();
			};
			const restore = () => {
				if (slots.map((slot) => slot.restore(tui.terminal)).some(Boolean)) tui.requestRender();
			};
			release = () => {
				restore();
				// A replaced session may already have torn its UI down.
				try {
					ctx.ui.setWidget(WIDGET_KEY, undefined);
					ctx.ui.setWidget(PROMPT_LINE_KEY, undefined);
					ctx.ui.setWidget(STRIP_KEY, undefined);
				} catch {
					// Deliberately ignored: the UI is already gone, and teardown must never throw into Pi.
				}
			};
			reassert();
			// The widget itself paints nothing in its normal position. Its render
			// runs every frame, which is where Fisi Dock notices that Gentle Shell
			// re-registered one of its parts and puts ours back.
			// A frame after this session stopped (off, shutdown) takes nothing back.
			return {
				render: () => {
					if (live === session) reassert();
					return [];
				},
				invalidate() {},
				dispose: restore,
			};
		});
	};

	pi.on("session_start", (_event, ctx) => {
		stop();
		enabled = readDockEnabled(statePath());
		setLoaded(enabled);
		if (!enabled || !ctx.hasUI) return;
		start(ctx);
	});

	// On/off inside Gentle Shell (S95): Pi cannot unload an extension mid-session,
	// so off is the unload path (stop) plus a dormant flag, and on is the
	// session_start path again. The choice is saved; the theme follows it: on
	// remembers the theme in use (never Fisi-Dock itself) and off puts it back (S7).
	pi.registerCommand("fisi-dock", {
		description: "Turn Fisi Dock on or off (remembered across restarts; off gives Gentle Shell its panel and you your theme back); alone, pick on or off",
		getArgumentCompletions: (prefix) => {
			const items = ["on", "off"].filter((value) => value.startsWith(prefix.trim().toLowerCase()));
			return items.length > 0 ? items.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const notify = (message: string, type: "info" | "warning" = "info") => void attempt(() => ctx.ui.notify(message, type));
			let choice = args.trim().toLowerCase();
			if (choice === "") {
				// Alone (S98): a picker titled with the current state, the change first,
				// so Enter switches it; Esc changes nothing. Without a picker, the state.
				const status = () => notify(enabled ? "Fisi Dock is on · /fisi-dock off gives Gentle Shell its panel back" : OFF_NOTICE);
				if (!ctx.hasUI) return status();
				let picked: string | undefined;
				try {
					picked = await ctx.ui.select(enabled ? "Fisi Dock is on" : "Fisi Dock is off", enabled ? ["off", "on"] : ["on", "off"]);
				} catch {
					return status();
				}
				if (picked === undefined) return;
				choice = picked;
			}
			if (choice !== "on" && choice !== "off") return notify(USAGE_NOTICE, "warning");
			const next = choice === "on";
			if (next === enabled) return notify(`Fisi Dock is already ${choice}`);
			enabled = next;
			const path = statePath();
			const inUse = attempt(() => ctx.ui.theme.name);
			const remembered = next && typeof inUse === "string" && inUse !== "" && inUse !== FISI_DOCK_THEME ? inUse : readDockTheme(path);
			const saved = writeDockEnabled(path, next, remembered);
			stop();
			setLoaded(next);
			if (next && ctx.hasUI) start(ctx);
			// A widget that never rendered left no release behind: remove ours here too.
			if (!next) for (const key of [WIDGET_KEY, PROMPT_LINE_KEY, STRIP_KEY]) attempt(() => ctx.ui.setWidget(key, undefined));
			// Pi's setter reports { success }; a setter that throws counts as not
			// changed too. A remembered theme Pi no longer knows is not tried, since
			// Pi's setter falls to its system theme on an unknown name.
			const setTheme = (name: string) => attempt(() => ctx.ui.setTheme(name)) ?? { success: false };
			const known = (name: string) => attempt(() => ctx.ui.getTheme(name)) !== undefined;
			let themeName = next ? FISI_DOCK_THEME : (remembered ?? GENTLE_SHELL_THEME);
			let lost: string | undefined;
			let theme = !next && remembered !== undefined && !known(remembered) ? { success: false } : setTheme(themeName);
			if (!next && themeName !== GENTLE_SHELL_THEME && !theme.success) {
				lost = `theme ${themeName} not available${theme.error ? `: ${theme.error}` : ""}`;
				themeName = GENTLE_SHELL_THEME;
				theme = setTheme(themeName);
			}
			const back = themeName === remembered ? `your theme ${themeName}` : `theme ${themeName}`;
			const notes = [
				next
					? `Fisi Dock on${theme.success ? ` · theme ${FISI_DOCK_THEME}` : ""}`
					: `Fisi Dock off · Gentle Shell's panel ${theme.success ? `and ${back} are` : "is"} back; /fisi-dock on turns it back on`,
				...(lost ? [lost] : []),
				...(theme.success ? [] : [`theme not changed: ${theme.error ?? "unknown theme"}`]),
				...(saved ? [] : [`not saved to ${path}, so a restart keeps the previous choice`]),
			];
			notify(notes.join(" · "), saved && !lost && theme.success ? "info" : "warning");
		},
	});

	// Refresh triggers: Pi state after every turn and model change, git once per
	// turn and run (serialized), the todo snapshot as soon as its tool returns.
	pi.on("turn_end", () => {
		live?.odd.sample();
		live?.readPi();
		live?.readGit();
		live?.readMode();
		live?.readRddMode();
		// Gentle Shell's editor arrived after session_start, or it reinstalled its own (S88).
		attempt(() => promptBox?.ensure());
	});
	pi.on("agent_end", () => {
		live?.odd.runEnd();
		live?.readPi();
		live?.readGit();
	});

	// ODD timeline (S6): a request runs from agent_start to agent_settled; an
	// agent_start before the previous run settled (retry, queued work) continues
	// the same timeline. Gentle Shell's phase registry is sampled on these
	// events and on the tracker's orb-frame tick while a step is active.
	pi.on("agent_start", () => {
		live?.frameUsers();
		live?.odd.runStart();
		live?.setSettled(false);
	});
	// Heads-up (S14): open todo tasks count as left over only once the run
	// settled; plans are rescanned then, since the run may have edited them.
	pi.on("agent_settled", () => {
		live?.odd.runSettled();
		live?.setSettled(true);
		live?.readPlans();
	});
	pi.on("turn_start", () => {
		live?.frameUsers();
		live?.odd.sample();
	});
	pi.on("message_end", () => live?.frameUsers());
	pi.on("tool_execution_start", (event) => {
		live?.odd.toolStart(event);
		live?.toolStart(event);
	});
	pi.on("model_select", () => live?.readPi());
	pi.on("session_compact", () => live?.readPi());
	pi.on("session_tree", () => {
		live?.readPi();
		live?.readTodo();
	});
	pi.on("tool_execution_end", (event) => {
		live?.odd.sample();
		live?.toolEnd(event);
	});

	pi.on("session_shutdown", () => {
		stop();
		setLoaded(false);
	});
}
