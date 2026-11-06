import assert from "node:assert/strict";
import test from "node:test";
import { createLiveStore, createSerialRefresh, createSpinnerClock, readGit, type GitExec } from "../lib/live-store.ts";
import { panelDigest } from "../lib/panel.ts";

test("store digest follows the model and changes only when a value changes", () => {
	const store = createLiveStore("app");
	const first = store.digest();
	assert.equal(first, panelDigest({ session: { project: "app" } }));
	assert.equal(store.update({ branch: "main" }), true);
	assert.notEqual(store.digest(), first);
	const second = store.digest();
	assert.equal(store.update({ branch: "main" }), false);
	assert.equal(store.digest(), second);
	assert.equal(store.model(), store.model(), "model is cached between updates");
	assert.equal(store.update({ todo: { done: 1, total: 2, more: 0 } }), true);
	assert.deepEqual(store.model().todo, { done: 1, total: 2, more: 0 });
	assert.equal(store.update({ todo: undefined }), true);
	assert.equal(store.model().todo, undefined);
});

const ok = (stdout: string) => Promise.resolve({ stdout, code: 0 });

test("readGit reads branch, ahead and changes", async () => {
	const calls: string[][] = [];
	const exec: GitExec = (args) => {
		calls.push(args);
		if (args[0] === "rev-parse") return ok("main\n");
		if (args[0] === "rev-list") return ok("2\n");
		if (args[0] === "status") return ok(" M a.ts\0");
		return ok("4\t1\ta.ts\0");
	};
	assert.deepEqual(await readGit(exec), { branch: "main", ahead: 2, changes: [{ status: "M", path: "a.ts", added: 4, removed: 1 }] });
	assert.deepEqual(calls, [
		["rev-parse", "--abbrev-ref", "HEAD"],
		["rev-list", "--count", "@{upstream}..HEAD"],
		["status", "--porcelain=v1", "-z"],
		["diff", "--numstat", "-z", "HEAD"],
	]);
});

test("readGit omits whatever fails", async () => {
	const exec: GitExec = (args) => {
		if (args[0] === "rev-parse") return ok("HEAD\n");
		if (args[0] === "rev-list") return Promise.resolve({ stdout: "", code: 128 });
		if (args[0] === "status") return ok("?? new.ts\0");
		return Promise.reject(new Error("no HEAD yet"));
	};
	assert.deepEqual(await readGit(exec), { branch: undefined, ahead: undefined, changes: [{ status: "?", path: "new.ts", added: 0, removed: 0 }] });
	const outside: GitExec = () => Promise.resolve({ stdout: "", code: 128 });
	assert.deepEqual(await readGit(outside), { branch: undefined, ahead: undefined, changes: undefined });
	const throws: GitExec = () => {
		throw new Error("spawn failed");
	};
	assert.deepEqual(await readGit(throws), { branch: undefined, ahead: undefined, changes: undefined });
});

test("serial refresh never overlaps and coalesces triggers into one rerun", async () => {
	let running = 0;
	let peak = 0;
	let runs = 0;
	const gates: (() => void)[] = [];
	const refresh = createSerialRefresh(async () => {
		running++;
		runs++;
		peak = Math.max(peak, running);
		await new Promise<void>((resolve) => gates.push(resolve));
		running--;
	});
	refresh();
	refresh();
	refresh();
	assert.equal(runs, 1);
	gates.shift()!();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(runs, 2, "one rerun for the triggers that came in while running");
	gates.shift()!();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(runs, 2);
	assert.equal(peak, 1);
});

test("serial refresh survives a failing run", async () => {
	let runs = 0;
	const refresh = createSerialRefresh(async () => {
		runs++;
		throw new Error("boom");
	});
	refresh();
	await new Promise((resolve) => setImmediate(resolve));
	refresh();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(runs, 2);
});

/** A spinner clock on a fake clock and fake interval timers. */
function spinnerHarness(motion: "quality" | "performance" | "potato" = "quality") {
	let now = 1_000;
	let next = 1;
	const timers = new Map<number, { tick: () => void; ms: number }>();
	const frames: (number | undefined)[] = [];
	const clock = createSpinnerClock({
		now: () => now,
		motion: () => motion,
		onFrame: (frame) => frames.push(frame),
		setInterval: (tick, ms) => (timers.set(next, { tick, ms }), next++),
		clearInterval: (handle) => void timers.delete(handle as number),
	});
	const advance = (ms: number) => {
		now += ms;
		for (const timer of [...timers.values()]) timer.tick();
	};
	return { clock, timers, frames, advance };
}

test("spinner clock: no timer while nothing runs (S31)", () => {
	const h = spinnerHarness();
	h.clock.sync(false);
	h.clock.sync(false);
	assert.equal(h.timers.size, 0);
	assert.deepEqual(h.frames, []);
});

test("spinner clock: running starts one 80 ms timer whose frames follow the clock, and work ending stops it (S31)", () => {
	const h = spinnerHarness();
	h.clock.sync(true);
	assert.deepEqual([...h.timers.values()].map((timer) => timer.ms), [80]);
	assert.deepEqual(h.frames, [2], "the frame at now right away (1000 ms -> 12 % 10)");
	h.clock.sync(true);
	assert.equal(h.timers.size, 1, "one timer however often it is told");
	h.advance(80);
	h.advance(80);
	assert.deepEqual(h.frames, [2, 3, 4]);
	h.clock.sync(false);
	assert.equal(h.timers.size, 0, "stopped when work ends");
	h.clock.sync(true);
	assert.equal(h.timers.size, 1, "starts again with new work");
	h.clock.dispose();
	assert.equal(h.timers.size, 0, "dispose stops it");
	h.clock.sync(true);
	assert.equal(h.timers.size, 0, "a disposed clock starts nothing");
});

test("spinner clock: performance animates, potato shows the still frame with no timer (S31)", () => {
	const fast = spinnerHarness("performance");
	fast.clock.sync(true);
	assert.equal(fast.timers.size, 1);
	fast.clock.dispose();
	const still = spinnerHarness("potato");
	still.clock.sync(true);
	assert.equal(still.timers.size, 0);
	assert.deepEqual(still.frames, [2], "the still ⠹");
});

test("agent start times: a job's startedAt is kept; others start when first seen running, per name, never invented (S35)", () => {
	let now = 10_000;
	const store = createLiveStore("app", () => now);
	const job = { name: "job-1", task: "npm test", state: "running" as const, startedAt: 4_000 };
	store.update({
		agents: [
			{ name: "worker", task: "session rows", state: "running" },
			{ name: "verify", task: "queued prompt", state: "queued" },
			job,
		],
	});
	const starts = () => store.model().agents!.map((agent) => agent.startedAt);
	assert.deepEqual(starts(), [10_000, undefined, 4_000], "first seen running; queued has none; the job keeps its own");

	now = 15_000;
	store.update({
		agents: [
			{ name: "worker", task: "session rows", state: "running" },
			{ name: "verify", task: "queued prompt", state: "running" },
			job,
		],
	});
	assert.deepEqual(starts(), [10_000, 15_000, 4_000], "worker keeps its first sighting; verify starts when it starts running");

	now = 20_000;
	store.update({ spinner: 3 });
	assert.deepEqual(starts(), [10_000, 15_000, 4_000], "other patches leave the times");

	store.update({ agents: [{ name: "verify", task: "queued prompt", state: "running" }, job] });
	now = 25_000;
	store.update({ agents: [{ name: "worker", task: "again", state: "running" }, { name: "verify", task: "queued prompt", state: "running" }, job] });
	assert.deepEqual(starts(), [25_000, 15_000, 4_000], "a name that left and came back starts again");

	store.update({ agents: [{ name: "job-2", task: "lint", state: "running" }] });
	assert.equal(store.model().agents![0].startedAt, 25_000, "a job without startedAt: first seen");
	now = 30_000;
	store.update({ agents: [{ name: "job-2", task: "lint", state: "running" }] });
	assert.equal(store.model().agents![0].startedAt, 25_000);
});

test("RDD row times follow the store clock on each update, so the spinner ticks move m:ss (S50)", () => {
	let now = 10_000;
	const store = createLiveStore("app", () => now);
	store.update({ reviews: [{ scope: "a.ts", status: "reviewing", startedAt: 10_000 }] });
	assert.equal(store.model().rdd?.reviews[0].seconds, 0);
	assert.equal(store.spinning(), true, "an active row spins outside a run too");
	now = 12_500;
	const before = store.digest();
	assert.equal(store.update({ spinner: 1 }), true);
	assert.equal(store.model().rdd?.reviews[0].seconds, 2);
	assert.notEqual(store.digest(), before);
	store.update({ reviews: [{ scope: "a.ts", status: "approved", startedAt: 10_000, endedAt: 13_000 }] });
	assert.equal(store.spinning(), false, "finished rows stop the spinner");
});

test("a running CI check spins with the spinner clock and its m:ss follows the store clock; queued or finished checks do not spin (S64)", () => {
	let now = 70_000;
	const store = createLiveStore("app", () => now);
	const runs = (state: "running" | "queued" | "passed") => ({ sha: "e6f1ffd0", runs: [{ id: 1, name: "tests", state, startedAt: 10_000, updatedAt: 20_000 }] });
	store.update({ ci: runs("running"), spinner: 3 });
	assert.equal(store.spinning(), true, "a running check spins outside a run too");
	assert.equal(store.model().spinner, 3, "the frame is drawn");
	assert.equal(store.model().ci?.checks[0].seconds, 60);
	now = 71_000;
	const before = store.digest();
	assert.equal(store.update({ spinner: 4 }), true);
	assert.equal(store.model().ci?.checks[0].seconds, 61, "m:ss ticks with the spinner");
	assert.notEqual(store.digest(), before);
	store.update({ ci: runs("queued") });
	assert.equal(store.spinning(), false, "queued does not spin");
	assert.equal(store.model().spinner, undefined);
	store.update({ ci: runs("passed") });
	assert.equal(store.spinning(), false);
	assert.equal(store.model().ci?.checks[0].seconds, 10, "a finished check's duration");
	assert.equal(store.update({ ci: undefined }), true);
	assert.equal(store.model().ci, undefined, "no runs: no CI");
});

// Row entrance (S54): rows that appear after load play it; rows already there stay still.
function entranceStore(motion: "quality" | "potato" = "quality") {
	const clock = { now: 10_000 };
	const store = createLiveStore("app", () => clock.now, { motion: () => motion });
	return { clock, store };
}

test("entrance: rows present at load stay still; rows that appear after load enter, step by step, then settle (S54)", () => {
	const { clock, store } = entranceStore();
	store.update({ todo: { done: 0, total: 2, active: "Old task", more: 0 }, agents: [{ name: "worker", task: "rows", state: "running" }] });
	store.loaded();
	clock.now = 10_500;
	store.update({ spinner: 1 });
	assert.equal(store.model().todo!.entrance, undefined, "the task active at load");
	assert.equal(store.model().agents![0].entrance, undefined, "the agent running at load");
	assert.equal(store.entering(), false);

	store.update({ agents: [{ name: "worker", task: "rows", state: "running" }, { name: "verify", task: "checks", state: "running" }] });
	assert.deepEqual(store.model().agents!.map((agent) => agent.entrance), [undefined, 0], "only the new agent enters");
	assert.equal(store.entering(), true);
	clock.now = 10_650;
	store.update({ spinner: 2 });
	assert.equal(store.model().agents![1].entrance, 2);

	store.update({ todo: { done: 1, total: 2, active: "New task", more: 0 } });
	assert.equal(store.model().todo!.entrance, 0, "a new active task enters");
	store.update({ odd: { steps: [{ phase: "checking", state: "active", seconds: 0 }] } });
	assert.equal(store.model().odd!.steps[0].entrance, 0, "a new ODD step enters");
	store.update({ reviews: [{ scope: "a.ts", status: "reviewing", startedAt: 10_650 }] });
	assert.equal(store.model().rdd!.reviews[0].entrance, 0, "a new review row enters");

	clock.now = 20_000;
	store.update({ spinner: 3 });
	const model = store.model();
	assert.ok(!("entrance" in model.todo!) && model.agents!.every((agent) => !("entrance" in agent)) && !("entrance" in model.odd!.steps[0]) && !("entrance" in model.rdd!.reviews[0]), "every entrance is over");
	assert.equal(store.entering(), false);
	store.update({ odd: { steps: [{ phase: "checking", state: "active", seconds: 9 }] } });
	assert.equal(store.model().odd!.steps[0].entrance, undefined, "the same step does not enter again");
});

test("entrance: a job that started before load stays still; a row that left and comes back enters again (S54)", () => {
	const { clock, store } = entranceStore();
	store.loaded();
	store.update({ agents: [{ name: "job-1", task: "npm test", state: "running", startedAt: 4_000 }] });
	assert.equal(store.model().agents![0].entrance, undefined, "started before Fisi Dock loaded");
	store.update({ todo: { done: 0, total: 1, active: "A", more: 0 } });
	clock.now = 30_000;
	store.update({ todo: { done: 0, total: 1, more: 1 } });
	store.update({ todo: { done: 0, total: 1, active: "A", more: 0 } });
	assert.equal(store.model().todo!.entrance, 0);
});

test("entrance: never under potato; never before loaded() (S54)", () => {
	const potato = entranceStore("potato");
	potato.store.loaded();
	potato.store.update({ agents: [{ name: "worker", task: "rows", state: "running" }], todo: { done: 0, total: 1, active: "A", more: 0 } });
	assert.equal(potato.store.model().agents![0].entrance, undefined);
	assert.equal(potato.store.model().todo!.entrance, undefined);
	assert.equal(potato.store.entering(), false);
	const early = entranceStore();
	early.store.update({ todo: { done: 0, total: 1, active: "A", more: 0 } });
	assert.equal(early.store.model().todo!.entrance, undefined);
});

test("spinner clock: a 75 ms timer while an entrance plays, the 80 ms spinner timer after it, none when both end (S54)", () => {
	const h = spinnerHarness();
	h.clock.sync(false, true);
	assert.deepEqual([...h.timers.values()].map((timer) => timer.ms), [75], "an entrance alone runs the clock at the entrance step");
	assert.equal(h.frames.length, 1, "a frame right away");
	h.clock.sync(true, true);
	assert.deepEqual([...h.timers.values()].map((timer) => timer.ms), [75], "spinner and entrance: still one 75 ms timer");
	h.clock.sync(true, false);
	assert.deepEqual([...h.timers.values()].map((timer) => timer.ms), [80], "the entrance ended: back to the spinner rate");
	h.clock.sync(false, false);
	assert.equal(h.timers.size, 0, "nothing left: no timer");
	const still = spinnerHarness("potato");
	still.clock.sync(false, true);
	assert.equal(still.timers.size, 0, "potato: no timer");
});
