// Times what the panel costs while it runs, in isolation (no terminal, no Pi).
//   node scripts/bench.ts                 a table: median and p95 per call, calls per second
//   node scripts/bench.ts --save <file>   the table, and the same numbers as JSON in <file>, for comparing two runs
//
// Each case runs for about a second (at most 2000 calls) after a short warm-up,
// so the whole run stays near ten seconds however slow a case is.
//
// Each case is one unit of work the extension repeats while a request runs:
// a rail draw, a store update on a spinner tick, the model digest.

import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createLiveStore } from "../lib/live-store.ts";
import { samplePanelModel, type PanelModel } from "../lib/panel-model.ts";
import { panelDigest, renderDock, renderRail } from "../lib/panel.ts";

/** A busy session: every list at or past its cap, long names that must be cut. */
const busyModel: PanelModel = {
	...samplePanelModel,
	session: { ...samplePanelModel.session, project: "an-extremely-long-project-name-that-never-ends-in-the-rail", branch: "feature/very-long-branch-name-with-many-segments-and-words", ahead: 12, contextPercent: 62 },
	todo: {
		done: 4,
		total: 12,
		active: "Task 5: a fairly long task title that will not fit the rail",
		next: "Task 6: a fairly long task title that will not fit the rail",
		more: 6,
		tasks: Array.from({ length: 12 }, (_, index) => ({ title: `Task ${index + 1}: a fairly long task title that will not fit the rail`, state: index < 4 ? ("done" as const) : index === 4 ? ("active" as const) : ("pending" as const) })),
	},
	agents: [
		{ name: "gentle-ai-explore", task: "Map the runtime hot paths of the side panel", state: "running", startedAt: 1_000 },
		{ name: "gentle-ai-worker", task: "Write the benchmark harness and its docs", state: "running", startedAt: 2_000 },
		{ name: "gentle-ai-verify", task: "Check the suite on the candidate", state: "waiting", startedAt: 3_000 },
		{ name: "explore", task: "Short", state: "done" },
	],
	changes: Array.from({ length: 9 }, (_, index) => ({ status: "M" as const, path: `packages/some/deep/directory/structure/file-${index}.ts`, added: 120 - index * 7, removed: index * 3 })),
};

interface Case {
	name: string;
	run(index: number): unknown;
}

const NOW = 600_000;
const store = createLiveStore("bench", () => NOW);
store.update({ branch: "main", ahead: 1, agents: busyModel.agents, changes: busyModel.changes, todo: busyModel.todo, odd: busyModel.odd, runSettled: false });

const cases: Case[] = [
	{ name: "rail draw, sample, 47 cols", run: (index) => renderRail({ ...samplePanelModel, spinner: index % 10 }, 47, { frames: "faded", now: NOW }) },
	{ name: "rail draw, busy, 56 cols, 34 rows", run: (index) => renderRail({ ...busyModel, spinner: index % 10 }, 56, { maxRows: 34, frames: "faded", now: NOW }) },
	{ name: "rail draw, busy, 56 cols, 12 rows (short screen)", run: (index) => renderRail({ ...busyModel, spinner: index % 10 }, 56, { maxRows: 12, frames: "faded", now: NOW }) },
	{ name: "rail draw, busy, classic frames", run: (index) => renderRail({ ...busyModel, spinner: index % 10 }, 56, { maxRows: 34, frames: "classic", now: NOW }) },
	{ name: "/dock draw, busy, 100x40", run: (index) => renderDock({ ...busyModel, spinner: index % 10 }, 100, 40, 0, { frames: "faded", now: NOW }) },
	{ name: "model digest, busy", run: () => panelDigest(busyModel) },
	{ name: "store update on a spinner tick", run: (index) => store.update({ spinner: index % 10 }) },
];

const MAX_CALLS = 2_000;
const WARM_UP_MS = 300;
const BUDGET_MS = 1_000;

function measure(entry: Case): { median: number; p95: number; calls: number } {
	let index = 0;
	for (const until = performance.now() + WARM_UP_MS; performance.now() < until && index < MAX_CALLS; index++) entry.run(index);
	const samples: number[] = [];
	for (const until = performance.now() + BUDGET_MS; performance.now() < until && samples.length < MAX_CALLS; index++) {
		const start = performance.now();
		entry.run(index);
		samples.push(performance.now() - start);
	}
	samples.sort((a, b) => a - b);
	return { median: samples[Math.floor(samples.length / 2)], p95: samples[Math.floor(samples.length * 0.95)], calls: samples.length };
}

const results = cases.map((entry) => ({ name: entry.name, ...measure(entry) }));

const width = Math.max(...results.map((result) => result.name.length));
console.log(`${"case".padEnd(width)}  median ms    p95 ms   calls/s   calls`);
for (const result of results) {
	console.log(`${result.name.padEnd(width)}  ${result.median.toFixed(4).padStart(9)}  ${result.p95.toFixed(4).padStart(8)}  ${Math.round(1000 / result.median).toString().padStart(8)}  ${result.calls.toString().padStart(6)}`);
}
console.log(`\nnode ${process.version}; times are per call, after a warm-up.`);

const save = process.argv.indexOf("--save");
if (save >= 0 && process.argv[save + 1]) writeFileSync(process.argv[save + 1], `${JSON.stringify({ node: process.version, results }, null, 2)}\n`);
