import assert from "node:assert/strict";
import test from "node:test";
import {
	agentsFromJobs,
	entranceRows,
	hasEntrance,
	parseAhead,
	parseBranch,
	parseGitChanges,
	projectName,
	runsSpinner,
	reviewText,
	sessionCost,
	sessionSnapshot,
	sessionTokens,
	sessionUsage,
	todoFromProgress,
	todoFromState,
	todoStateFromEntries,
	todoStateFromToolEnd,
	type TodoTaskLike,
} from "../lib/live-data.ts";

const tasks = (statuses: string[]): TodoTaskLike[] => statuses.map((status, index) => ({ id: index + 1, title: `Task ${index + 1}`, status }));
/** The compact counts only; the full task list is checked on its own. */
const counts = (info: ReturnType<typeof todoFromState>) => {
	if (!info) return info;
	const { tasks: _list, ...rest } = info;
	return rest;
};

test("todo state with no tasks maps to no todo", () => {
	assert.equal(todoFromState({ tasks: [] }), undefined);
	assert.equal(todoFromState(undefined), undefined);
});

test("todo state with 3 tasks and one in progress", () => {
	assert.deepEqual(counts(todoFromState({ tasks: tasks(["done", "in_progress", "pending"]) })), { done: 1, total: 3, active: "Task 2", next: "Task 3", more: 0 });
});

test("todo state with 7 tasks counts open tasks not shown as more", () => {
	assert.deepEqual(counts(todoFromState({ tasks: tasks(["done", "done", "done", "in_progress", "pending", "pending", "blocked"]) })), {
		done: 3,
		total: 7,
		active: "Task 4",
		next: "Task 5",
		more: 2,
	});
});

test("todo state without an in-progress task shows only next", () => {
	assert.deepEqual(counts(todoFromState({ tasks: tasks(["done", "pending", "pending"]) })), { done: 1, total: 3, next: "Task 2", more: 1 });
});

test("todo state with 50 tasks; dropped tasks are neither done nor more", () => {
	const statuses = [...Array(10).fill("done"), "dropped", "in_progress", ...Array(38).fill("pending")];
	assert.deepEqual(counts(todoFromState({ tasks: tasks(statuses) })), { done: 10, total: 50, active: "Task 12", next: "Task 13", more: 37 });
});

test("todo state ignores malformed tasks", () => {
	assert.equal(todoFromState({ tasks: "nope" } as never), undefined);
	assert.deepEqual(counts(todoFromState({ tasks: [null, { title: "Ok", status: "pending" }] } as never)), { done: 0, total: 1, next: "Ok", more: 0 });
});

test("todo state carries every task in order with its state (S26)", () => {
	const info = todoFromState({ tasks: tasks(["done", "done", "in_progress", "pending", "blocked", "dropped", "weird"]) });
	assert.deepEqual(info?.tasks, [
		{ title: "Task 1", state: "done" },
		{ title: "Task 2", state: "done" },
		{ title: "Task 3", state: "active" },
		{ title: "Task 4", state: "pending" },
		{ title: "Task 5", state: "blocked" },
		{ title: "Task 6", state: "dropped" },
		{ title: "Task 7", state: "pending" },
	]);
	assert.deepEqual(todoFromState({ tasks: [null, { title: "Ok", status: "done" }] } as never)?.tasks, [{ title: "Ok", state: "done" }]);
});

test("todo progress keeps the task list only while it still matches (S26)", () => {
	const previous = todoFromState({ tasks: tasks(["done", "in_progress", "pending"]) });
	// Same counts and active task: the list is still true.
	assert.deepEqual(todoFromProgress({ sessionId: "s1", done: 1, total: 3, current: "Task 2" }, "s1", previous)?.tasks, previous?.tasks);
	// Anything moved: the titles are not guessed; the tool result brings the new list.
	assert.equal(todoFromProgress({ sessionId: "s1", done: 2, total: 3, current: "Task 3" }, "s1", previous)?.tasks, undefined);
	assert.equal(todoFromProgress({ sessionId: "s1", done: 1, total: 4, current: "Task 2" }, "s1", previous)?.tasks, undefined);
	assert.equal(todoFromProgress({ sessionId: "s1", done: 1, total: 3, current: null }, "s1", previous)?.tasks, undefined);
	assert.equal(todoFromProgress({ sessionId: "s1", done: 1, total: 3, current: "Task 2" }, "s1", undefined)?.tasks, undefined);
});

test("latest todo tool result on the branch is the state", () => {
	const result = (titles: string[], extra: object = {}) => ({
		type: "message",
		message: { role: "toolResult", toolName: "todo", details: { gentleTodo: { tasks: titles.map((title, index) => ({ id: index + 1, title, status: "pending" })) } }, ...extra },
	});
	const entries = [result(["Old"]), { type: "message", message: { role: "assistant" } }, result(["New A", "New B"]), result(["Broken"], { isError: true })];
	assert.deepEqual(todoStateFromEntries(entries)?.tasks.map((task) => task.title), ["New A", "New B"]);
	assert.equal(todoStateFromEntries([]), undefined);
	assert.equal(todoStateFromEntries(undefined as never), undefined);
});

test("todo tool end carries the full state", () => {
	const state = { tasks: tasks(["in_progress"]) };
	assert.deepEqual(todoStateFromToolEnd({ toolName: "todo", isError: false, result: { details: { gentleTodo: state } } }), state);
	assert.equal(todoStateFromToolEnd({ toolName: "read", isError: false, result: { details: { gentleTodo: state } } }), undefined);
	assert.equal(todoStateFromToolEnd({ toolName: "todo", isError: true, result: { details: { gentleTodo: state } } }), undefined);
	assert.equal(todoStateFromToolEnd({ toolName: "todo", isError: false, result: undefined }), undefined);
});

test("todo progress event updates counts and active, ignoring other sessions", () => {
	const previous = { done: 1, total: 3, active: "Task 2", next: "Task 3", more: 0 };
	assert.deepEqual(todoFromProgress({ sessionId: "s1", done: 2, total: 3, current: "Task 3" }, "s1", previous), { done: 2, total: 3, active: "Task 3", more: 0 });
	assert.deepEqual(todoFromProgress({ sessionId: "s1", done: 1, total: 4, current: null }, "s1", previous), { done: 1, total: 4, next: "Task 3", more: 2 });
	assert.equal(todoFromProgress({ sessionId: "other", done: 2, total: 3, current: null }, "s1", previous), previous);
	assert.equal(todoFromProgress("garbage", "s1", previous), previous);
	assert.equal(todoFromProgress({ sessionId: "s1", done: 0, total: 0, current: null }, "s1", previous), undefined);
});

test("jobs snapshot maps to agents for the current session only", () => {
	const event = {
		sessionId: "s1",
		snapshot: {
			jobs: [
				{ id: "job-2", label: "npm test", startedAt: 2 },
				{ id: "job-1", label: "build", startedAt: 1, status: "exited", endedAt: 3, exitCode: 0 },
				{ id: "job-3", label: "lint", startedAt: 1, status: "failed", endedAt: 3, exitCode: 1 },
			],
		},
	};
	assert.deepEqual(agentsFromJobs(event, "s1"), [
		{ name: "job-2", task: "npm test", state: "running", startedAt: 2 },
		{ name: "job-1", task: "build", state: "done", startedAt: 1 },
		{ name: "job-3", task: "lint", state: "failed", startedAt: 1 },
	]);
	assert.equal(agentsFromJobs({ ...event, sessionId: "other" }, "s1"), undefined);
	assert.equal(agentsFromJobs({ sessionId: "s1", snapshot: { jobs: [{ id: "" }] } }, "s1"), undefined);
	assert.equal(agentsFromJobs(null, "s1"), undefined);
	assert.deepEqual(agentsFromJobs({ sessionId: "s1", snapshot: { jobs: [] } }, "s1"), []);
});

test("a job without a finite startedAt has no start time; it is never invented (S35)", () => {
	const jobs = [{ id: "job-1", label: "npm test" }, { id: "job-2", label: "lint", startedAt: "soon" }, { id: "job-3", label: "build", startedAt: Number.NaN }];
	assert.deepEqual(agentsFromJobs({ sessionId: "s1", snapshot: { jobs } }, "s1"), [
		{ name: "job-1", task: "npm test", state: "running" },
		{ name: "job-2", task: "lint", state: "running" },
		{ name: "job-3", task: "build", state: "running" },
	]);
});

test("jobs snapshot keeps every job; the renderer caps the rows", () => {
	const jobs = Array.from({ length: 7 }, (_, index) => ({ id: `job-${index}`, label: `task ${index}`, startedAt: index }));
	assert.equal(agentsFromJobs({ sessionId: "s1", snapshot: { jobs } }, "s1")?.length, 7);
});

test("git status and numstat map to changes", () => {
	const status = [" M lib/a.ts", "A  lib/new.ts", " D old.ts", "R  lib/renamed.ts", "lib/original.ts", "?? notes.md", "!! ignored.log", ""].join("\0");
	const numstat = ["3\t1\tlib/a.ts", "10\t0\tlib/new.ts", "0\t7\told.ts", "2\t2\t", "lib/original.ts", "lib/renamed.ts", ""].join("\0");
	assert.deepEqual(parseGitChanges(status, numstat), [
		{ status: "M", path: "lib/a.ts", added: 3, removed: 1 },
		{ status: "A", path: "lib/new.ts", added: 10, removed: 0 },
		{ status: "D", path: "old.ts", added: 0, removed: 7 },
		{ status: "R", path: "lib/renamed.ts", added: 2, removed: 2 },
		{ status: "?", path: "notes.md", added: 0, removed: 0 },
	]);
});

test("git changes: binary files count zero, a missing numstat keeps the file", () => {
	assert.deepEqual(parseGitChanges("MM img.png\0 M x.ts\0", "-\t-\timg.png\0"), [
		{ status: "M", path: "img.png", added: 0, removed: 0 },
		{ status: "M", path: "x.ts", added: 0, removed: 0 },
	]);
});

test("git changes: paths with spaces and non-ASCII stay intact", () => {
	assert.deepEqual(parseGitChanges(" M docs/Año final.md\0", "1\t0\tdocs/Año final.md\0"), [{ status: "M", path: "docs/Año final.md", added: 1, removed: 0 }]);
});

test("git changes: empty tree gives an empty list", () => {
	assert.deepEqual(parseGitChanges("", ""), []);
});

test("git changes keeps every file; the renderer caps the rows", () => {
	const status = Array.from({ length: 9 }, (_, index) => ` M f${index}.ts`).join("\0") + "\0";
	assert.equal(parseGitChanges(status, "").length, 9);
});

test("branch parsing: name, detached HEAD and failures", () => {
	assert.equal(parseBranch("main\n"), "main");
	assert.equal(parseBranch("feat/fisi-dock\r\n"), "feat/fisi-dock");
	assert.equal(parseBranch("HEAD\n"), undefined);
	assert.equal(parseBranch(""), undefined);
	assert.equal(parseBranch(undefined), undefined);
});

test("ahead parsing: count, zero and no upstream", () => {
	assert.equal(parseAhead("3\n"), 3);
	assert.equal(parseAhead("0\n"), 0);
	assert.equal(parseAhead(""), undefined);
	assert.equal(parseAhead("fatal: no upstream configured"), undefined);
	assert.equal(parseAhead(undefined), undefined);
});

test("project name is the cwd basename on any platform", () => {
	assert.equal(projectName("E:\\DEV\\Año Nuevo Demo Project"), "Año Nuevo Demo Project");
	assert.equal(projectName("/home/me/app/"), "app");
	assert.equal(projectName(""), "");
});

test("context usage maps to session fields", () => {
	assert.deepEqual(sessionUsage({ tokens: 12_100, contextWindow: 200_000, percent: 6.05 }), { contextPercent: 6.05, tokensUsed: 12_100, tokensMax: 200_000 });
	assert.deepEqual(sessionUsage({ tokens: null, contextWindow: 200_000, percent: null }), {});
	assert.deepEqual(sessionUsage(undefined), {});
	assert.deepEqual(sessionUsage(null as never), {});
});

test("session cost sums assistant message costs like Gentle Shell", () => {
	const entries = [
		{ type: "message", message: { role: "assistant", usage: { cost: { total: 0.0125 } } } },
		{ type: "message", message: { role: "user", usage: { cost: { total: 5 } } } },
		{ type: "message", message: { role: "assistant" } },
		{ type: "custom", message: { role: "assistant", usage: { cost: { total: 9 } } } },
		{ type: "message", message: { role: "assistant", usage: { cost: { total: 0.002 } } } },
	];
	assert.equal(sessionCost(entries), 0.0145);
	assert.equal(sessionCost([]), 0);
	assert.equal(sessionCost(undefined as never), 0);
});

test("session tokens sum assistant usage.totalTokens, else its four parts (S37)", () => {
	const usage = (extra: Record<string, unknown>) => ({ input: 10, output: 20, cacheRead: 300, cacheWrite: 4, cost: { total: 0 }, ...extra });
	const entries = [
		{ type: "message", message: { role: "assistant", provider: "claude-bridge", usage: usage({ totalTokens: 1_000 }) } },
		{ type: "message", message: { role: "assistant", provider: "claude-bridge", usage: usage({}) } },
		{ type: "message", message: { role: "user", usage: usage({ totalTokens: 5_000 }) } },
		{ type: "custom", message: { role: "assistant", usage: usage({ totalTokens: 7_000 }) } },
		{ type: "message", message: { role: "assistant" } },
	];
	assert.equal(sessionTokens(entries), 1_334);
	assert.equal(sessionTokens([]), 0);
	assert.equal(sessionTokens(undefined as never), 0);
});

test("session snapshot carries the profile label into the session section (S99)", () => {
	assert.equal(sessionSnapshot({ project: "app", profile: "claude (session)" }).session.profile, "claude (session)");
	assert.ok(!("profile" in sessionSnapshot({ project: "app" }).session));
});

test("session snapshot carries tokens and the estimate next to the real cost (S37)", () => {
	assert.deepEqual(sessionSnapshot({ project: "app", cost: 0, tokens: 12_400_000, estimate: 38.4, rdd: "on" }).footer, { cost: 0, tokens: 12_400_000, estimate: 38.4, rdd: "on" });
	assert.deepEqual(sessionSnapshot({ project: "app", cost: 0.5, tokens: 0 }).footer, { cost: 0.5 });
});

test("review event maps to footer text for the current session", () => {
	assert.equal(reviewText({ sessionId: "s1", snapshot: { state: "closed", scope: "a.ts" } }, "s1"), "✓ Approved");
	assert.equal(reviewText({ sessionId: "s1", snapshot: { state: "reviewing", scope: "a.ts" } }, "s1"), "Reviewers running…");
	assert.equal(reviewText({ sessionId: "s1", snapshot: { state: "unknown", scope: "a.ts" } }, "s1"), null);
	assert.equal(reviewText({ sessionId: "s1", snapshot: { state: "made-up", scope: "a.ts" } }, "s1"), null);
	assert.equal(reviewText({ sessionId: "other", snapshot: { state: "closed", scope: "a.ts" } }, "s1"), undefined);
	assert.equal(reviewText(undefined, "s1"), undefined);
});

test("session snapshot combines the live parts into a panel model", () => {
	assert.deepEqual(sessionSnapshot({ project: "app" }), { session: { project: "app" } });
	const model = sessionSnapshot({
		project: "app",
		branch: "main",
		ahead: 2,
		usage: { contextPercent: 5, tokensUsed: 10, tokensMax: 200 },
		todo: { done: 1, total: 2, more: 0 },
		agents: [{ name: "job-1", task: "t", state: "running" }],
		changes: [],
		cost: 0.5,
		review: "✓ Approved",
	});
	assert.deepEqual(model, {
		session: { project: "app", branch: "main", ahead: 2, contextPercent: 5, tokensUsed: 10, tokensMax: 200 },
		headsUp: [{ kind: "unpushed", text: "2 commits not pushed" }],
		todo: { done: 1, total: 2, more: 0 },
		agents: [{ name: "job-1", task: "t", state: "running" }],
		changes: [],
		footer: { cost: 0.5, review: "✓ Approved" },
	});
	assert.equal("odd" in model, false);
});

test("session snapshot carries the MCP servers in session, none when empty or unknown (S32)", () => {
	const mcp = [{ name: "engram", state: "connected" as const }];
	assert.deepEqual(sessionSnapshot({ project: "app", mcp }).session.mcp, mcp);
	assert.equal("mcp" in sessionSnapshot({ project: "app", mcp: [] }).session, false);
	assert.equal("mcp" in sessionSnapshot({ project: "app" }).session, false);
});

test("session snapshot carries the RDD switch from gentle-ai in the footer (S19, S85)", () => {
	assert.deepEqual(sessionSnapshot({ project: "app", cost: 0, rdd: "on" }).footer, { cost: 0, rdd: "on" });
	assert.deepEqual(sessionSnapshot({ project: "app", cost: 0, rdd: "off", review: "✓ Approved" }).footer, { cost: 0, review: "✓ Approved", rdd: "off" });
	assert.deepEqual(sessionSnapshot({ project: "app", cost: 0 }).footer, { cost: 0 }, "no rdd key while the mode is unknown");
});

test("session snapshot carries the odd timeline when it has steps", () => {
	const odd = { steps: [{ phase: "exploring", state: "active" as const, seconds: 3 }] };
	assert.deepEqual(sessionSnapshot({ project: "app", odd }).odd, odd);
	assert.equal("odd" in sessionSnapshot({ project: "app", odd: { steps: [] } }), false);
});

test("session snapshot lists Gentle Shell's background jobs as agents, and no agents without them", () => {
	const model = sessionSnapshot({ project: "app", agents: [{ name: "job-1", task: "npm test", state: "running" }] });
	assert.deepEqual(model.agents?.map((agent) => `${agent.name}:${agent.state}`), ["job-1:running"]);
	assert.equal("profile" in model.session, false, "no profile row: no source for one");
	assert.deepEqual(sessionSnapshot({ project: "app", agents: [{ name: "job-1", task: "t", state: "done" }] }).agents, [{ name: "job-1", task: "t", state: "done" }]);
	assert.equal("agents" in sessionSnapshot({ project: "app" }), false);
});

test("session snapshot carries the spinner frame only while a todo task or an agent runs (S31)", () => {
	const todo = (active?: string) => ({ done: 0, total: 2, ...(active ? { active } : {}), more: 1 });
	assert.equal(sessionSnapshot({ project: "p", spinner: 4 }).spinner, undefined, "nothing runs");
	assert.equal(sessionSnapshot({ project: "p", spinner: 4, todo: todo() }).spinner, undefined, "no active task");
	assert.equal(sessionSnapshot({ project: "p", spinner: 4, agents: [{ name: "a", task: "t", state: "done" }] }).spinner, undefined, "agents done");
	assert.equal(sessionSnapshot({ project: "p", spinner: 4, todo: todo("Doing"), runSettled: false }).spinner, 4, "active todo task while a run is active");
	assert.equal(sessionSnapshot({ project: "p", spinner: 4, todo: todo("Doing") }).spinner, undefined, "active todo task, no run yet (L61)");
	assert.equal(sessionSnapshot({ project: "p", spinner: 4, todo: todo("Doing"), runSettled: true }).spinner, undefined, "active todo task after the run settled (L61)");
	assert.equal(sessionSnapshot({ project: "p", spinner: 4, agents: [{ name: "a", task: "t", state: "running" }], runSettled: true }).spinner, 4, "a running job spins with no run");
	assert.equal(sessionSnapshot({ project: "p", spinner: 4, agents: [{ name: "a", task: "t", state: "running" }] }).spinner, 4, "running job");
	assert.equal(sessionSnapshot({ project: "p", todo: todo("Doing") }).spinner, undefined, "no frame yet: still glyph");
	assert.equal(runsSpinner(sessionSnapshot({ project: "p", todo: todo("Doing") })), true);
	assert.equal(runsSpinner(sessionSnapshot({ project: "p", agents: [{ name: "a", task: "t", state: "queued" }] })), false);
	assert.equal(runsSpinner({ session: { project: "p" }, todo: { done: 0, total: 1, more: 0, tasks: [{ title: "x", state: "active" }] } }), true, "an active task in the list");
	assert.equal(runsSpinner(sessionSnapshot({ project: "p", todo: todo("Doing") }), false), false, "an active task with no run active (L61)");
});

test("session snapshot draws the session's review rows as the RDD view at `now` (S50)", () => {
	const reviews = [
		{ scope: "a.ts", status: "approved" as const, startedAt: 1_000, endedAt: 5_000 },
		{ scope: "b.ts", status: "reviewing" as const, startedAt: 10_000 },
	];
	assert.deepEqual(sessionSnapshot({ project: "p", reviews }, 25_400).rdd, {
		reviews: [
			{ scope: "a.ts", status: "approved", endedAt: 5_000 },
			{ scope: "b.ts", status: "reviewing", seconds: 15 },
		],
	});
	assert.equal("rdd" in sessionSnapshot({ project: "p", reviews: [] }, 0), false, "no rows, no RDD view");
	assert.equal("rdd" in sessionSnapshot({ project: "p" }, 0), false);
});

test("an active or waiting RDD row runs the spinner; finished rows do not (S50)", () => {
	const at = (status: "reviewing" | "fixing" | "waiting" | "approved" | "outdated") => sessionSnapshot({ project: "p", reviews: [{ scope: "a.ts", status, startedAt: 0, ...(status === "approved" || status === "outdated" ? { endedAt: 1 } : {}) }] }, 1_000);
	for (const status of ["reviewing", "fixing", "waiting"] as const) assert.equal(runsSpinner(at(status), false), true, status);
	for (const status of ["approved", "outdated"] as const) assert.equal(runsSpinner(at(status), false), false, status);
	assert.equal(sessionSnapshot({ project: "p", spinner: 5, reviews: [{ scope: "a.ts", status: "reviewing", startedAt: 0 }] }, 1_000).spinner, 5, "the frame is carried");
});

// Row entrance (S54): the store passes when each row appeared; the snapshot turns that into a step.
const entranceParts = {
	project: "p",
	agents: [{ name: "job-1", task: "npm test", state: "running" as const, startedAt: 500 }],
	todo: { done: 1, total: 3, active: "Run it", next: "Commit", more: 0 },
	odd: { steps: [{ phase: "exploring" as const, state: "done" as const, seconds: 3 }, { phase: "checking" as const, state: "active" as const, seconds: 1, scan: 7 }], earlier: 2 },
	reviews: [{ scope: "a.ts", status: "approved" as const, startedAt: 100, endedAt: 200 }, { scope: "b.ts", status: "reviewing" as const, startedAt: 900 }],
};

test("entranceRows names every row that can enter: running agents, the active task, the active ODD step, every review (S54)", () => {
	assert.deepEqual(entranceRows(entranceParts), [
		{ key: "job:job-1", text: `${"job-1".padEnd(12)} npm test`, startedAt: 500 },
		{ key: "todo:Run it", text: "Run it" },
		{ key: "odd:3:checking", text: "checking" },
		{ key: "rdd:0:100", text: "a.ts approved" },
		{ key: "rdd:1:900", text: "b.ts reviewing…" },
	]);
	assert.deepEqual(entranceRows({ project: "p" }), []);
});

test("sessionSnapshot gives an appearing row its entrance step from now, and drops it once it ended (S54)", () => {
	const appeared = new Map([["job:job-1", 1_000], ["todo:Run it", 1_000], ["odd:3:checking", 925], ["rdd:1:900", 1_000]]);
	const model = sessionSnapshot(entranceParts, 1_150, appeared);
	assert.deepEqual(model.agents!.map((agent) => agent.entrance), [2], "150 ms: step 2");
	assert.equal(model.todo!.entrance, 2);
	assert.equal(model.odd!.steps[1].entrance, 3);
	assert.equal(model.odd!.steps[0].entrance, undefined);
	assert.deepEqual(model.rdd!.reviews.map((review) => review.entrance), [undefined, 2]);
	const plain = sessionSnapshot(entranceParts, 1_150);
	assert.deepEqual(sessionSnapshot(entranceParts, 1_150, new Map()), plain, "nothing appeared: today's model");
	assert.ok(!("entrance" in plain.todo!), "no entrance field at all without one");
	// "Run it" lasts entranceSteps("Run it") = 14 steps: 13 still plays, 14 is over.
	assert.equal(sessionSnapshot(entranceParts, 1_000 + 13 * 75, appeared).todo!.entrance, 13);
	const over = sessionSnapshot(entranceParts, 1_000 + 14 * 75, appeared);
	assert.ok(!("entrance" in over.todo!), "over: the field is gone");
	assert.equal(hasEntrance(sessionSnapshot(entranceParts, 99_000, appeared)), false);
	assert.equal(hasEntrance(model), true);
	assert.equal(sessionSnapshot(entranceParts, 900, appeared).todo!.entrance, 0, "a clock behind the stamp starts at step 0");
});

test("a running CI check whose last successful read is over 90 s old holds its time and stops the spinner; up to 90 s it ticks (S66)", () => {
	const startedAt = Date.parse("2026-10-31T14:00:00Z");
	const ci = { sha: "e6f1ffd0123456789abcdef0123456789abcdef0", readAt: startedAt + 60_000, runs: [{ id: 7, name: "tests", state: "running" as const, startedAt }] };
	const fresh = sessionSnapshot({ project: "app", spinner: 4, ci }, startedAt + 150_000);
	assert.equal(fresh.spinner, 4, "up to 90 s: the spinner turns");
	assert.equal(fresh.ci?.checks[0].seconds, 150);
	const held = sessionSnapshot({ project: "app", spinner: 4, ci }, startedAt + 151_000);
	assert.equal(held.spinner, undefined, "past 90 s: no spinner frame, so the still frame shows");
	assert.equal(held.ci?.checks[0].seconds, 60, "the time stays at the last successful read");
	assert.equal(runsSpinner(held), false);
});
