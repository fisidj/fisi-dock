import assert from "node:assert/strict";
import test from "node:test";
import type { OddInfo } from "../lib/panel-model.ts";
import {
	ODD_REGISTRY_KEY,
	createOddTracker,
	emptyTimeline,
	endRun,
	enterPhase,
	registryPhase,
	timelineView,
	type OddTrackerOptions,
} from "../lib/odd-timeline.ts";
import type { OrbMotion } from "../lib/orbs.ts";

const SECOND = 1000;

test("first phase opens an active step at zero", () => {
	const timeline = enterPhase(emptyTimeline(), "exploring", 0);
	assert.deepEqual(timelineView(timeline, 0), { steps: [{ phase: "exploring", state: "active", seconds: 0 }] });
	assert.deepEqual(timelineView(timeline, 4.9 * SECOND), { steps: [{ phase: "exploring", state: "active", seconds: 4 }] });
});

test("a phase change closes the previous step with its seconds", () => {
	let timeline = enterPhase(emptyTimeline(), "exploring", 0);
	timeline = enterPhase(timeline, "implementing", 31 * SECOND);
	assert.deepEqual(timelineView(timeline, 40 * SECOND), {
		steps: [
			{ phase: "exploring", state: "done", seconds: 31 },
			{ phase: "implementing", state: "active", seconds: 9 },
		],
	});
});

test("the same phase again is no new step", () => {
	let timeline = enterPhase(emptyTimeline(), "exploring", 0);
	const again = enterPhase(timeline, "exploring", 5 * SECOND);
	assert.equal(again, timeline);
	timeline = again;
	assert.deepEqual(timelineView(timeline, 10 * SECOND), { steps: [{ phase: "exploring", state: "active", seconds: 10 }] });
});

test("an earlier phase coming back is a new step", () => {
	let timeline = enterPhase(emptyTimeline(), "exploring", 0);
	timeline = enterPhase(timeline, "implementing", 10 * SECOND);
	timeline = enterPhase(timeline, "exploring", 30 * SECOND);
	assert.deepEqual(timelineView(timeline, 35 * SECOND)?.steps.map((step) => [step.phase, step.state, step.seconds]), [
		["exploring", "done", 10],
		["implementing", "done", 20],
		["exploring", "active", 5],
	]);
});

test("run end closes the active step; time stops", () => {
	let timeline = enterPhase(emptyTimeline(), "checking", 0);
	timeline = endRun(timeline, 42 * SECOND);
	const view = { steps: [{ phase: "checking", state: "done", seconds: 42 }] };
	assert.deepEqual(timelineView(timeline, 42 * SECOND), view);
	assert.deepEqual(timelineView(timeline, 999 * SECOND), view);
	assert.equal(endRun(timeline, 50 * SECOND), timeline, "ending twice changes nothing");
	assert.equal(timelineView(emptyTimeline(), 0), undefined);
});

test("more than 6 steps keep the latest 6 and count the earlier ones", () => {
	let timeline = emptyTimeline();
	const phases = ["exploring", "implementing", "checking", "exploring", "implementing", "checking", "exploring", "closing"] as const;
	phases.forEach((phase, index) => (timeline = enterPhase(timeline, phase, index * 10 * SECOND)));
	const view = timelineView(timeline, 75 * SECOND);
	assert.equal(view?.earlier, 2);
	assert.deepEqual(view?.steps.map((step) => step.phase), ["checking", "exploring", "implementing", "checking", "exploring", "closing"]);
	assert.deepEqual(view?.steps.at(-1), { phase: "closing", state: "active", seconds: 5 });
});

test("the registry is read through its process-wide symbol", () => {
	assert.equal(ODD_REGISTRY_KEY, Symbol.for("gentle-pi.odd-phase-registry"));
	const scope = { [ODD_REGISTRY_KEY]: { get: (id: string) => (id === "s1" ? "implementing" : undefined) } };
	assert.equal(registryPhase("s1", scope), "implementing");
	assert.equal(registryPhase("s2", scope), undefined);
	assert.equal(registryPhase("s1", {}), undefined, "absent registry");
	assert.equal(registryPhase("s1", { [ODD_REGISTRY_KEY]: { get: () => "dancing" } }), undefined, "unknown phase");
	assert.equal(registryPhase("s1", { [ODD_REGISTRY_KEY]: { get: () => { throw new Error("x"); } } }), undefined, "throwing registry");
	assert.equal(registryPhase("s1", { [ODD_REGISTRY_KEY]: 42 }), undefined, "malformed registry");
});

// --- tracker -------------------------------------------------------------------

function harness(registry?: Map<string, string>, motion?: OrbMotion, cwd?: string, busy?: () => boolean) {
	let now = 0;
	let nextTimer = 1;
	const timers = new Map<number, () => void>();
	/** Interval of every timer ever started, in start order. */
	const intervals: number[] = [];
	const views: (OddInfo | undefined)[] = [];
	const scope: Record<symbol, unknown> = registry ? { [ODD_REGISTRY_KEY]: { get: (id: string) => registry.get(id) } } : {};
	const options: OddTrackerOptions = {
		sessionId: "s1",
		now: () => now,
		scope,
		onChange: (view) => views.push(view),
		...(motion ? { motion: () => motion } : {}),
		...(cwd ? { cwd } : {}),
		...(busy ? { busy } : {}),
		setInterval: (tick, ms) => {
			intervals.push(ms);
			const id = nextTimer++;
			timers.set(id, tick);
			return id;
		},
		clearInterval: (id) => timers.delete(id as number),
	};
	const tracker = createOddTracker(options);
	return {
		tracker,
		views,
		timers,
		intervals,
		/** Fires every timer once per `step` ms of fake time. */
		run(ms: number, step: number) {
			for (let left = ms; left > 0; left -= step) {
				now += Math.min(step, left);
				for (const tick of [...timers.values()]) tick();
			}
		},
		advance(ms: number) {
			for (let left = ms; left > 0; left -= SECOND) {
				now += Math.min(SECOND, left);
				for (const tick of [...timers.values()]) tick();
			}
		},
		last: () => views.at(-1),
	};
}

const shape = (view: OddInfo | undefined) => view?.steps.map((step) => `${step.state === "active" ? "●" : "✓"} ${step.phase} ${step.seconds}`);

test("tracker without a registry infers phases from tool events", () => {
	const h = harness();
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "read", args: { path: "a.ts" } });
	h.advance(3 * SECOND);
	h.tracker.toolStart({ toolName: "edit", args: { path: "a.ts" } });
	h.advance(2 * SECOND);
	h.tracker.toolStart({ toolName: "web_search", args: {} });
	h.tracker.toolStart({ toolName: "bash", args: { command: "npm install" } });
	assert.deepEqual(shape(h.last()), ["✓ exploring 3", "● implementing 2"], "unknown tools and ambiguous commands leave the phase");
	h.tracker.runEnd();
	assert.deepEqual(shape(h.last()), ["✓ exploring 3", "✓ implementing 2"]);
});

test("tracker prefers the registry phase and keeps it once seen this run", () => {
	const registry = new Map<string, string>();
	const h = harness(registry);
	h.tracker.runStart();
	registry.set("s1", "researching");
	h.tracker.sample();
	h.advance(2 * SECOND);
	// The registry still says researching: a read infers nothing on its own.
	h.tracker.toolStart({ toolName: "edit", args: { path: "a.ts" } });
	assert.deepEqual(shape(h.last()), ["● researching 2"]);
	registry.set("s1", "deciding");
	h.advance(SECOND);
	assert.deepEqual(shape(h.last()), ["✓ researching 3", "● deciding 0"], "the 1 s tick samples the registry");
	registry.delete("s1");
	h.tracker.toolStart({ toolName: "edit", args: { path: "a.ts" } });
	assert.deepEqual(shape(h.last()), ["✓ researching 3", "● deciding 0"], "a cleared registry keeps the current phase");
});

test("tracker falls back to inference while the registry has nothing this run", () => {
	const h = harness(new Map());
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "grep", args: {} });
	h.advance(SECOND);
	h.tracker.toolStart({ toolName: "bash", args: { command: "node --test" } });
	assert.deepEqual(shape(h.last()), ["✓ exploring 1", "● checking 0"]);
});

test("tracker ticks only while a step is active, and the seconds still change each second", () => {
	const h = harness();
	h.tracker.runStart();
	assert.equal(h.timers.size, 0, "no step, no timer");
	h.tracker.toolStart({ toolName: "read", args: {} });
	h.tracker.toolStart({ toolName: "grep", args: {} });
	assert.equal(h.timers.size, 1, "a single timer");
	const before = h.views.length;
	h.advance(3 * SECOND);
	assert.deepEqual(h.views.slice(before).map((view) => view?.steps[0].seconds), [1, 2, 3]);
	h.tracker.runEnd();
	assert.equal(h.timers.size, 0, "run end clears the timer");
	h.tracker.toolStart({ toolName: "edit", args: {} });
	assert.deepEqual(shape(h.last()), ["✓ exploring 3"], "tools after run end open nothing");
});

test("a new request starts a new timeline; the finished one stays until then", () => {
	const h = harness();
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "read", args: {} });
	h.advance(5 * SECOND);
	h.tracker.runEnd();
	h.tracker.runSettled();
	h.advance(60 * SECOND);
	assert.deepEqual(shape(h.tracker.view()), ["✓ exploring 5"]);
	h.tracker.runStart();
	assert.equal(h.tracker.view(), undefined);
	assert.equal(h.last(), undefined);
	h.tracker.toolStart({ toolName: "edit", args: {} });
	assert.deepEqual(shape(h.last()), ["● implementing 0"]);
});

test("settling marks the request over with its wall time; the next request resets both (S52)", () => {
	const h = harness();
	h.tracker.runStart();
	h.advance(2 * SECOND);
	h.tracker.toolStart({ toolName: "read", args: {} });
	h.advance(5 * SECOND);
	h.tracker.toolStart({ toolName: "edit", args: {} });
	h.advance(3 * SECOND);
	assert.equal(h.last()?.settled, undefined, "running: not settled");
	assert.equal(h.last()?.totalSeconds, undefined);
	h.tracker.runEnd();
	assert.equal(h.last()?.settled, undefined, "agent_end alone is not the end of the request");
	h.advance(4 * SECOND);
	const count = h.views.length;
	h.tracker.runSettled();
	assert.ok(h.views.length > count, "settling reports a new view");
	assert.equal(h.last()?.settled, true);
	assert.equal(h.last()?.totalSeconds, 8, "first phase start to last step end");
	assert.deepEqual(shape(h.last()), ["✓ exploring 5", "✓ implementing 3"]);
	assert.deepEqual(h.tracker.view(), h.last());
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "read", args: {} });
	assert.equal(h.last()?.settled, undefined, "a new request is not settled");
	assert.equal(h.last()?.totalSeconds, undefined);
});

test("the wall time counts steps dropped past the cap (S52)", () => {
	const h = harness();
	h.tracker.runStart();
	for (let step = 0; step < 8; step++) {
		h.tracker.toolStart({ toolName: step % 2 ? "edit" : "read", args: {} });
		h.advance(10 * SECOND);
	}
	h.tracker.runSettled();
	assert.equal(h.last()?.earlier, 2);
	assert.equal(h.last()?.steps.length, 6);
	assert.equal(h.last()?.totalSeconds, 80);
});

test("a continuation before the run settled keeps the same timeline", () => {
	const h = harness();
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "read", args: {} });
	h.advance(2 * SECOND);
	h.tracker.runEnd();
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "read", args: {} });
	assert.deepEqual(shape(h.last()), ["✓ exploring 2", "● exploring 0"]);
});

test("S91 agent_end while this session's subagents run keeps the step active; it closes when they finish", () => {
	let busy = true;
	const h = harness(undefined, undefined, undefined, () => busy);
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "read", args: {} });
	h.advance(2 * SECOND);
	h.tracker.runEnd();
	assert.deepEqual(shape(h.last()), ["● exploring 2"], "subagents still run: the step stays active");
	assert.equal(h.timers.size, 1, "its timer keeps the seconds moving");
	h.advance(3 * SECOND);
	assert.deepEqual(shape(h.last()), ["● exploring 5"]);
	h.tracker.busyChanged();
	assert.deepEqual(shape(h.last()), ["● exploring 5"], "still busy: nothing closes");
	busy = false;
	h.tracker.busyChanged();
	assert.deepEqual(shape(h.last()), ["✓ exploring 5"], "the last subagent finished: the step closes");
	assert.equal(h.timers.size, 0);
	h.advance(4 * SECOND);
	assert.deepEqual(shape(h.tracker.view()), ["✓ exploring 5"], "time stops");
	assert.equal(h.last()?.settled, undefined, "not settled until agent_settled");
});

test("S91 busy changes before agent_end or after the run closed change nothing; settling closes a held step", () => {
	let busy = false;
	const h = harness(undefined, undefined, undefined, () => busy);
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "read", args: {} });
	h.tracker.busyChanged();
	assert.deepEqual(shape(h.last()), ["● exploring 0"], "the run still runs: busy going false is no end");
	busy = true;
	h.advance(SECOND);
	h.tracker.runEnd();
	h.advance(SECOND);
	h.tracker.runSettled();
	assert.deepEqual(shape(h.last()), ["✓ exploring 2"], "agent_settled closes it even while busy");
	assert.equal(h.last()?.settled, true);
	assert.equal(h.timers.size, 0);
	const count = h.views.length;
	busy = false;
	h.tracker.busyChanged();
	assert.equal(h.views.length, count, "a closed run reports nothing");
});

test("S91 a continuation while held keeps the same active step", () => {
	const h = harness(undefined, undefined, undefined, () => true);
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "read", args: {} });
	h.advance(2 * SECOND);
	h.tracker.runEnd();
	h.advance(SECOND);
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "grep", args: {} });
	assert.deepEqual(shape(h.last()), ["● exploring 3"]);
});

test("settling without agent_end still closes the active step", () => {
	const h = harness();
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "read", args: {} });
	h.advance(SECOND);
	h.tracker.runSettled();
	assert.deepEqual(shape(h.last()), ["✓ exploring 1"]);
	assert.equal(h.timers.size, 0);
});

test("dispose clears the timer and stops reporting", () => {
	const h = harness();
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "read", args: {} });
	h.tracker.dispose();
	assert.equal(h.timers.size, 0);
	const count = h.views.length;
	h.tracker.toolStart({ toolName: "edit", args: {} });
	h.tracker.sample();
	assert.equal(h.views.length, count);
});

// --- phase orbs (S17) ------------------------------------------------------------

const activeFrame = (view: OddInfo | undefined) => view?.steps.find((step) => step.state === "active")?.frame;

test("the tick runs at the 75 ms shine step for every phase and is not restarted on a phase change (S49)", () => {
	const h = harness();
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "read", args: {} });
	assert.deepEqual(h.intervals, [75], "exploring: 75 ms");
	h.tracker.toolStart({ toolName: "bash", args: { command: "node --test" } });
	h.tracker.toolStart({ toolName: "edit", args: { path: "a.ts" } });
	assert.deepEqual(h.intervals, [75], "checking and implementing keep the same timer");
	assert.equal(h.timers.size, 1);
	h.tracker.runEnd();
	assert.equal(h.timers.size, 0, "run end stops the frame tick");
	for (const phase of ["exploring", "researching", "authorizing", "deciding", "planning", "implementing", "checking", "closing"]) {
		for (const [motion, ms] of [["quality", 75], ["performance", 75], ["potato", 1000]] as const) {
			const registry = new Map([["s1", phase]]);
			const each = harness(registry, motion);
			each.tracker.runStart();
			assert.deepEqual(each.intervals, [ms], `${phase} ${motion}`);
		}
	}
});

test("the active step carries the clock's orb frame; each frame tick changes the view", () => {
	const h = harness();
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "bash", args: { command: "node --test" } });
	assert.equal(activeFrame(h.last()), 0);
	const before = h.views.length;
	h.run(3 * 90, 90);
	assert.deepEqual(h.views.slice(before).map(activeFrame), [1, 2, 3], "orb frames still follow the clock at 90 ms");
	h.run(8 * 90, 90);
	assert.equal(activeFrame(h.last()), (3 + 8) % 8, "wraps after 8 frames");
	h.tracker.runEnd();
	assert.equal(activeFrame(h.last()), undefined, "done steps carry no frame");
});

test("performance motion keeps the designed orb frame rate (S29)", () => {
	const h = harness(undefined, "performance");
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "bash", args: { command: "node --test" } });
	assert.deepEqual(h.intervals, [75]);
	h.run(90, 90);
	assert.equal(activeFrame(h.last()), 1);
});

const activeScan = (view: OddInfo | undefined) => view?.steps.find((step) => step.state === "active")?.scan;

test("the active step carries the shine step floor(now / 75); done steps and potato carry none (S49)", () => {
	for (const motion of ["quality", "performance"] as const) {
		const h = harness(undefined, motion);
		h.tracker.runStart();
		h.tracker.toolStart({ toolName: "read", args: {} });
		assert.equal(activeScan(h.last()), 0);
		h.run(4 * 75 + 30, 75);
		assert.equal(activeScan(h.last()), Math.floor((4 * 75 + 30) / 75), motion);
		h.tracker.runEnd();
		assert.equal(activeScan(h.last()), undefined);
		assert.ok(h.last()!.steps.every((step) => !("scan" in step)));
	}
	const potato = harness(undefined, "potato");
	potato.tracker.runStart();
	potato.tracker.toolStart({ toolName: "read", args: {} });
	potato.advance(2 * SECOND);
	assert.ok(!("scan" in potato.last()!.steps.at(-1)!), "potato: no scan");
	assert.deepEqual(potato.intervals, [1000]);
});

test("potato motion never starts the fast tick and shows the still middle frame", () => {
	const h = harness(undefined, "potato");
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "read", args: {} });
	h.tracker.toolStart({ toolName: "bash", args: { command: "node --test" } });
	assert.deepEqual(h.intervals, [1000, 1000].slice(0, h.intervals.length));
	assert.ok(h.intervals.every((ms) => ms === 1000), "only the 1 s tick");
	assert.equal(h.timers.size, 1);
	h.advance(3 * SECOND);
	assert.deepEqual(h.views.slice(-3).map(activeFrame), [4, 4, 4]);
	assert.deepEqual(h.views.slice(-3).map((view) => view?.steps.at(-1)?.seconds), [1, 2, 3]);
});

test("motion is read again at each new request", () => {
	let motion: OrbMotion = "potato";
	let nextTimer = 1;
	const intervals: number[] = [];
	const tracker = createOddTracker({
		sessionId: "s1",
		now: () => 0,
		scope: {},
		onChange() {},
		motion: () => motion,
		setInterval: (_tick, ms) => (intervals.push(ms), nextTimer++),
		clearInterval() {},
	});
	tracker.runStart();
	tracker.toolStart({ toolName: "read", args: {} });
	tracker.runSettled();
	motion = "quality";
	tracker.runStart();
	tracker.toolStart({ toolName: "read", args: {} });
	assert.deepEqual(intervals, [1000, 75]);
});

// --- what each step did (S60) ---------------------------------------------------

const details = (view: OddInfo | undefined) => view?.steps.map((step) => `${step.state === "active" ? "●" : "✓"} ${step.phase}: ${step.detail ? `${step.detail.text}${step.detail.tail ?? ""}` : "-"}`);

test("tracker keeps what each step did: the active step's last action, a done step's summary (S60)", () => {
	const h = harness(undefined, undefined, "E:/p");
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "read", args: { path: "E:/p/lib/a.ts" } });
	assert.deepEqual(details(h.last()), ["● exploring: reading lib/a.ts"]);
	assert.deepEqual(h.last()?.steps[0].detail, { text: "reading lib/a.ts", keepEnd: true });
	h.tracker.toolStart({ toolName: "grep", args: { pattern: "row" } });
	assert.deepEqual(details(h.last()), ['● exploring: searching "row"']);
	h.tracker.toolStart({ toolName: "edit", args: { path: "E:/p/lib/tables/head.ts" } });
	assert.deepEqual(details(h.last()), ["✓ exploring: read 1 file · 1 search", "● implementing: editing lib/tables/head.ts"], "the action lands on the step it opens");
	h.tracker.toolStart({ toolName: "web_search", args: { query: "tables" } });
	assert.deepEqual(details(h.last()), ["✓ exploring: read 1 file · 1 search", "● implementing: editing lib/tables/head.ts"], "a tool without an action leaves the detail");
	h.tracker.toolStart({ toolName: "write", args: { path: "lib/tables/row.ts" } });
	h.tracker.toolStart({ toolName: "bash", args: { command: 'cd "E:/p" && npm test' } });
	assert.deepEqual(details(h.last()), ["✓ exploring: read 1 file · 1 search", "✓ implementing: edited lib/tables/ · 2 files", "● checking: running npm test"]);
	h.tracker.runEnd();
	assert.deepEqual(details(h.last()), ["✓ exploring: read 1 file · 1 search", "✓ implementing: edited lib/tables/ · 2 files", "✓ checking: ran npm test"]);
	h.tracker.toolStart({ toolName: "edit", args: { path: "lib/late.ts" } });
	assert.deepEqual(details(h.last()), ["✓ exploring: read 1 file · 1 search", "✓ implementing: edited lib/tables/ · 2 files", "✓ checking: ran npm test"], "no action after the run ended");
	h.tracker.runSettled();
	assert.equal(h.last()?.settled, true);
	assert.deepEqual(details(h.last()), ["✓ exploring: read 1 file · 1 search", "✓ implementing: edited lib/tables/ · 2 files", "✓ checking: ran npm test"], "kept for /dock");
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "read", args: { path: "lib/b.ts" } });
	assert.deepEqual(details(h.last()), ["● exploring: reading lib/b.ts"], "a new request starts afresh");
	h.tracker.dispose();
});

test("tracker records actions on the registry's phase and needs a step to record on (S60)", () => {
	const registry = new Map<string, string>();
	const h = harness(registry);
	h.tracker.runStart();
	h.tracker.toolStart({ toolName: "edit", args: { path: "lib/a.ts" } });
	assert.deepEqual(details(h.last()), ["● implementing: editing lib/a.ts"], "inferred phase");
	registry.set("s1", "planning");
	h.tracker.toolStart({ toolName: "read", args: { path: "odd/tasks/x.md" } });
	assert.deepEqual(details(h.last()), ["✓ implementing: edited lib/a.ts", "● planning: reading odd/tasks/x.md"], "the registry's phase gets the action");
	h.tracker.dispose();

	const empty = harness(new Map());
	empty.tracker.runStart();
	empty.tracker.toolStart({ toolName: "bash", args: { command: "npm install" } });
	assert.equal(empty.last(), undefined, "no phase yet: nothing to record on");
	empty.tracker.dispose();
});
