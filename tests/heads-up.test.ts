import assert from "node:assert/strict";
import test from "node:test";
import {
	classifyTaskLine,
	countOpenTasks,
	defaultBranchFrom,
	headsUpWarnings,
	otherWorktrees,
	parseBranchList,
	readHeadsUpGit,
	readOddPlans,
	type PlanFiles,
} from "../lib/heads-up.ts";
import { sessionSnapshot } from "../lib/live-data.ts";
import type { GitExec } from "../lib/live-store.ts";
import type { PanelModel } from "../lib/panel-model.ts";
import { palette, panelVivid } from "../lib/palette.ts";
import { renderPanel } from "../lib/panel.ts";
import { visibleWidth } from "../lib/text.ts";

const plain = (line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

// --- worktrees ---------------------------------------------------------------

const MAIN = "worktree E:/DEV/app\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main\n";

test("worktree porcelain: only the main worktree means nothing open", () => {
	assert.deepEqual(otherWorktrees(MAIN, "E:\\DEV\\app"), []);
	assert.deepEqual(otherWorktrees(MAIN, "E:\\DEV\\app\\src\\deep"), [], "a subfolder of the session worktree is still the session worktree");
});

test("worktree porcelain: two extra worktrees are listed by path", () => {
	const porcelain = `${MAIN}\nworktree E:/DEV/app-feat-x\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/feat-x\n\nworktree E:/DEV/app/.worktrees/fix-y\nHEAD 3333333333333333333333333333333333333333\ndetached\n`;
	assert.deepEqual(otherWorktrees(porcelain, "E:\\DEV\\app"), ["E:/DEV/app-feat-x", "E:/DEV/app/.worktrees/fix-y"]);
});

test("worktree porcelain: bare and prunable entries do not count", () => {
	const porcelain = "worktree E:/DEV/app.git\nbare\n\n" + `${MAIN}\nworktree E:/DEV/gone\nHEAD 4444444444444444444444444444444444444444\nbranch refs/heads/gone\nprunable gitdir file points to non-existent location\n`;
	assert.deepEqual(otherWorktrees(porcelain, "E:/DEV/app"), []);
});

test("worktree porcelain: a session in a linked worktree counts the main one, not itself", () => {
	const porcelain = `${MAIN}\nworktree E:/DEV/app/.worktrees/feat-x\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/feat-x\n`;
	assert.deepEqual(otherWorktrees(porcelain, "e:\\dev\\app\\.worktrees\\feat-x\\lib"), ["E:/DEV/app"]);
	assert.deepEqual(otherWorktrees(undefined, "E:/DEV/app"), []);
	assert.deepEqual(otherWorktrees("garbage\n", "E:/DEV/app"), []);
});

// --- branches ----------------------------------------------------------------

test("branch list: trims, drops the current branch, empty lines and detached entries", () => {
	assert.deepEqual(parseBranchList("feat-x\n  main-ish \n\nfeat/fisi-dock\n(HEAD detached at 1234567)\n", "feat/fisi-dock"), ["feat-x", "main-ish"]);
	assert.deepEqual(parseBranchList(undefined, "main"), []);
});

test("default branch: origin/HEAD first, then main, then master, else none", () => {
	assert.equal(defaultBranchFrom("refs/remotes/origin/develop\n", true, true), "develop");
	assert.equal(defaultBranchFrom("origin/trunk", false, false), "trunk");
	assert.equal(defaultBranchFrom(undefined, true, true), "main");
	assert.equal(defaultBranchFrom("", false, true), "master");
	assert.equal(defaultBranchFrom(undefined, false, false), undefined);
});

// --- ODD task lines ----------------------------------------------------------

test("task lines: done markers, checkboxes, pending and commits", () => {
	assert.equal(classifyTaskLine("- T1 [S1] Spike. Route: explore. Commit: none. Done (L6)."), "done");
	assert.equal(classifyTaskLine("- T4 [S2] Adapters. Commit: 353520b. Done (83/83). Real-runtime check pending user."), "done");
	assert.equal(classifyTaskLine("- T10 [S14] Heads-up. Route: worker. Commit: pending."), "open");
	assert.equal(classifyTaskLine("- T8 [S1] Install. Commit: f953816 (README). Pending: user's real-runtime check."), "open");
	assert.equal(classifyTaskLine("- T2 — S3: registry; inline; done, commit `bb9b3a258`."), "done");
	assert.equal(classifyTaskLine("- T3 — S3: tools; inline, commit 4d266722d."), "done");
	assert.equal(classifyTaskLine("- T5 [S2] inline — in_progress — user authorized smaller commits"), "open");
	assert.equal(classifyTaskLine("- T6 [S1] Write docs."), "open");
	assert.equal(classifyTaskLine("- [x] T1: Confirm discovery."), "done");
	assert.equal(classifyTaskLine("- [X] Merge the branch."), "done");
	assert.equal(classifyTaskLine("- [ ] T3 Packed proof. Done when CI passes."), "open", "an open checkbox wins over words");
	assert.equal(classifyTaskLine("* [ ] Open the PR"), "open");
});

test("task lines: indented sub-items, notes and other lists are not tasks", () => {
	assert.equal(classifyTaskLine("  - T5a — S11: batcher; done, commit `172c1295f`."), undefined);
	assert.equal(classifyTaskLine("- C1 [T2/S2] committed 2f716b3"), undefined);
	assert.equal(classifyTaskLine("Some prose about T1."), undefined);
	assert.equal(classifyTaskLine("- Note: incomplete data"), undefined);
});

test("open task count: only lines inside the ## Tasks section", () => {
	const doc = [
		"# Feature: x",
		"## Specs",
		"- [ ] S1 not a task",
		"- T9 not in the tasks section",
		"## Tasks",
		"- T1 [S1] A. Commit: abc1234. Done.",
		"- T2 [S1] B. Commit: pending.",
		"  - T2a sub-step, pending",
		"### Local review units",
		"- C1 planned",
		"- [ ] R1 checkbox task under a subheading",
		"## Log",
		"- T3 pending in the log",
	].join("\n");
	assert.equal(countOpenTasks(doc), 2);
	assert.equal(countOpenTasks("## Tasks and routing\n- [x] T1 done\n- [ ] T2 next\n"), 1);
	assert.equal(countOpenTasks("## Tasks\n- [x] T1\n- T2 Done.\n"), 0);
	assert.equal(countOpenTasks("# Plan\n- [ ] T1 something\n"), undefined, "no Tasks section: ignored");
	assert.equal(countOpenTasks("## Tasks\nJust prose, no task lines.\n"), undefined, "no recognizable task lines: ignored");
});

function memoryFiles(files: Record<string, string>, sizes: Record<string, number> = {}): PlanFiles & { reads: string[] } {
	const reads: string[] = [];
	return {
		reads,
		list: async (dir) => {
			if (!dir.replaceAll("\\", "/").endsWith("odd/tasks")) throw new Error("ENOENT");
			return Object.keys(files);
		},
		size: async (path) => sizes[path.replaceAll("\\", "/").split("/").at(-1)!] ?? 100,
		read: async (path) => {
			const name = path.replaceAll("\\", "/").split("/").at(-1)!;
			reads.push(name);
			return files[name];
		},
	};
}

test("odd plans: one entry per plan with open tasks, sorted, big and non-md files skipped", async () => {
	const files = memoryFiles(
		{
			"zeta.md": "## Tasks\n- T1 x. Commit: pending.\n",
			"fisi-dock.md": "## Tasks\n- T1 a. Done.\n- T2 b. Commit: pending.\n- [ ] T3 c\n",
			"finished.md": "## Tasks\n- [x] T1 done\n",
			"notes.txt": "## Tasks\n- T1 open\n",
			"huge.md": "## Tasks\n- T1 open\n",
			"loose.md": "# no tasks\n",
		},
		{ "huge.md": 300 * 1024 },
	);
	assert.deepEqual(await readOddPlans("E:/DEV/app", files), [
		{ name: "fisi-dock", open: 2 },
		{ name: "zeta", open: 1 },
	]);
	assert.ok(!files.reads.includes("huge.md"), "files over 200 KB are not read");
	assert.ok(!files.reads.includes("notes.txt"));
	assert.equal(await readOddPlans("E:/DEV/no-odd", { ...files, list: async () => Promise.reject(new Error("ENOENT")) }), undefined);
	assert.equal(await readOddPlans("", files), undefined);
});

// --- git reader --------------------------------------------------------------

const ok = (stdout: string) => Promise.resolve({ stdout, code: 0 });
const fail = () => Promise.resolve({ stdout: "", code: 1 });

test("readHeadsUpGit reads worktrees and branches not merged into the default branch", async () => {
	const calls: string[][] = [];
	const exec: GitExec = (args) => {
		calls.push(args);
		if (args[0] === "worktree") return ok(`${MAIN}\nworktree E:/DEV/app-x\nHEAD 2\nbranch refs/heads/x\n`);
		if (args[0] === "symbolic-ref") return fail();
		if (args[0] === "rev-parse") return args.at(-1) === "refs/heads/main" ? fail() : ok("abc\n");
		return ok("feat-x\nfeat/fisi-dock\n");
	};
	assert.deepEqual(await readHeadsUpGit(exec, "E:/DEV/app", "feat/fisi-dock"), { worktrees: ["E:/DEV/app-x"], unmerged: ["feat-x"] });
	assert.deepEqual(calls, [
		["worktree", "list", "--porcelain"],
		["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
		["rev-parse", "--verify", "--quiet", "refs/heads/main"],
		["rev-parse", "--verify", "--quiet", "refs/heads/master"],
		["branch", "--format=%(refname:short)", "--no-merged", "master"],
	]);
});

test("readHeadsUpGit outside a repository or without a default branch reports nothing", async () => {
	const outside: GitExec = () => Promise.resolve({ stdout: "", code: 128 });
	assert.deepEqual(await readHeadsUpGit(outside, "E:/tmp", undefined), { worktrees: undefined, unmerged: undefined });
	const throws: GitExec = () => Promise.reject(new Error("git missing"));
	assert.deepEqual(await readHeadsUpGit(throws, "E:/tmp", undefined), { worktrees: undefined, unmerged: undefined });
});

// --- warnings ----------------------------------------------------------------

test("warnings: counts first, singular forms name the item, nothing when all is clear", () => {
	assert.deepEqual(headsUpWarnings({}), []);
	assert.deepEqual(headsUpWarnings({ worktrees: [], unmerged: [], plans: [], ahead: 0, todoLeft: 0 }), []);
	const many = headsUpWarnings({
		worktrees: ["E:/DEV/app-a", "E:/DEV/app-b"],
		todoLeft: 3,
		ahead: 4,
		unmerged: ["feat-x", "feat-y"],
		plans: [{ name: "fisi-dock", open: 2 }],
	});
	assert.deepEqual(many.map((warning) => warning.text), ["2 worktrees open", "3 todo tasks left", "4 commits not pushed", "2 branches not merged", "ODD plan fisi-dock: 2 open"]);
	const one = headsUpWarnings({ worktrees: ["E:\\DEV\\app\\.worktrees\\feat-x"], todoLeft: 1, ahead: 1, unmerged: ["feat-x"] });
	assert.deepEqual(one.map((warning) => warning.text), ["worktree open: feat-x", "1 todo task left", "1 commit not pushed", "branch not merged: feat-x"]);
	assert.equal(many.find((warning) => warning.kind === "unpushed")?.kind, "unpushed");
});

const openTodo = { done: 1, total: 5, active: "a", next: "b", more: 2 };

test("todo-left warning appears only after the run settled and clears with a new request", () => {
	const kinds = (model: PanelModel) => (model.headsUp ?? []).map((warning) => warning.text);
	assert.deepEqual(kinds(sessionSnapshot({ project: "app", todo: openTodo })), [], "while the run is going, open tasks are normal");
	assert.deepEqual(kinds(sessionSnapshot({ project: "app", todo: openTodo, runSettled: true })), ["4 todo tasks left"]);
	assert.deepEqual(kinds(sessionSnapshot({ project: "app", todo: { done: 5, total: 5, more: 0 }, runSettled: true })), []);
	assert.deepEqual(kinds(sessionSnapshot({ project: "app", todo: openTodo, runSettled: false })), []);
	assert.equal(sessionSnapshot({ project: "app" }).headsUp, undefined, "no warnings: no heads-up field");
});

test("ahead count becomes a warning and leaves the session row (S8)", () => {
	const model = sessionSnapshot({ project: "app", branch: "main", ahead: 4 });
	assert.deepEqual(model.headsUp?.map((warning) => warning.text), ["4 commits not pushed"]);
	const lines = renderPanel(model, 47).map(plain);
	const project = lines.find((line) => line.includes("project"))!;
	assert.match(project, /project +app  main +│$/);
	assert.ok(!lines.some((line) => line.includes("↑")), "no ↑N anywhere once the warning shows");
	assert.ok(lines.some((line) => line.includes("! 4 commits not pushed")));
	const synced = renderPanel(sessionSnapshot({ project: "app", branch: "main", ahead: 0 }), 47).map(plain);
	assert.ok(!synced.some((line) => line.includes("heads-up")));
});

// --- renderer ----------------------------------------------------------------

const base: PanelModel = {
	session: { project: "app", branch: "main" },
	todo: { done: 1, total: 2, active: "x", more: 0 },
	odd: { steps: [{ phase: "exploring", state: "active", seconds: 3 }] },
	agents: [{ name: "explore", task: "map", state: "running" }],
	changes: [{ status: "M", path: "a.ts", added: 1, removed: 0 }],
	footer: { cost: 0 },
};

test("heads-up section is absent without warnings", () => {
	assert.ok(!renderPanel(base, 47).map(plain).some((line) => line.includes("heads-up")));
	assert.ok(!renderPanel({ ...base, headsUp: [] }, 47).map(plain).some((line) => line.includes("heads-up")));
});

test("heads-up sits right after session, before ODD, with a vivid red title and a gray frame", () => {
	const lines = renderPanel({ ...base, headsUp: [{ kind: "worktrees", text: "2 worktrees open" }] }, 47);
	const titles = ["╭─ session", "╭─ heads-up", "╭─ ODD", "╭─ agents", "╭─ todo", "╭─ changes"].map((title) => lines.map(plain).findIndex((line) => line.startsWith(title)));
	for (const index of titles) assert.ok(index > 0);
	assert.deepEqual(titles, titles.toSorted((a, b) => a - b));
	const top = lines[titles[1]];
	const [r, g, b] = panelVivid(palette.red);
	assert.ok(top.includes(`\x1b[1m\x1b[38;2;${r};${g};${b}mheads-up`), "title in bold vivid red");
	assert.ok(!top.startsWith(`\x1b[38;2;${r};${g};${b}m`), "frame is dimmed, not full red");
	assert.equal(plain(lines[titles[1] + 1]), `│ ! 2 worktrees open${" ".repeat(47 - 4 - 18)} │`);
});

test("heads-up shows at most 5 rows; the rest collapse into +N more", () => {
	const headsUp = Array.from({ length: 8 }, (_, index) => ({ kind: "plan" as const, text: `ODD plan p${index}: 1 open` }));
	const lines = renderPanel({ ...base, headsUp }, 47).map(plain);
	const start = lines.findIndex((line) => line.startsWith("╭─ heads-up"));
	const end = lines.findIndex((line, index) => index > start && line.startsWith("╰"));
	const rows = lines.slice(start + 1, end);
	assert.equal(rows.length, 5);
	assert.match(rows[3], /! ODD plan p3: 1 open/);
	assert.match(rows[4], /^│ {3}\+4 more +│$/);
	const five = renderPanel({ ...base, headsUp: headsUp.slice(0, 5) }, 47).map(plain);
	const fiveStart = five.findIndex((line) => line.startsWith("╭─ heads-up"));
	const fiveRows = five.slice(fiveStart + 1, five.findIndex((line, index) => index > fiveStart && line.startsWith("╰")));
	assert.equal(fiveRows.length, 5);
	assert.ok(fiveRows.every((line) => line.includes("!")), "exactly 5 warnings: all shown, no +N more");
});

test("heads-up rows fit at 47, 30 and 20 columns with long names", () => {
	const headsUp = headsUpWarnings({
		worktrees: ["E:/DEV/a-very-long-worktree-folder-name-that-never-ends"],
		todoLeft: 12,
		ahead: 123,
		unmerged: ["feature/an-extremely-long-branch-name-with-many-segments"],
		plans: [{ name: "a-really-long-odd-plan-name-for-a-big-feature", open: 17 }],
	});
	for (const width of [47, 30, 20]) {
		const lines = renderPanel({ ...base, headsUp }, width);
		for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${JSON.stringify(plain(line))}`);
		const shown = lines.map(plain);
		assert.ok(shown.some((line) => line.includes("heads-up")));
		console.log(`--- heads-up at ${width}\n${shown.filter((line) => line.includes("!") || line.includes("heads-up")).join("\n")}`);
	}
});
