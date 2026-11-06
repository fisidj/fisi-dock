import assert from "node:assert/strict";
import test from "node:test";
import { ciListArgs, ciLive, ciRunning, ciRunsFromList, ciView, failedJob, gitPushTool, readCi, type CiExec, type CiRuns } from "../lib/ci.ts";

// CI checks of the last pushed commit (S64, artboard 24 option C), from
// `gh run list --json` and `gh run view --json jobs` output.

const SHA = "e6f1ffd0123456789abcdef0123456789abcdef0";
const OLD = "a44a0920123456789abcdef0123456789abcdef0";
const at = (minute: number, second = 0) => `2026-10-31T14:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}Z`;
const ms = (minute: number, second = 0) => Date.parse(at(minute, second));

type GhRun = { databaseId?: number; workflowName?: string; name?: string; status?: string; conclusion?: string; startedAt?: string; updatedAt?: string; createdAt?: string; headSha?: string };
const run = (fields: GhRun): GhRun => ({ databaseId: 1, workflowName: "tests", name: "tests", status: "completed", conclusion: "success", startedAt: at(0), updatedAt: at(1), createdAt: at(0), headSha: SHA, ...fields });
const list = (runs: GhRun[]) => JSON.stringify(runs);

test("the commit is the newest run's headSha; its runs are kept, one per workflow, the newest by createdAt (S64)", () => {
	const runs = ciRunsFromList(
		list([
			run({ databaseId: 1, workflowName: "lint", headSha: OLD, createdAt: at(0) }),
			run({ databaseId: 2, workflowName: "tests", createdAt: at(5) }),
			run({ databaseId: 3, workflowName: "tests", createdAt: at(7), status: "in_progress", conclusion: "" }),
			run({ databaseId: 4, workflowName: "build", createdAt: at(6) }),
			run({ databaseId: 5, workflowName: "lint", headSha: OLD, createdAt: at(1) }),
		]),
	);
	assert.ok(runs);
	assert.equal(runs.sha, SHA);
	assert.deepEqual(runs.runs.map((entry) => [entry.id, entry.name, entry.state]).toSorted(), [[3, "tests", "running"], [4, "build", "passed"]].toSorted());
	assert.equal(ciRunsFromList(list([run({ workflowName: "", name: "fallback" })]))?.runs[0].name, "fallback", "the run name when the workflow has none");
	assert.equal(ciRunsFromList("[]"), null, "no runs: nothing to show");
	assert.equal(ciRunsFromList("not json"), undefined, "malformed: unknown");
	assert.equal(ciRunsFromList('{"a":1}'), undefined);
	assert.deepEqual(ciListArgs("feat/x"), ["run", "list", "--branch", "feat/x", "--limit", "20", "--json", "databaseId,workflowName,name,status,conclusion,startedAt,updatedAt,createdAt,headSha"]);
});

test("each status and conclusion maps to one state (S64)", () => {
	const cases: [string, string, string][] = [
		["completed", "success", "passed"],
		["completed", "skipped", "passed"],
		["completed", "neutral", "passed"],
		["completed", "failure", "failed"],
		["completed", "timed_out", "failed"],
		["completed", "startup_failure", "failed"],
		["completed", "action_required", "failed"],
		["completed", "cancelled", "cancelled"],
		["completed", "stale", "cancelled"],
		["in_progress", "", "running"],
		["queued", "", "queued"],
		["waiting", "", "queued"],
		["requested", "", "queued"],
		["pending", "", "queued"],
	];
	for (const [status, conclusion, state] of cases) assert.equal(ciRunsFromList(list([run({ status, conclusion })]))?.runs[0].state, state, `${status} ${conclusion}`);
});

test("a failed run names its first failed job and that job's first failed step; the job alone without one (S64)", () => {
	const view = (jobs: unknown[]) => JSON.stringify({ jobs });
	const steps = [{ name: "Checkout", conclusion: "success" }, { name: "Run npm test", conclusion: "failure" }, { name: "Upload", conclusion: "failure" }];
	assert.equal(failedJob(view([{ name: "lint", conclusion: "success", steps: [] }, { name: "node-22", conclusion: "failure", steps }, { name: "node-24", conclusion: "failure", steps }])), "node-22 · Run npm test");
	assert.equal(failedJob(view([{ name: "node-22", conclusion: "failure", steps: [{ name: "Checkout", conclusion: "success" }] }])), "node-22");
	assert.equal(failedJob(view([{ name: "node-22", conclusion: "failure" }])), "node-22", "no steps listed");
	assert.equal(failedJob(view([{ name: "lint", conclusion: "success" }])), undefined, "no failed job");
	assert.equal(failedJob("{"), undefined, "malformed");
});

test("every name from gh loses escape sequences, control characters and bidi overrides, and is bounded (S64)", () => {
	const dirty = "\x1b]8;;https://evil\x07te\x1b[31mst\x1b[0ms\u202e\x07\x00\n x";
	const runs = ciRunsFromList(list([run({ workflowName: dirty })]))!;
	assert.equal(runs.runs[0].name, "tests x");
	assert.equal(ciRunsFromList(list([run({ workflowName: "w".repeat(500) })]))!.runs[0].name.length, 80, "bounded");
	assert.equal(failedJob(JSON.stringify({ jobs: [{ name: "\x1b[2Jnode\u2066-22", conclusion: "failure", steps: [{ name: "Run\tnpm\x9b test\u200f", conclusion: "failure" }] }] })), "node-22 · Run npm test");
	assert.equal(ciRunsFromList(list([run({ headSha: "\x1b[31me6f1ffd\x1b[0m99" })]))!.sha, "e6f1ffd99", "the sha too");
});

test("readCi: a failed list keeps what is shown (undefined), an empty one removes it (null), failed runs read their job once (S64)", async () => {
	const calls: string[] = [];
	const reply = (outputs: Record<string, { code: number; stdout: string }>): CiExec => async (args) => {
		calls.push(args.join(" "));
		return outputs[args.slice(0, 3).join(" ")] ?? { code: 1, stdout: "" };
	};
	assert.equal(await readCi(reply({}), "main"), undefined, "gh fails");
	assert.equal(await readCi(async () => Promise.reject(new Error("timeout")), "main"), undefined, "gh throws or times out");
	assert.equal(await readCi(reply({ "run list --branch": { code: 0, stdout: "[]" } }), "main"), null);
	const failed = list([run({ databaseId: 42, workflowName: "tests", conclusion: "failure" }), run({ databaseId: 43, workflowName: "lint" })]);
	const jobs = JSON.stringify({ jobs: [{ name: "node-22", conclusion: "failure", steps: [{ name: "Run npm test", conclusion: "failure" }] }] });
	calls.length = 0;
	const first = (await readCi(reply({ "run list --branch": { code: 0, stdout: failed }, "run view 42": { code: 0, stdout: jobs } }), "main"))!;
	assert.deepEqual(calls, [ciListArgs("main").join(" "), "run view 42 --json jobs"], "one view, for the failed run only");
	assert.equal(first.runs.find((entry) => entry.id === 42)?.failedJob, "node-22 · Run npm test");
	assert.equal(first.runs.find((entry) => entry.id === 43)?.failedJob, undefined);
	calls.length = 0;
	const again = (await readCi(reply({ "run list --branch": { code: 0, stdout: failed } }), "main", first))!;
	assert.deepEqual(calls, [ciListArgs("main").join(" ")], "the known job is reused");
	assert.equal(again.runs.find((entry) => entry.id === 42)?.failedJob, "node-22 · Run npm test");
	const noView = (await readCi(reply({ "run list --branch": { code: 0, stdout: failed } }), "main"))!;
	assert.equal(noView.runs.find((entry) => entry.id === 42)?.failedJob, undefined, "a failed view: no job line");
});

test("ciView: sorted by name, short sha, durations from startedAt to updatedAt, running time from startedAt to now (S64)", () => {
	const runs: CiRuns = {
		sha: SHA,
		runs: [
			{ id: 1, name: "tests", state: "running", startedAt: ms(0), updatedAt: ms(0, 30) },
			{ id: 2, name: "build", state: "queued", createdAt: ms(0) },
			{ id: 3, name: "lint", state: "failed", startedAt: ms(0), updatedAt: ms(2, 23), failedJob: "node-22 · Run npm test" },
		],
	};
	assert.deepEqual(ciView(runs, ms(1, 12)), {
		sha: "e6f1ffd",
		endedAt: ms(2, 23),
		checks: [
			{ name: "build", state: "queued" },
			{ name: "lint", state: "failed", seconds: 143, failedJob: "node-22 · Run npm test" },
			{ name: "tests", state: "running", seconds: 72 },
		],
	});
	assert.equal(ciView(runs, ms(1, 13))!.checks[2].seconds, 73, "the running time follows now");
	assert.equal(ciRunning(ciView(runs, 0)), true);
	assert.equal(ciRunning(ciView({ sha: SHA, runs: [{ id: 2, name: "build", state: "queued" }] }, 0)), false, "queued does not spin");
	assert.equal(ciView(undefined, 0), undefined);
});

test("a bash or bash_background command with `git push` asks for a CI read (S64)", () => {
	assert.equal(gitPushTool("bash", { command: "git push origin feat/x" }), true);
	assert.equal(gitPushTool("bash_background", { command: "cd app && git  push -u origin main" }), true);
	assert.equal(gitPushTool("bash", { command: "git status" }), false);
	assert.equal(gitPushTool("read", { command: "git push" }), false);
	assert.equal(gitPushTool("bash", undefined), false);
});

// --- S66: CI review findings ------------------------------------------------------

/** A gh fake that records each call and answers by its first three arguments. */
function fakeGh(outputs: Record<string, { code: number; stdout: string }>) {
	const calls: string[] = [];
	const exec: CiExec = async (args) => {
		calls.push(args.join(" "));
		return outputs[args.slice(0, 3).join(" ")] ?? { code: 1, stdout: "" };
	};
	return { calls, exec };
}
const LIST = ciListArgs("main").join(" ");
const nodeJob = JSON.stringify({ jobs: [{ name: "node-22", conclusion: "failure", steps: [{ name: "Run npm test", conclusion: "failure" }] }] });

test("readCi reuses a failed run's job only when its id and updatedAt are the same; a re-run attempt reads again (S66)", async () => {
	const failed = (updatedAt: string) => list([run({ databaseId: 42, workflowName: "tests", conclusion: "failure", updatedAt })]);
	const first = (await readCi(fakeGh({ "run list --branch": { code: 0, stdout: failed(at(2)) }, "run view 42": { code: 0, stdout: nodeJob } }).exec, "main"))!;
	assert.equal(first.runs[0].failedJob, "node-22 · Run npm test");
	const lint = JSON.stringify({ jobs: [{ name: "lint", conclusion: "failure", steps: [] }] });
	const rerun = fakeGh({ "run list --branch": { code: 0, stdout: failed(at(9)) }, "run view 42": { code: 0, stdout: lint } });
	const again = (await readCi(rerun.exec, "main", first))!;
	assert.deepEqual(rerun.calls, [LIST, "run view 42 --json jobs"], "a new updatedAt reads the job again");
	assert.equal(again.runs[0].failedJob, "lint", "the new attempt's job, not the old one");
	const failedView = fakeGh({ "run list --branch": { code: 0, stdout: failed(at(12)) } });
	const lost = (await readCi(failedView.exec, "main", again))!;
	assert.deepEqual(failedView.calls, [LIST, "run view 42 --json jobs"]);
	assert.equal(lost.runs[0].failedJob, undefined, "the old job is not shown for a newer attempt whose view failed");
});

test("readCi remembers a successful view that names no failed job for that id and updatedAt; a failed or timed-out view is retried (S66)", async () => {
	const failed = list([run({ databaseId: 42, workflowName: "tests", conclusion: "failure" })]);
	for (const stdout of [JSON.stringify({ jobs: [] }), JSON.stringify({ jobs: [{ name: "lint", conclusion: "success" }] })]) {
		const first = (await readCi(fakeGh({ "run list --branch": { code: 0, stdout: failed }, "run view 42": { code: 0, stdout } }).exec, "main"))!;
		assert.equal(first.runs[0].failedJob, undefined);
		const next = fakeGh({ "run list --branch": { code: 0, stdout: failed }, "run view 42": { code: 0, stdout: nodeJob } });
		const again = (await readCi(next.exec, "main", first))!;
		assert.deepEqual(next.calls, [LIST], `not read again: ${stdout}`);
		assert.equal(again.runs[0].failedJob, undefined, "still no job line");
	}
	for (const view of [async () => ({ code: 1, stdout: "" }), async () => Promise.reject(new Error("timeout"))]) {
		let views = 0;
		const exec: CiExec = async (args) => (args[1] === "list" ? { code: 0, stdout: failed } : (views++, view()));
		const first = (await readCi(exec, "main"))!;
		assert.equal(views, 1);
		assert.equal(first.runs[0].failedJob, undefined);
		const next = fakeGh({ "run list --branch": { code: 0, stdout: failed }, "run view 42": { code: 0, stdout: nodeJob } });
		const again = (await readCi(next.exec, "main", first))!;
		assert.deepEqual(next.calls, [LIST, "run view 42 --json jobs"], "retried on the next read");
		assert.equal(again.runs[0].failedJob, "node-22 · Run npm test");
	}
});

test("readCi records when the list read succeeded; past 90 s from it a running check holds its time and spinner, gh is still read live (S66)", async () => {
	let clock = ms(1);
	const running = list([run({ databaseId: 7, status: "in_progress", conclusion: "", startedAt: at(0), updatedAt: at(0, 30) })]);
	const read = (await readCi(fakeGh({ "run list --branch": { code: 0, stdout: running } }).exec, "main", undefined, () => clock))!;
	assert.equal(read.readAt, ms(1), "the time of the successful list read");
	clock = ms(5);
	assert.equal(await readCi(fakeGh({}).exec, "main", read, () => clock), undefined, "a failed read records nothing");
	const fresh = ciView(read, ms(2, 30));
	assert.equal(fresh?.checks[0].seconds, 150, "at most 90 s old: counts to now");
	assert.equal(ciRunning(fresh), true);
	assert.equal(ciLive(fresh), true);
	const stale = ciView(read, ms(2, 31));
	assert.equal(stale?.checks[0].seconds, 60, "past 90 s: its time stays at the last successful read");
	assert.equal(ciRunning(stale), false, "the spinner holds the still frame");
	assert.equal(ciLive(stale), true, "gh is still read every 30 s");
	assert.equal(ciRunning(ciView({ ...read, readAt: ms(2, 30) }, ms(2, 31))), true, "the next successful read resumes");
	assert.equal(ciView({ ...read, readAt: ms(2, 30) }, ms(2, 31))?.checks[0].seconds, 151);
});
