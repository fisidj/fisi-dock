import assert from "node:assert/strict";
import test from "node:test";
import { reduceReviews, reviewSnapshot, rddView, shortScope, withTrail, type RddRow } from "../lib/rdd.ts";

const snap = (state: string, scope = "panel.ts +3 files") => ({ state, scope });

test("each review state maps to its RDD row status (S50)", () => {
	const cases: [string, RddRow["status"]][] = [
		["reviewing", "reviewing"],
		["in_review", "reviewing"],
		["checking", "reviewing"],
		["approved", "reviewing"],
		["forecast", "reviewing"],
		["correction", "fixing"],
		["consent", "waiting"],
		["closed", "approved"],
		["invalidated", "outdated"],
		["unavailable", "unavailable"],
		["declined", "skipped"],
	];
	for (const [state, status] of cases) {
		assert.deepEqual(reduceReviews([], snap(state), 1_000).at(-1)?.status, status, state);
	}
});

test("finished statuses stamp endedAt; active and waiting ones do not (S50)", () => {
	for (const state of ["closed", "invalidated", "unavailable", "declined"]) {
		assert.deepEqual(reduceReviews([], snap(state, "a.ts"), 5_000), [{ scope: "a.ts", status: reduceReviews([], snap(state), 0)[0].status, startedAt: 5_000, endedAt: 5_000 }], state);
	}
	for (const state of ["reviewing", "correction", "consent"]) {
		assert.equal("endedAt" in reduceReviews([], snap(state), 5_000)[0], false, state);
	}
});

test("ready and unknown (and made-up states) create no row and leave the rows as they were (S50)", () => {
	const rows = reduceReviews([], snap("reviewing", "a.ts"), 1_000);
	for (const state of ["ready", "unknown", "made-up", ""]) {
		assert.equal(reduceReviews([], snap(state), 2_000).length, 0, state);
		assert.equal(reduceReviews(rows, snap(state, "b.ts"), 2_000), rows, `${state} keeps the same rows`);
	}
});

test("the same scope updates the last unfinished row and keeps its start (S50)", () => {
	let rows = reduceReviews([], snap("forecast", "a.ts"), 1_000);
	rows = reduceReviews(rows, snap("reviewing", "a.ts"), 4_000);
	rows = reduceReviews(rows, snap("consent", "a.ts"), 9_000);
	assert.deepEqual(rows, [{ scope: "a.ts", status: "waiting", startedAt: 1_000 }]);
	rows = reduceReviews(rows, snap("closed", "a.ts"), 20_000);
	assert.deepEqual(rows, [{ scope: "a.ts", status: "approved", startedAt: 1_000, endedAt: 20_000 }]);
});

test("a new row starts when the scope differs or the last row is finished, newest last (S50)", () => {
	let rows = reduceReviews([], snap("reviewing", "a.ts"), 1_000);
	rows = reduceReviews(rows, snap("reviewing", "b.ts +1 file"), 2_000);
	assert.deepEqual(rows.map((row) => row.scope), ["a.ts", "b.ts +1"], "different scope: new row");
	rows = reduceReviews(rows, snap("closed", "b.ts +1 file"), 3_000);
	rows = reduceReviews(rows, snap("reviewing", "b.ts +1 file"), 4_000);
	assert.equal(rows.length, 3, "finished last row: new row even with the same scope");
	assert.deepEqual(rows[2], { scope: "b.ts +1", status: "reviewing", startedAt: 4_000 });
	for (const state of ["invalidated", "declined", "unavailable"]) {
		const done = reduceReviews([], snap(state, "c.ts"), 1_000);
		assert.equal(reduceReviews(done, snap("reviewing", "c.ts"), 2_000).length, 2, state);
	}
});

test("scope ` +N file(s)` shortens to ` +N` (S50)", () => {
	assert.equal(shortScope("orbs.ts +2 files"), "orbs.ts +2");
	assert.equal(shortScope("orbs.ts +1 file"), "orbs.ts +1");
	assert.equal(shortScope("fisi-dock.md"), "fisi-dock.md");
	assert.equal(shortScope("my files +1 file.ts"), "my files +1 file.ts", "only a trailing count");
});

test("an unknown scope (Gentle Shell's `Candidate scope unavailable`) joins the last unfinished row, else shows `changes` (S50)", () => {
	let rows = reduceReviews([], snap("reviewing", "a.ts"), 1_000);
	rows = reduceReviews(rows, snap("checking", "Candidate scope unavailable"), 2_000);
	assert.deepEqual(rows, [{ scope: "a.ts", status: "reviewing", startedAt: 1_000 }]);
	assert.deepEqual(reduceReviews([], snap("unavailable", "Candidate scope unavailable"), 3_000), [{ scope: "changes", status: "unavailable", startedAt: 3_000, endedAt: 3_000 }]);
});

test("reviewSnapshot reads this session's review event only (S50)", () => {
	assert.deepEqual(reviewSnapshot({ sessionId: "s1", snapshot: { state: "closed", scope: "a.ts" } }, "s1"), { state: "closed", scope: "a.ts" });
	assert.deepEqual(reviewSnapshot({ sessionId: "s1", snapshot: { state: "closed" } }, "s1"), { state: "closed", scope: "" });
	assert.equal(reviewSnapshot({ sessionId: "s2", snapshot: { state: "closed", scope: "a.ts" } }, "s1"), undefined);
	assert.equal(reviewSnapshot({ sessionId: "s1", snapshot: { scope: "a.ts" } }, "s1"), undefined);
	assert.equal(reviewSnapshot(undefined, "s1"), undefined);
});

test("rddView gives active and waiting rows their seconds and finished rows their end time (S50)", () => {
	const rows: RddRow[] = [
		{ scope: "a.ts", status: "approved", startedAt: 1_000, endedAt: 9_000 },
		{ scope: "b.ts", status: "reviewing", startedAt: 10_000 },
		{ scope: "c.ts", status: "waiting", startedAt: 20_000 },
	];
	assert.deepEqual(rddView(rows, 78_500), {
		reviews: [
			{ scope: "a.ts", status: "approved", endedAt: 9_000 },
			{ scope: "b.ts", status: "reviewing", seconds: 68 },
			{ scope: "c.ts", status: "waiting", seconds: 58 },
		],
	});
	assert.equal(rddView([], 0), undefined);
});

// --- what each review is doing (S62) ---------------------------------------------

const lensTrail = { lenses: ["readability", "reliability"], phase: "running", reviewers: 2 } as const;

test("a running row carries the trail's step; the row that finishes keeps its summary (S62)", () => {
	let rows = reduceReviews([], snap("reviewing", "a.ts"), 1_000, lensTrail);
	assert.deepEqual(rows, [{ scope: "a.ts", status: "reviewing", startedAt: 1_000, detail: "running 2 reviewers" }]);
	const closing = { ...lensTrail, phase: "closing", findings: 7 } as const;
	rows = reduceReviews(rows, snap("closed", "a.ts"), 9_000, closing);
	assert.deepEqual(rows, [{ scope: "a.ts", status: "approved", startedAt: 1_000, endedAt: 9_000, detail: "7 findings · none blocking · 2 lenses" }]);
	const next = reduceReviews(rows, snap("reviewing", "b.ts"), 10_000, { phase: "starting" });
	assert.equal(next[0].detail, "7 findings · none blocking · 2 lenses", "a finished row keeps its summary");
	assert.equal(next[1].detail, "starting");
	assert.deepEqual(reduceReviews([], snap("unavailable", "c.ts"), 1_000, lensTrail)[0], { scope: "c.ts", status: "unavailable", startedAt: 1_000, endedAt: 1_000 }, "no findings known: no summary");
	assert.deepEqual(reduceReviews([], snap("reviewing", "d.ts"), 1_000), [{ scope: "d.ts", status: "reviewing", startedAt: 1_000 }], "no trail: today's row");
});

test("withTrail moves only the running row's step and returns the same rows when nothing changes (S62)", () => {
	const rows: RddRow[] = [
		{ scope: "a.ts", status: "approved", startedAt: 1_000, endedAt: 2_000, detail: "no findings · 1 lens" },
		{ scope: "b.ts", status: "reviewing", startedAt: 3_000, detail: "starting" },
	];
	const moved = withTrail(rows, lensTrail);
	assert.deepEqual(moved.map((row) => row.detail), ["no findings · 1 lens", "running 2 reviewers"]);
	assert.equal(withTrail(moved, lensTrail), moved, "same step: same rows");
	assert.equal(withTrail(rows.slice(0, 1), lensTrail).length, 1);
	assert.equal(withTrail(rows.slice(0, 1), lensTrail)[0].detail, "no findings · 1 lens", "a finished last row is never touched");
	assert.equal(withTrail([], lensTrail).length, 0);
});

test("rddView passes each row's detail to the panel (S62)", () => {
	const view = rddView([
		{ scope: "a.ts", status: "approved", startedAt: 1_000, endedAt: 9_000, detail: "no findings · 1 lens" },
		{ scope: "b.ts", status: "reviewing", startedAt: 10_000, detail: "running 2 reviewers" },
	], 12_000);
	assert.deepEqual(view?.reviews.map((review) => review.detail), ["no findings · 1 lens", "running 2 reviewers"]);
});

// --- the row opened before the files are known (S63) -----------------------------

const unknownScope = (state: string) => snap(state, "Candidate scope unavailable");

test("a row opened with no files takes the files of the next update and keeps its start (S63)", () => {
	let rows = reduceReviews([], unknownScope("checking"), 1_000);
	assert.deepEqual(rows.map((row) => [row.scope, row.status]), [["changes", "reviewing"]]);
	rows = reduceReviews(rows, snap("in_review", "a.ts +1 file"), 2_000);
	assert.deepEqual(rows, [{ scope: "a.ts +1", status: "reviewing", startedAt: 1_000 }]);
	rows = reduceReviews(rows, snap("closed", "a.ts +1 file"), 3_000);
	assert.deepEqual(rows, [{ scope: "a.ts +1", status: "approved", startedAt: 1_000, endedAt: 3_000 }]);
});

test("a row opened with no files goes away on ready or unknown; other states and named rows stay (S63)", () => {
	const approved = reduceReviews([], snap("closed", "a.ts"), 1_000);
	const opened = reduceReviews(approved, unknownScope("checking"), 2_000);
	assert.equal(opened.length, 2);
	assert.deepEqual(reduceReviews(opened, unknownScope("ready"), 3_000), approved, "ready: only the finished row is left");
	assert.deepEqual(reduceReviews(opened, snap("unknown", "a.ts"), 3_000), approved, "unknown");
	assert.equal(reduceReviews(opened, unknownScope("made-up"), 3_000), opened, "a state with no meaning keeps it");
	const named = reduceReviews([], snap("reviewing", "b.ts"), 1_000);
	assert.equal(reduceReviews(named, unknownScope("unknown"), 2_000), named, "a named running row stays");
	assert.deepEqual(reduceReviews(opened, unknownScope("unavailable"), 3_000).at(-1), { scope: "changes", status: "unavailable", startedAt: 2_000, endedAt: 3_000 }, "a failure still shows");
});
