import assert from "node:assert/strict";
import test from "node:test";
import { ORBS } from "../lib/orbs.ts";
import { fgCode, palette } from "../lib/palette.ts";
import type { PanelModel } from "../lib/panel-model.ts";
import { renderStrip } from "../lib/strip.ts";
import { visibleWidth } from "../lib/text.ts";

const plain = (line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

// Everything the panel can show, including what the strip must never repeat (S8).
const active: PanelModel = {
	session: { project: "proj-xyz", branch: "br-xyz", ahead: 1, contextPercent: 26, tokensUsed: 52_000, tokensMax: 200_000 },
	headsUp: [
		{ kind: "unpushed", text: "1 commit not pushed" },
		{ kind: "plan", text: "ODD plan fisi-dock" },
	],
	todo: { done: 3, total: 7, active: "Confirm CI is green", next: "Commit", more: 2 },
	odd: {
		steps: [
			{ phase: "exploring", state: "done", seconds: 31 },
			{ phase: "implementing", state: "done", seconds: 72 },
			{ phase: "exploring", state: "done", seconds: 20 },
			{ phase: "checking", state: "active", seconds: 42, frame: 2 },
		],
	},
	agents: [
		{ name: "explore", task: "Map CI", state: "done" },
		{ name: "verify", task: "Check PR", state: "running" },
		{ name: "later", task: "Wait", state: "queued" },
	],
	changes: [{ status: "M", path: "lib/strip.ts", added: 1, removed: 0 }],
	footer: { cost: 1.234, rdd: "on", review: "running" },
};

const idle: PanelModel = {
	session: { project: "proj-xyz", branch: "main", contextPercent: 26 },
	todo: { done: 7, total: 7, more: 0 },
	odd: {
		steps: [
			{ phase: "exploring", state: "done", seconds: 31 },
			{ phase: "implementing", state: "done", seconds: 72 },
			{ phase: "exploring", state: "done", seconds: 20 },
			{ phase: "checking", state: "done", seconds: 42 },
		],
	},
	agents: [{ name: "explore", task: "Map CI", state: "done" }],
	changes: [{ status: "M", path: "lib/strip.ts", added: 1, removed: 0 }],
	footer: { cost: 0 },
};

test("active strip: todo, running agents, changed files, then the warnings line (S23); the active phase is left to the prompt box (S92)", () => {
	const lines = renderStrip(active, 64);
	assert.deepEqual(lines.map(plain), ["  todo 3/7 · ⠹ 1 agent · ±1 file", "  ! 1 commit not pushed · ! ODD plan fisi-dock"]);
	console.log(`--- strip, active, 64 columns\n${lines.map(plain).join("\n")}`);
});

test("idle strip: a finished timeline shows ✓ ODD and its total time (S23)", () => {
	const lines = renderStrip(idle, 64);
	assert.deepEqual(lines.map(plain), ["  ✓ ODD 2:45 · todo 7/7 · ±1 file"]);
	console.log(`--- strip, idle, 64 columns\n${lines.map(plain).join("\n")}`);
});

test("segments follow the panel's colors: phase orb, section accents, faint separator, warning glyphs (S9, S17)", () => {
	const [first, second] = renderStrip(active, 64);
	assert.ok(!first.includes(ORBS.checking.frames[2]), "no phase orb while a step is active (S92)");
	assert.ok(first.includes(`${fgCode(palette.coral)}todo 3/7`), "todo in the todo accent");
	assert.ok(first.includes(`${fgCode(palette.lilac)}1 agent`), "agents in the agents accent");
	assert.ok(first.includes(`${fgCode(palette.green)}±1 file`), "changes in the changes accent");
	assert.ok(first.includes(`${fgCode(palette.faint)} · `), "faint separator");
	assert.ok(second.includes(`${fgCode(palette.red)}!`), "unpushed warning glyph in red, as the panel draws it");
	assert.ok(second.includes(`${fgCode(palette.amber)}!`), "plan warning glyph in amber, as the panel draws it");
	const [done] = renderStrip(idle, 64);
	assert.ok(done.includes(`${fgCode(palette.green)}✓`), "finished timeline check in green");
	assert.ok(done.includes(`${fgCode(palette.amber)}ODD 2:45`), "finished timeline in the odd accent");
});

test("counts: plural agents and files, queued agents not counted, no todo without tasks", () => {
	const model: PanelModel = {
		...active,
		headsUp: [],
		todo: { done: 0, total: 0, more: 0 },
		agents: [
			{ name: "a", task: "x", state: "running" },
			{ name: "b", task: "y", state: "running" },
			{ name: "c", task: "z", state: "queued" },
		],
		changes: [
			{ status: "M", path: "a", added: 1, removed: 0 },
			{ status: "?", path: "b", added: 0, removed: 0 },
			{ status: "D", path: "c", added: 0, removed: 3 },
		],
	};
	assert.deepEqual(renderStrip(model, 64).map(plain), ["  ⠹ 2 agents · ±3 files"]);
});

test("the strip never repeats model, context, cost, project, branch or the active phase the prompt box shows (S8, S92)", () => {
	for (const width of [200, 64, 40]) {
		const text = renderStrip(active, width).map(plain).join("\n");
		for (const banned of ["proj-xyz", "br-xyz", "26", "%", "$", "1.234", "cost", "context", "ctx", "RDD", "review", "running", "opus", "checking", "0:42"]) {
			assert.ok(!text.includes(banned), `${width}: ${banned} in ${JSON.stringify(text)}`);
		}
	}
});

test("width-safe: trailing segments drop whole before any text is cut", () => {
	const at = (width: number) => renderStrip(active, width).map(plain);
	assert.equal(plain(renderStrip(active, 32)[0]), "  todo 3/7 · ⠹ 1 agent · ±1 file", "exactly 32 columns fits");
	assert.deepEqual(at(46), ["  todo 3/7 · ⠹ 1 agent · ±1 file", "  ! 1 commit not pushed · ! ODD plan fisi-dock"]);
	assert.deepEqual(at(31), ["  todo 3/7 · ⠹ 1 agent", "  ! 1 commit not pushed"]);
	assert.deepEqual(at(21), ["  todo 3/7", "! 1 commit not pushed"]);
	const [first, second] = at(20);
	assert.equal(first, "  todo 3/7");
	assert.ok(second.endsWith("…") && second.startsWith("! 1 commit"), `last resort ellipsis: ${second}`);
	for (const width of [64, 50, 40, 30, 20, 12, 5, 1]) {
		const lines = renderStrip(active, width);
		assert.ok(lines.length >= 1 && lines.length <= 2);
		for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
		for (const line of renderStrip(idle, width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
	}
	assert.deepEqual(renderStrip(active, 0), []);
	assert.deepEqual(renderStrip(active, -3), []);
});

test("no data at all draws nothing, and warnings alone draw one line", () => {
	const empty: PanelModel = { session: { project: "proj-xyz", branch: "main", contextPercent: 40 }, footer: { cost: 2 } };
	assert.deepEqual(renderStrip(empty, 64), []);
	assert.deepEqual(renderStrip({ ...empty, headsUp: [], todo: { done: 0, total: 0, more: 0 }, odd: { steps: [] }, agents: [], changes: [] }, 64), []);
	assert.deepEqual(renderStrip({ ...empty, headsUp: [{ kind: "worktrees", text: "worktree open: x" }] }, 64).map(plain), ["  ! worktree open: x"]);
});

test("todo: false leaves out the todo segment for the card above the prompt; the rest stays (S28, S8)", () => {
	assert.deepEqual(renderStrip(active, 64, { todo: false }).map(plain), ["  ⠹ 1 agent · ±1 file", "  ! 1 commit not pushed · ! ODD plan fisi-dock"]);
	assert.deepEqual(renderStrip(idle, 64, { todo: false }).map(plain), ["  ✓ ODD 2:45 · ±1 file"]);
	assert.deepEqual(renderStrip(active, 64, {}), renderStrip(active, 64), "default keeps the todo segment");
	assert.deepEqual(renderStrip({ session: active.session, todo: active.todo }, 64, { todo: false }), [], "todo alone: nothing left");
});

test("the strip's running agent spinner shows the model's frame; still ⠹ without one (S31)", () => {
	const at = (spinner?: number) => plain(renderStrip({ ...active, ...(spinner !== undefined ? { spinner } : {}) }, 64, { todo: false })[0]);
	assert.equal(at(0), "  ⠋ 1 agent · ±1 file");
	assert.equal(at(1), "  ⠙ 1 agent · ±1 file");
	assert.equal(at(7), "  ⠧ 1 agent · ±1 file");
	assert.equal(at(), "  ⠹ 1 agent · ±1 file");
	for (let frame = 0; frame < 10; frame++) assert.equal(visibleWidth(at(frame)), visibleWidth(at()), "same width every frame");
});

test("agents: false leaves out the running agents segment for the agents card; the rest stays (S35, S8)", () => {
	assert.deepEqual(renderStrip(active, 64, { agents: false }).map(plain), ["  todo 3/7 · ±1 file", "  ! 1 commit not pushed · ! ODD plan fisi-dock"]);
	assert.deepEqual(renderStrip(active, 64, { todo: false, agents: false }).map(plain), ["  ±1 file", "  ! 1 commit not pushed · ! ODD plan fisi-dock"]);
	assert.deepEqual(renderStrip(active, 64, { agents: true }), renderStrip(active, 64), "default keeps the agents segment");
	assert.deepEqual(renderStrip({ session: active.session, agents: active.agents }, 64, { agents: false }), [], "agents alone: nothing left");
});

test("S92 an active phase alone draws nothing; the strip knows no lens: the fork's phase and running options and lens data change nothing (S86)", () => {
	assert.deepEqual(renderStrip({ session: active.session, odd: active.odd }, 64), [], "the prompt box names the phase");
	assert.deepEqual(renderStrip(active, 64, { phase: false, running: true } as never), renderStrip(active, 64));
	const lens = { files: [{ path: "src/user.ts", problems: [{ severity: "error", line: 4, rule: "typescript:2551", message: "nope" }] }] };
	assert.deepEqual(renderStrip({ ...active, lens } as never, 64, { running: true } as never), renderStrip(active, 64));
	assert.deepEqual(renderStrip(active, 64).map(plain), ["  todo 3/7 · ⠹ 1 agent · ±1 file", "  ! 1 commit not pushed · ! ODD plan fisi-dock"]);
});

test("S87 the strip counts waiting subagent tasks with the running agents, finished ones not", () => {
	const model: PanelModel = {
		...active,
		headsUp: [],
		todo: { done: 0, total: 0, more: 0 },
		agents: [
			{ name: "job-1", task: "npm test", state: "running" },
			{ id: "task:t1", name: "explore", task: "map footer", state: "waiting" },
			{ id: "task:t2", name: "verify", task: "check PR", state: "done" },
		],
	};
	assert.deepEqual(renderStrip(model, 64).map(plain), ["  ⠹ 2 agents · ±1 file"]);
});

