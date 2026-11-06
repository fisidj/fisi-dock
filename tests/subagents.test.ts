import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	agentHomeDir,
	createSubagentTracker,
	NOTIFICATION_SOURCE_EVENT,
	readPresenceTasks,
	SUBAGENT_FINISHED_TTL_MS,
	subagentCall,
	subagentResult,
	subagentStatus,
} from "../lib/subagents.ts";

// Gentle Shell 4.6.0's `gentle-pi:notification:source` payload for a subagent
// task (lib/notification-events.ts subagentNotificationEvent), restated.
const statusEvent = (taskId: string, status: string, sequence: number, sessionId = "s1") => ({
	source: "subagent",
	producerId: "p1",
	sessionId,
	parentSessionId: sessionId,
	taskId,
	status,
	runId: "p1:r1",
	sequence,
	event: `subagent.${status}`,
	occurredAt: 12.5,
});

/** The tool result of subagent_run / subagent_continue (gentle-agents.ts taskDetails). */
const taskResult = (taskId: string, extra: Record<string, unknown> = {}) => ({
	content: [{ type: "text", text: "..." }],
	details: { gentleAgents: { taskId, agent: "explore", status: "running", mode: "background", cwd: "E:/DEV/app", label: "map the footer", turns: 0, toolCalls: 0, lastStep: "starting", model: "anthropic/claude-opus-5-5", thinking: "high", ...extra } },
});

test("S87 subagentStatus: a subagent event for this session gives task id, status and sequence; other sources, sessions and malformed payloads give nothing", () => {
	assert.equal(NOTIFICATION_SOURCE_EVENT, "gentle-pi:notification:source");
	assert.deepEqual(subagentStatus(statusEvent("t1", "running", 3), "s1"), { taskId: "t1", status: "running", sequence: 3 });
	assert.equal(subagentStatus(statusEvent("t1", "running", 3, "other"), "s1"), undefined, "another session");
	assert.equal(subagentStatus({ ...statusEvent("t1", "running", 3), source: "main", event: "agent.completed" }, "s1"), undefined, "the main agent's events");
	assert.equal(subagentStatus({ ...statusEvent("t1", "exploding", 3) }, "s1"), undefined, "unknown status");
	assert.equal(subagentStatus({ ...statusEvent("t1", "running", 0) }, "s1"), undefined, "sequence below 1");
	assert.equal(subagentStatus({ ...statusEvent("", "running", 1) }, "s1"), undefined, "empty task id");
	assert.equal(subagentStatus(null, "s1"), undefined);
	assert.equal(subagentStatus("subagent", "s1"), undefined);
});

test("S87 subagentCall and subagentResult read the subagent_run / subagent_continue tool args and results; other tools give nothing", () => {
	assert.deepEqual(subagentCall("subagent_run", { agent: "explore", task: "Map the footer\nwith details", label: "map footer", mode: "background" }), { agent: "explore", text: "Map the footer\nwith details", label: "map footer", mode: "background" });
	assert.deepEqual(subagentCall("subagent_run", { agent: "explore", task: "Map" }), { agent: "explore", text: "Map" });
	assert.deepEqual(subagentCall("subagent_continue", { task_id: "t1", prompt: "go on", label: "second pass" }), { taskId: "t1", text: "go on", label: "second pass" });
	assert.equal(subagentCall("subagent_run", { task: "no agent" }), undefined);
	assert.equal(subagentCall("bash", { command: "subagent_run" }), undefined);
	assert.equal(subagentCall("subagent_run", "not an object"), undefined);
	assert.deepEqual(subagentResult("subagent_run", taskResult("t1")), { taskId: "t1", agent: "explore", status: "running", mode: "background", label: "map the footer", model: "anthropic/claude-opus-5-5", effort: "high", lastStep: "starting" });
	assert.deepEqual(subagentResult("subagent_continue", taskResult("t2", { thinking: undefined, label: undefined })), { taskId: "t2", agent: "explore", status: "running", mode: "background", lastStep: "starting", model: "anthropic/claude-opus-5-5" });
	assert.equal(subagentResult("subagent_run", { content: [], details: { gentleAgents: { agent: "x" } } }), undefined, "no task id");
	assert.equal(subagentResult("todo", { details: { gentleAgents: { taskId: "t1" } } }), undefined, "another tool");
	assert.equal(subagentResult("subagent_run", undefined), undefined);
});

test("S87 tracker: a status event creates the task and moves its state; the running time counts from the first running event; finished tasks fold after the jobs TTL", () => {
	let now = 100_000;
	const tracker = createSubagentTracker("s1", () => now);
	assert.deepEqual(tracker.agents(now), []);
	assert.equal(tracker.status(statusEvent("t1", "queued", 1)), true);
	assert.deepEqual(tracker.agents(now), [{ id: "task:t1", name: "subagent", task: "task t1", state: "queued" }], "a task with no details yet still shows as queued, named by its id");
	now = 101_000;
	assert.equal(tracker.status(statusEvent("t1", "running", 2)), true);
	assert.deepEqual(tracker.agents(now), [{ id: "task:t1", name: "subagent", task: "task t1", state: "running", startedAt: 101_000 }]);
	now = 102_000;
	assert.equal(tracker.status(statusEvent("t1", "waiting", 3)), true);
	assert.deepEqual(tracker.agents(now), [{ id: "task:t1", name: "subagent", task: "task t1", state: "waiting", startedAt: 101_000 }], "waiting keeps the start");
	assert.equal(tracker.status(statusEvent("t1", "running", 4)), true);
	assert.equal(tracker.agents(now)[0].startedAt, 101_000, "running again after waiting keeps the first start");
	now = 110_000;
	assert.equal(tracker.status(statusEvent("t1", "completed", 5)), true);
	assert.deepEqual(tracker.agents(now), [{ id: "task:t1", name: "subagent", task: "task t1", state: "done", startedAt: 101_000 }]);
	assert.equal(SUBAGENT_FINISHED_TTL_MS, 60_000, "the same tail as Gentle Shell's finished jobs");
	assert.deepEqual(tracker.agents(now + SUBAGENT_FINISHED_TTL_MS - 1).length, 1, "shown a while");
	assert.equal(tracker.prune(now + SUBAGENT_FINISHED_TTL_MS - 1), false);
	assert.deepEqual(tracker.agents(now + SUBAGENT_FINISHED_TTL_MS), [], "then gone");
	assert.equal(tracker.prune(now + SUBAGENT_FINISHED_TTL_MS), true);
	assert.equal(tracker.prune(now + SUBAGENT_FINISHED_TTL_MS), false, "nothing left to drop");
	for (const [status, state] of [["failed", "failed"], ["cancelled", "failed"], ["timed_out", "failed"]] as const) {
		const other = createSubagentTracker("s1", () => now);
		other.status(statusEvent("t2", status, 1));
		assert.equal(other.agents(now)[0].state, state, status);
	}
});

test("S87 tracker: sequence guard; an event whose sequence is not above the last one seen for that task changes nothing, another session's event changes nothing", () => {
	const tracker = createSubagentTracker("s1", () => 5_000);
	assert.equal(tracker.status(statusEvent("t1", "running", 7)), true);
	assert.equal(tracker.status(statusEvent("t1", "completed", 7)), false, "same sequence");
	assert.equal(tracker.status(statusEvent("t1", "completed", 6)), false, "older sequence (a late delivery)");
	assert.equal(tracker.agents(5_000)[0].state, "running");
	assert.equal(tracker.status(statusEvent("t1", "completed", 8)), true);
	assert.equal(tracker.agents(5_000)[0].state, "done");
	assert.equal(tracker.status(statusEvent("t9", "running", 1, "other")), false);
	assert.equal(tracker.status({ source: "main", sessionId: "s1", sequence: 99 }), false);
	assert.equal(tracker.agents(5_000).length, 1);
});

test("S87 tracker, background mode: the subagent_run args are remembered until its result names the task id, which then carries agent, label, model and effort", () => {
	let now = 1_000;
	const tracker = createSubagentTracker("s1", () => now);
	tracker.call("subagent_run", { agent: "explore", task: "Map the footer sources", label: "map footer", mode: "background" });
	assert.deepEqual(tracker.agents(now), [{ id: "call:#1", name: "explore", task: "map footer", state: "running", startedAt: 1_000 }], "a call in flight is a running row until Gentle Shell names its task");
	assert.equal(tracker.result("subagent_run", taskResult("t1", { status: "queued", label: "map footer" })), true);
	assert.deepEqual(tracker.agents(now), [{ id: "call:#1", name: "explore", task: "map footer", state: "queued", model: "anthropic/claude-opus-5-5", effort: "high" }], "the task keeps the call's row");
	now = 2_000;
	tracker.status(statusEvent("t1", "running", 1));
	assert.deepEqual(tracker.agents(now), [{ id: "call:#1", name: "explore", task: "map footer", state: "running", startedAt: 2_000, model: "anthropic/claude-opus-5-5", effort: "high" }]);
	// A second background call, started while the first runs, keeps its own args.
	tracker.call("subagent_run", { agent: "verify", task: "Check the PR", mode: "background" });
	assert.equal(tracker.result("subagent_run", taskResult("t2", { agent: "verify", label: undefined, status: "queued", thinking: undefined })), true);
	assert.deepEqual(tracker.agents(now).map((agent) => [agent.name, agent.task, agent.state]), [["explore", "map footer", "running"], ["verify", "Check the PR", "queued"]], "no label: the task text; tasks keep their creation order");
});

test("S87 tracker, task mode: the status events arrive before the result; the oldest unmatched call's args name the task, the result reconciles by task id", () => {
	let now = 1_000;
	const tracker = createSubagentTracker("s1", () => now);
	tracker.call("subagent_run", { agent: "explore", task: "Map the footer sources\nSecond line", mode: "task" });
	tracker.status(statusEvent("t1", "queued", 1));
	now = 1_500;
	tracker.status(statusEvent("t1", "running", 2));
	assert.deepEqual(tracker.agents(now), [{ id: "call:#1", name: "explore", task: "Map the footer sources Second line", state: "running", startedAt: 1_500 }], "the call's agent and task text as one line, no model yet");
	tracker.status(statusEvent("t1", "running", 3));
	tracker.status(statusEvent("t1", "completed", 4));
	assert.equal(tracker.result("subagent_run", taskResult("t1", { status: "completed", label: "map footer", lastStep: "done" })), true);
	assert.deepEqual(tracker.agents(now), [{ id: "call:#1", name: "explore", task: "map footer", state: "done", startedAt: 1_500, model: "anthropic/claude-opus-5-5", effort: "high" }], "the result's label, model and effort; the state from the events stays");
	// The call was consumed by t1: a later task from another call does not get it.
	tracker.call("subagent_run", { agent: "verify", task: "Check it" });
	tracker.status(statusEvent("t2", "running", 5));
	assert.deepEqual(tracker.agents(now).map((agent) => [agent.name, agent.task]), [["explore", "map footer"], ["verify", "Check it"]]);
	// A failed launch (error result, no task id) drops its call, and its row, so the next task does not inherit it.
	tracker.call("subagent_run", { agent: "ghost", task: "never starts" });
	assert.equal(tracker.result("subagent_run", { content: [{ type: "text", text: "Unknown agent" }] }, true), true);
	tracker.status(statusEvent("t3", "running", 6));
	assert.equal(tracker.agents(now)[2].name, "subagent", "no call left to name t3");
});

test("S87 tracker: subagent_continue updates a known task's text and label and reuses its row; a result with a finished status ends a task that never got the event", () => {
	let now = 1_000;
	const tracker = createSubagentTracker("s1", () => now);
	tracker.call("subagent_run", { agent: "explore", task: "Map", label: "map footer" });
	tracker.result("subagent_run", taskResult("t1", { status: "completed", label: "map footer" }));
	assert.deepEqual(tracker.agents(now).map((agent) => [agent.task, agent.state]), [["map footer", "done"]]);
	tracker.call("subagent_continue", { task_id: "t1", prompt: "Now the header", label: "map header" });
	now = 2_000;
	tracker.status(statusEvent("t1", "running", 1));
	assert.deepEqual(tracker.agents(now), [{ id: "call:#1", name: "explore", task: "map header", state: "running", startedAt: 2_000, model: "anthropic/claude-opus-5-5", effort: "high" }], "one row, the new label, running again counts from now");
	assert.equal(tracker.result("subagent_continue", taskResult("t1", { status: "completed", label: "map header" })), true);
	assert.equal(tracker.agents(now)[0].state, "running", "a result's status never overrides the events once they flow");
	tracker.status(statusEvent("t1", "completed", 2));
	assert.equal(tracker.agents(now)[0].state, "done");
	// A continue of a task this session never saw: the result creates it.
	tracker.call("subagent_continue", { task_id: "old", prompt: "resume" });
	assert.equal(tracker.result("subagent_continue", taskResult("old", { agent: "writer", status: "running", label: undefined })), true);
	assert.deepEqual(tracker.agents(now).map((agent) => [agent.name, agent.task, agent.state]), [["explore", "map header", "done"], ["writer", "resume", "running"]]);
});

test("S87 tracker: model-provided text is printable and bounded: escapes, controls and bidi overrides go, whitespace collapses, long text is cut", () => {
	const tracker = createSubagentTracker("s1", () => 1);
	tracker.call("subagent_run", { agent: "ex\x1b]0;evil\x07plore\u202e", task: "\x1b[31mMap\tthe\n\nfooter\x07 ".repeat(20), label: undefined });
	tracker.result("subagent_run", taskResult("t1", { agent: "ex\x1b]0;evil\x07plore\u202e", label: undefined, model: "m\x1b[0model", thinking: "hi\u200egh" }));
	const [row] = tracker.agents(1);
	assert.equal(row.name, "explore");
	assert.ok(row.task.startsWith("Map the footer Map the footer"), row.task);
	assert.equal(row.task.length, 120, "bounded");
	assert.equal(row.model, "model");
	assert.equal(row.effort, "high");
});

test("S87 presence seed: the newest activity file of this session's hash gives its unfinished tasks; a missing dir, no file, a bad file or finished tasks give nothing", async () => {
	const scratch = mkdtempSync(join(tmpdir(), "fisi-dock-subagents-"));
	console.log(`--- presence scratch: ${scratch}`);
	const agentHome = join(scratch, "agent");
	const presence = join(agentHome, "gentle-agents", "presence");
	assert.deepEqual(await readPresenceTasks(agentHome, "s1"), [], "no presence dir");
	mkdirSync(presence, { recursive: true });
	assert.deepEqual(await readPresenceTasks(agentHome, "s1"), [], "no file");
	const hash = createHash("sha256").update("s1").digest("hex");
	const summary = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ summary: { id, agent: "explore", label: `label ${id}`, status, model: "anthropic/claude-opus-5-5", createdAt: 1_000, startedAt: 1_500, endedAt: null, lastActivityAt: 2_000, ...extra }, thread: { version: 1, dropped: 0, items: [] } });
	const older = join(presence, `${hash}.11111111-1111-4111-8111-111111111111.activity.json`);
	const newer = join(presence, `${hash}.22222222-2222-4222-8222-222222222222.activity.json`);
	const foreign = join(presence, `${"f".repeat(64)}.33333333-3333-4333-8333-333333333333.activity.json`);
	writeFileSync(older, JSON.stringify({ tasks: [summary("stale", "running")] }));
	writeFileSync(foreign, JSON.stringify({ tasks: [summary("theirs", "running")] }));
	// The newer incarnation is written last, so its mtime wins.
	await new Promise((resolve) => setTimeout(resolve, 20));
	writeFileSync(newer, JSON.stringify({ tasks: [summary("t1", "running"), summary("t2", "queued", { startedAt: null }), summary("t3", "completed", { endedAt: 3_000 }), { summary: { id: "bad" }, thread: {} }, summary("t4", "waiting", { model: "" })] }));
	assert.deepEqual(await readPresenceTasks(agentHome, "s1"), [
		{ id: "t1", agent: "explore", label: "label t1", status: "running", model: "anthropic/claude-opus-5-5", startedAt: 1_500 },
		{ id: "t2", agent: "explore", label: "label t2", status: "queued", model: "anthropic/claude-opus-5-5" },
		{ id: "t4", agent: "explore", label: "label t4", status: "waiting", startedAt: 1_500 },
	]);
	writeFileSync(newer, "{ not json");
	assert.deepEqual(await readPresenceTasks(agentHome, "s1"), [], "unreadable JSON changes nothing");
	assert.deepEqual(await readPresenceTasks(join(scratch, "nowhere"), "s1"), []);
	// The seed adds what the tracker does not know; events then update it, and a known task is left alone.
	let now = 5_000;
	const tracker = createSubagentTracker("s1", () => now);
	tracker.status(statusEvent("t2", "running", 3));
	assert.equal(tracker.seed([
		{ id: "t1", agent: "explore", label: "label t1", status: "running", model: "anthropic/claude-opus-5-5", startedAt: 1_500 },
		{ id: "t2", agent: "explore", label: "label t2", status: "queued", model: "anthropic/claude-opus-5-5" },
	]), true);
	assert.deepEqual(tracker.agents(now), [
		{ id: "task:t2", name: "subagent", task: "task t2", state: "running", startedAt: 5_000 },
		{ id: "task:t1", name: "explore", task: "label t1", state: "running", startedAt: 1_500, model: "anthropic/claude-opus-5-5" },
	], "t2 stays as the event left it; t1 comes from the file with its own start");
	assert.equal(tracker.seed([{ id: "t1", agent: "explore", label: "x", status: "running" }]), false, "nothing new");
	tracker.status(statusEvent("t1", "completed", 1));
	assert.equal(tracker.agents(now)[1].state, "done", "any event sequence moves a seeded task");
});

test("S87 agentHomeDir: GENTLE_PI_AGENT_HOME, then PI_CODING_AGENT_DIR, then ~/.pi/agent", () => {
	assert.equal(agentHomeDir({ GENTLE_PI_AGENT_HOME: "E:/g", PI_CODING_AGENT_DIR: "E:/p" }, "E:/home"), "E:/g");
	assert.equal(agentHomeDir({ PI_CODING_AGENT_DIR: "E:/p" }, "E:/home"), "E:/p");
	assert.equal(agentHomeDir({ GENTLE_PI_AGENT_HOME: "" }, "E:/home"), join("E:/home", ".pi", "agent"));
});

// --- regression: refused delegations before parallel task-mode workers (T102) ----------

// The refusals of Gentle Shell 4.6.0's `tool_call` hook (extensions/gentle-ai.ts) and
// of `buildRequest` (extensions/gentle-agents.ts): Pi turns a block or a throw into
// an error result with the reason as its text and empty details (pi-agent-core
// agent-loop.js createErrorToolResult), so no `details.gentleAgents` and no task id.
const WRITER_SURFACE_REFUSAL = "Writer tasks must include the exact Markdown heading `## Allowed edit surfaces` with narrow repository-relative paths or narrow globs, one per line. Every non-empty line belongs to the section until the next canonical Markdown heading and must be a valid surface entry. Paths containing whitespace require whole-entry backticks; begin explanatory prose under the next Markdown heading. The parent must derive or map that canonical block from the delegated task and relaunch the writer; do not accept aliases, and do not ask the human to author paths or globs. No `## Allowed edit surfaces` heading was found. Resend the same task text unchanged except for that section; never shorten or re-summarize it.";
const WRITER_DOCUMENT_REFUSAL = "Writers run only for a task of an existing ODD feature document (`Spec: odd/tasks/<feature>.md, T<n>` in the task) or when your measured context reaches the context backstop. This unit has neither: write this unit inline yourself now; do not retry the launch, and never create a feature document only to launch writers.";
const VERIFIER_RISK_REFUSAL = "An independent verifier runs only for a change that declares a named high-risk item (`Risk: item N` from the Task Size list in the task). No supported `Risk: item N` declaration was recognized in the launch `task` or `context`: run its focused test and suite inline yourself now; do not retry the launch, and never add a Risk line or create a feature document only to get a verifier admitted.";
const refusal = (reason: string) => ({ content: [{ type: "text", text: reason }], details: {} });

test("T102 two explorers finish, five delegations are refused, then two task-mode workers run in parallel: both workers are live rows", () => {
	let now = 1_000;
	const tracker = createSubagentTracker("s1", () => now);
	const run = (agent: string, task: string, id: string) => tracker.call("subagent_run", { agent, task, mode: "task" }, id);
	// Two explorers in one parallel batch: Pi emits every tool_execution_start, then runs both.
	run("gentle-ai-explore", "Map the tracker", "e1");
	run("gentle-ai-explore", "Map the panel", "e2");
	tracker.status(statusEvent("tA", "queued", 1));
	tracker.status(statusEvent("tB", "queued", 2));
	tracker.status(statusEvent("tA", "running", 3));
	tracker.status(statusEvent("tB", "running", 4));
	assert.deepEqual(tracker.agents(now).map((agent) => [agent.name, agent.task, agent.state]), [["gentle-ai-explore", "Map the tracker", "running"], ["gentle-ai-explore", "Map the panel", "running"]]);
	tracker.status(statusEvent("tA", "completed", 5));
	tracker.status(statusEvent("tB", "completed", 6));
	assert.equal(tracker.result("subagent_run", taskResult("tA", { agent: "gentle-ai-explore", status: "completed", label: "map tracker" }), false, "e1"), true);
	assert.equal(tracker.result("subagent_run", taskResult("tB", { agent: "gentle-ai-explore", status: "completed", label: "map panel" }), false, "e2"), true);
	now = 70_000;
	tracker.prune(now);
	assert.deepEqual(tracker.agents(now), [], "the explorers folded after the tail");
	// Five delegations refused at once: each call starts, then ends with the refusal (isError, no task id).
	const refused: [string, string][] = [["gentle-ai-verify", VERIFIER_RISK_REFUSAL], ["gentle-ai-worker", WRITER_SURFACE_REFUSAL], ["gentle-ai-worker", WRITER_DOCUMENT_REFUSAL], ["gentle-ai-worker", WRITER_SURFACE_REFUSAL], ["gentle-ai-worker", WRITER_DOCUMENT_REFUSAL]];
	for (const entry of refused) {
		const [agent, reason] = entry;
		const id = `refused-${refused.indexOf(entry)}`;
		run(agent, `Refused ${agent}`, id);
		assert.equal(tracker.agents(now).length, 1, "the call shows until its refusal");
		assert.equal(tracker.result("subagent_run", refusal(reason), true, id), true, "the refusal takes the call's row away");
	}
	assert.deepEqual(tracker.agents(now), [], "a refused launch is no task");
	// Two workers in task mode, in one parallel batch: both calls start, then their events arrive, no result yet.
	run("gentle-ai-worker", "Agent one says hello", "w1");
	run("gentle-ai-worker", "Agent two says hello", "w2");
	now = 71_000;
	assert.equal(tracker.status(statusEvent("tC", "queued", 7)), true);
	assert.equal(tracker.status(statusEvent("tD", "queued", 8)), true);
	assert.equal(tracker.status(statusEvent("tC", "running", 9)), true);
	assert.equal(tracker.status(statusEvent("tD", "running", 10)), true);
	assert.deepEqual(tracker.agents(now), [
		{ id: "call:w1", name: "gentle-ai-worker", task: "Agent one says hello", state: "running", startedAt: 71_000 },
		{ id: "call:w2", name: "gentle-ai-worker", task: "Agent two says hello", state: "running", startedAt: 71_000 },
	]);
});

test("T102 no status event reaches the tracker: a task-mode subagent_run call is a running row from its start, a refused launch's row goes with its refusal, and the result at the end closes the row", () => {
	let now = 1_000;
	const tracker = createSubagentTracker("s1", () => now);
	// Pi emits tool_execution_start for every call of the batch first (parallel executor), then runs them.
	assert.equal(tracker.call("subagent_run", { agent: "gentle-ai-worker", task: "Agent one says hello", mode: "task" }, "c1"), true, "a call is a change: its row appears");
	assert.equal(tracker.call("subagent_run", { agent: "gentle-ai-worker", task: "Agent two says hello", mode: "task" }, "c2"), true);
	assert.equal(tracker.call("gentle-ai-verify", { agent: "x", task: "y" }, "c3"), false, "another tool is no call");
	assert.deepEqual(tracker.agents(now), [
		{ id: "call:c1", name: "gentle-ai-worker", task: "Agent one says hello", state: "running", startedAt: 1_000 },
		{ id: "call:c2", name: "gentle-ai-worker", task: "Agent two says hello", state: "running", startedAt: 1_000 },
	], "both workers live while their calls are in flight; the time counts from the call");
	// A third launch, refused by the tool_call hook: Pi ends that exact call at once (isError, the reason as text, empty details).
	tracker.call("subagent_run", { agent: "gentle-ai-verify", task: "Verify it", mode: "task" }, "c3");
	assert.equal(tracker.agents(now).length, 3);
	assert.equal(tracker.result("subagent_run", refusal(VERIFIER_RISK_REFUSAL), true, "c3"), true, "the refusal is a change: its row goes");
	assert.deepEqual(tracker.agents(now).map((agent) => agent.id), ["call:c1", "call:c2"], "the refusal drops its own call, not the oldest one");
	// The workers end, the second first: each result names its task and keeps the row it started with.
	now = 9_000;
	assert.equal(tracker.result("subagent_run", taskResult("tB", { agent: "gentle-ai-worker", status: "completed", label: "agent two", lastStep: "done" }), false, "c2"), true);
	assert.deepEqual(tracker.agents(now), [
		{ id: "call:c1", name: "gentle-ai-worker", task: "Agent one says hello", state: "running", startedAt: 1_000 },
		{ id: "call:c2", name: "gentle-ai-worker", task: "agent two", state: "done", model: "anthropic/claude-opus-5-5", effort: "high" },
	], "the result's status closes a task that never got an event; the row id stays, so no second entrance");
	assert.equal(tracker.result("subagent_run", taskResult("tA", { agent: "gentle-ai-worker", status: "completed", label: "agent one" }), false, "c1"), true);
	assert.deepEqual(tracker.agents(now).map((agent) => [agent.id, agent.task, agent.state]), [["call:c1", "agent one", "done"], ["call:c2", "agent two", "done"]]);
	assert.equal(tracker.prune(now + SUBAGENT_FINISHED_TTL_MS), true, "finished rows fold after the tail");
	assert.deepEqual(tracker.agents(now + SUBAGENT_FINISHED_TTL_MS), []);
});

test("T102 a background subagent_run without events: the result right after the call names the task and its queued state; a continue of it in task mode shows it running again until its result", () => {
	let now = 1_000;
	const tracker = createSubagentTracker("s1", () => now);
	tracker.call("subagent_run", { agent: "gentle-ai-explore", task: "Map it", mode: "background" }, "c1");
	assert.equal(tracker.result("subagent_run", taskResult("t1", { agent: "gentle-ai-explore", status: "queued", label: "map" }), false, "c1"), true);
	assert.deepEqual(tracker.agents(now), [{ id: "call:c1", name: "gentle-ai-explore", task: "map", state: "queued", model: "anthropic/claude-opus-5-5", effort: "high" }], "queued: no time, not live");
	tracker.status(statusEvent("t1", "running", 1));
	now = 2_000;
	tracker.status(statusEvent("t1", "completed", 2));
	assert.equal(tracker.agents(now)[0].state, "done");
	// Its continuation in task mode, with the events gone: the call shows it running, its result ends it.
	now = 3_000;
	assert.equal(tracker.call("subagent_continue", { task_id: "t1", prompt: "Now the header", label: "map header", mode: "task" }, "c2"), true);
	assert.deepEqual(tracker.agents(now), [{ id: "call:c1", name: "gentle-ai-explore", task: "map header", state: "running", startedAt: 1_000, model: "anthropic/claude-opus-5-5", effort: "high" }], "one row, running again from the continue call; the time keeps counting from its first running event");
	now = 4_000;
	assert.equal(tracker.result("subagent_continue", taskResult("t1", { agent: "gentle-ai-explore", status: "completed", label: "map header" }), false, "c2"), true);
	assert.equal(tracker.agents(now)[0].state, "done", "with no event since the continue call, its result's status counts");
});

test("T102 a refusal that still carries details.gentleAgents with a failed status for a task that never emitted events: the task shows failed and takes its call", () => {
	const tracker = createSubagentTracker("s1", () => 5_000);
	tracker.call("subagent_run", { agent: "gentle-ai-worker", task: "Write it", label: "write it", mode: "task" }, "c1");
	assert.equal(tracker.result("subagent_run", taskResult("t1", { agent: "gentle-ai-worker", status: "failed", label: "write it", error: "writer surface conflict" }), true, "c1"), true);
	assert.deepEqual(tracker.agents(5_000), [{ id: "call:c1", name: "gentle-ai-worker", task: "write it", state: "failed", model: "anthropic/claude-opus-5-5", effort: "high" }], "failed, never seen running: no time");
	assert.equal(tracker.prune(5_000 + SUBAGENT_FINISHED_TTL_MS), true);
});

test("T102 an event for a task no result or call named, with the FIFO holding only stale calls, is a row of its own: `subagent` and `task <id>` until details arrive; stale calls go when the run settles", () => {
	let now = 1_000;
	const tracker = createSubagentTracker("s1", () => now);
	// A background call whose result never named a task (its end was lost): a stale call.
	tracker.call("subagent_run", { agent: "ghost", task: "never ends", mode: "background" }, "c0");
	// A subagent_continue of a task this session never saw, also stale.
	tracker.call("subagent_continue", { task_id: "old", prompt: "resume" }, "c1");
	assert.deepEqual(tracker.agents(now).map((agent) => [agent.id, agent.name, agent.task, agent.state]), [["call:c0", "ghost", "never ends", "running"], ["call:c1", "subagent", "resume", "running"]]);
	// Events of a task the stale run call does name (the oldest unmatched run call is still the one, as before)...
	tracker.status(statusEvent("t7", "running", 1));
	assert.deepEqual(tracker.agents(now).map((agent) => [agent.id, agent.name, agent.task]), [["call:c0", "ghost", "never ends"], ["call:c1", "subagent", "resume"]]);
	// ...and of a task nothing names: a row of its own.
	now = 2_000;
	assert.equal(tracker.status(statusEvent("t8", "running", 2)), true);
	assert.deepEqual(tracker.agents(now)[2], { id: "task:t8", name: "subagent", task: "task t8", state: "running", startedAt: 2_000 });
	tracker.result("subagent_run", taskResult("t8", { agent: "gentle-ai-explore", status: "running", label: undefined, lastStep: "reading" }), false, "c9");
	assert.deepEqual(tracker.agents(now)[2].task, "reading", "the result's last step names it; the row id stays");
	assert.equal(tracker.agents(now)[2].id, "task:t8");
	// The run settles: no tool call is in flight any more, so the stale continue call goes; the tasks stay.
	assert.equal(tracker.settle(), true);
	assert.deepEqual(tracker.agents(now).map((agent) => agent.id), ["call:c0", "task:t8"]);
	assert.equal(tracker.settle(), false);
});

test("T102 a subagent_run result without a task id that is not an error (`Error: no subagent named …`, isError false) still ends its call; the oldest run call stands in when the end has no call id", () => {
	const tracker = createSubagentTracker("s1", () => 1);
	tracker.call("subagent_run", { agent: "nobody", task: "x", mode: "task" }, "c1");
	assert.equal(tracker.result("subagent_run", { content: [{ type: "text", text: "Error: no subagent named \"nobody\". Known: gentle-ai-explore" }], details: { error: "unknown agent" } }, false, "c1"), true);
	assert.deepEqual(tracker.agents(1), []);
	tracker.call("subagent_run", { agent: "a", task: "first" });
	tracker.call("subagent_run", { agent: "b", task: "second" });
	tracker.call("subagent_continue", { task_id: "zz", prompt: "p" });
	assert.equal(tracker.result("subagent_run", refusal(WRITER_DOCUMENT_REFUSAL), true), true);
	assert.deepEqual(tracker.agents(1).map((agent) => agent.name), ["b", "subagent"], "no call id: the oldest run call, never the continue");
	assert.equal(tracker.result("subagent_continue", { content: [{ type: "text", text: "Unknown task zz" }], details: {} }, true), true);
	assert.deepEqual(tracker.agents(1).map((agent) => agent.name), ["b"], "a continue's end without a task id drops the oldest continue call");
	assert.equal(tracker.result("subagent_run", refusal(WRITER_SURFACE_REFUSAL), true, "c-unknown"), true, "an unknown call id falls back to the oldest run call");
	assert.deepEqual(tracker.agents(1), []);
	assert.equal(tracker.result("subagent_run", refusal(WRITER_SURFACE_REFUSAL), true), false, "nothing left to drop: no change");
});

test("T102 the sequence guard is per task: interleaved sequences of parallel tasks never block each other, and a call's provisional state yields to the first event", () => {
	let now = 1_000;
	const tracker = createSubagentTracker("s1", () => now);
	tracker.call("subagent_run", { agent: "w", task: "one", mode: "task" }, "c1");
	tracker.call("subagent_run", { agent: "w", task: "two", mode: "task" }, "c2");
	assert.equal(tracker.status(statusEvent("tA", "queued", 1)), true);
	assert.equal(tracker.status(statusEvent("tB", "queued", 2)), true);
	assert.deepEqual(tracker.agents(now).map((agent) => [agent.id, agent.state, agent.startedAt]), [["call:c1", "queued", undefined], ["call:c2", "queued", undefined]], "queued from the events: the provisional running state and time give way");
	now = 1_500;
	assert.equal(tracker.status(statusEvent("tB", "running", 4)), true, "tB's sequence 4 before tA's 3");
	assert.equal(tracker.status(statusEvent("tA", "running", 3)), true, "3 is above tA's own 1");
	assert.equal(tracker.status(statusEvent("tB", "running", 4)), false, "a repeat of tB's 4");
	assert.equal(tracker.status(statusEvent("tA", "completed", 2)), false, "a late tA event below its 3");
	assert.deepEqual(tracker.agents(now).map((agent) => [agent.id, agent.state, agent.startedAt]), [["call:c1", "running", 1_500], ["call:c2", "running", 1_500]]);
	assert.equal(tracker.status(statusEvent("tA", "completed", 5)), true);
	assert.equal(tracker.status(statusEvent("tB", "completed", 6)), true);
	// Each result reconciles its own task by call id, whatever the order.
	assert.equal(tracker.result("subagent_run", taskResult("tB", { status: "completed", label: "two" }), false, "c2"), true);
	assert.equal(tracker.result("subagent_run", taskResult("tA", { status: "completed", label: "one" }), false, "c1"), true);
	assert.deepEqual(tracker.agents(now).map((agent) => [agent.id, agent.task, agent.state]), [["call:c1", "one", "done"], ["call:c2", "two", "done"]]);
});

test("T102 a subagent_continue of a finished task that is refused (no details.gentleAgents) puts the row back as it was; so does the run settling with its end lost", () => {
	let now = 1_000;
	const tracker = createSubagentTracker("s1", () => now);
	tracker.call("subagent_run", { agent: "explore", task: "Map", label: "map footer", mode: "task" }, "c1");
	tracker.status(statusEvent("t1", "running", 1));
	now = 2_000;
	tracker.status(statusEvent("t1", "completed", 2));
	const before = tracker.agents(now);
	assert.equal(before[0].state, "done");
	now = 3_000;
	assert.equal(tracker.call("subagent_continue", { task_id: "t1", prompt: "Again", label: "second pass", mode: "task" }, "c2"), true);
	assert.deepEqual(tracker.agents(now).map((agent) => [agent.task, agent.state]), [["second pass", "running"]]);
	assert.equal(tracker.result("subagent_continue", refusal(WRITER_SURFACE_REFUSAL), true, "c2"), true, "the refusal is a change");
	assert.deepEqual(tracker.agents(now), before, "done again, its label and its tail back");
	assert.equal(tracker.prune(2_000 + SUBAGENT_FINISHED_TTL_MS), true, "the tail still counts from when it finished");
	// Same continue with its end lost: the settled run puts it back.
	tracker.call("subagent_run", { agent: "explore", task: "Map", label: "map footer", mode: "task" }, "c3");
	tracker.status(statusEvent("t2", "running", 3));
	tracker.status(statusEvent("t2", "completed", 4));
	tracker.call("subagent_continue", { task_id: "t2", prompt: "Again", mode: "task" }, "c4");
	assert.equal(tracker.settle(), true);
	assert.equal(tracker.agents(now)[0].state, "done");
	assert.equal(tracker.settle(), false, "nothing left to put back");
	// An event after the continue call makes it real: nothing to put back any more.
	tracker.call("subagent_continue", { task_id: "t2", prompt: "Again", mode: "task" }, "c5");
	tracker.status(statusEvent("t2", "running", 5));
	assert.equal(tracker.settle(), false);
	assert.equal(tracker.agents(now)[0].state, "running");
});
