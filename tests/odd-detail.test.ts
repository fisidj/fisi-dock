import assert from "node:assert/strict";
import test from "node:test";
import { actionDetail, addAction, detailText, fitDetail, oddAction, stepSummary, type OddAction, type StepActions } from "../lib/odd-detail.ts";
import { visibleWidth } from "../lib/text.ts";

// S60: what each ODD phase is doing, from the tool calls it made.

const CWD = "E:/DEV/project";

test("tool calls become actions; paths are relative to the session folder (S60)", () => {
	assert.deepEqual(oddAction("edit", { path: "E:/DEV/project/lib/tables/table-row.ts" }, CWD), { kind: "edit", target: "lib/tables/table-row.ts" });
	assert.deepEqual(oddAction("edit", { path: "E:\\DEV\\project\\lib\\a.ts" }, CWD), { kind: "edit", target: "lib/a.ts" }, "Windows separators");
	assert.deepEqual(oddAction("write", { file_path: "tests/tables.test.ts" }, CWD), { kind: "write", target: "tests/tables.test.ts" });
	assert.deepEqual(oddAction("read", { path: "D:/other/notes.md" }, CWD), { kind: "read", target: "D:/other/notes.md" }, "outside the folder stays absolute");
	assert.deepEqual(oddAction("grep", { pattern: "renderTable" }, CWD), { kind: "search", target: "renderTable" });
	assert.deepEqual(oddAction("find", { pattern: "**/*.ts" }, CWD), { kind: "search", target: "**/*.ts" });
	assert.deepEqual(oddAction("bash", { command: 'cd "E:/DEV/project" && npm test' }, CWD), { kind: "run", target: "npm test" }, "leading cd dropped");
	assert.deepEqual(oddAction("bash_background", { command: "node --test tests/a.test.ts\necho done" }, CWD), { kind: "run", target: "node --test tests/a.test.ts" }, "first line only");
	assert.deepEqual(oddAction("bash", { command: "git   status   --short" }, CWD), { kind: "run", target: "git status --short" }, "spaces collapsed");
	assert.deepEqual(oddAction("subagent_run", { agent: "gentle-ai-worker", label: "build the tables part", task: "long text" }, CWD), { kind: "agent", target: "worker · build the tables part" });
	assert.deepEqual(oddAction("subagent_run", { agent: "explore", task: "Map the tables folder\nmore" }, CWD), { kind: "agent", target: "explore · Map the tables folder" }, "no label: the task's first line");
	assert.deepEqual(oddAction("mcp__proxy__edit", { path: "lib/a.ts" }, CWD), { kind: "edit", target: "lib/a.ts" }, "MCP proxy names");
	for (const [name, args] of [["todo", { action: "list" }], ["gentle_odd_phase", { phase: "checking" }], ["edit", {}], ["bash", { command: "   " }], ["read", null], ["", undefined]] as const) {
		assert.equal(oddAction(name, args, CWD), undefined, `${name}: no action`);
	}
	assert.deepEqual(oddAction("read", { path: "lib/a.ts" }), { kind: "read", target: "lib/a.ts" }, "no cwd");
});

test("the active step says what its last tool is doing (S60)", () => {
	const detail = (kind: OddAction["kind"], target: string) => actionDetail({ kind, target });
	assert.deepEqual(detail("edit", "lib/a.ts"), { text: "editing lib/a.ts", keepEnd: true });
	assert.deepEqual(detail("write", "lib/a.ts"), { text: "writing lib/a.ts", keepEnd: true });
	assert.deepEqual(detail("read", "lib/a.ts"), { text: "reading lib/a.ts", keepEnd: true });
	assert.deepEqual(detail("search", "renderTable"), { text: 'searching "renderTable"' });
	assert.deepEqual(detail("run", "npm test"), { text: "running npm test" });
	assert.deepEqual(detail("agent", "worker · tables"), { text: "worker · tables" });
});

const sum = (...actions: OddAction[]) => stepSummary(actions.reduce<StepActions | undefined>(addAction, undefined));
const edit = (target: string): OddAction => ({ kind: "edit", target });
const read = (target: string): OddAction => ({ kind: "read", target });
const run = (target: string): OddAction => ({ kind: "run", target });

test("a finished step keeps a summary of what it did: edits, then agents, then commands, then reads (S60)", () => {
	assert.equal(stepSummary(undefined), undefined, "no actions, no summary");
	assert.deepEqual(sum(edit("lib/a.ts")), { text: "edited lib/a.ts", keepEnd: true });
	assert.deepEqual(sum(edit("lib/a.ts"), edit("lib/a.ts")), { text: "edited lib/a.ts", keepEnd: true }, "the same file counts once");
	assert.deepEqual(sum(edit("lib/tables/head.ts"), { kind: "write", target: "lib/tables/row.ts" }, edit("lib/tables/head.ts")), { text: "edited lib/tables/", keepEnd: true, tail: " · 2 files" });
	assert.deepEqual(sum(edit("lib/tables/head.ts"), edit("lib/tables/deep/row.ts")), { text: "edited lib/tables/", keepEnd: true, tail: " · 2 files" }, "deepest common folder");
	assert.deepEqual(sum(edit("a.ts"), edit("lib/b.ts")), { text: "edited 2 files" }, "no common folder");
	assert.deepEqual(sum(read("lib/a.ts"), run("npm test"), { kind: "agent", target: "worker · tables" }, edit("lib/a.ts")), { text: "edited lib/a.ts", keepEnd: true }, "edits win");
	assert.deepEqual(sum(run("npm test"), { kind: "agent", target: "worker · tables" }), { text: "worker · tables" }, "then the last agent");
	assert.deepEqual(sum(read("lib/a.ts"), run("npm test")), { text: "ran npm test" }, "then commands");
	assert.deepEqual(sum(run("node --test a.test.ts"), run("npm test"), run("npm test")), { text: "ran npm test", tail: " · +2 more" }, "the last command and how many before it");
	assert.deepEqual(sum(read("lib/a.ts"), read("lib/a.ts")), { text: "read lib/a.ts", keepEnd: true });
	assert.deepEqual(sum(read("lib/a.ts"), read("lib/b.ts"), read("README.md"), { kind: "search", target: "x" }), { text: "read 3 files · 1 search" });
	assert.deepEqual(sum({ kind: "search", target: "x" }, { kind: "search", target: "y" }), { text: "2 searches" });
	assert.deepEqual(sum(read("lib/a.ts"), { kind: "search", target: "x" }, { kind: "search", target: "y" }), { text: "read 1 file · 2 searches" });
});

const record = (...actions: OddAction[]) => actions.reduce<StepActions | undefined>(addAction, undefined);
const many = (count: number, make: (index: number) => OddAction) => Array.from({ length: count }, (_, index) => make(index));

test("past 256 distinct files a step says 256+ instead of a wrong count, and keeps a bounded record (S61)", () => {
	const flood = record(...many(1000, (index) => edit(`lib/gen/file-${index}.ts`)));
	assert.deepEqual(stepSummary(flood), { text: "edited lib/gen/", keepEnd: true, tail: " · 256+ files" });
	assert.ok(JSON.stringify(flood).length < 20_000, "the record stays small");
	const twice = record(...many(200, (index) => edit(`lib/gen/file-${index}.ts`)), ...many(200, (index) => edit(`lib/gen/file-${index}.ts`)));
	assert.deepEqual(stepSummary(twice), { text: "edited lib/gen/", keepEnd: true, tail: " · 200 files" }, "repeats never count");
	const capped = record(...many(256, (index) => edit(`lib/gen/file-${index}.ts`)), edit("lib/gen/file-0.ts"));
	assert.deepEqual(stepSummary(capped), { text: "edited lib/gen/", keepEnd: true, tail: " · 256 files" }, "a repeat at the cap is still a repeat");
	const past = record(...many(300, (index) => edit(`lib/gen/a/file-${index}.ts`)), edit("lib/other/b.ts"));
	assert.deepEqual(stepSummary(past), { text: "edited lib/", keepEnd: true, tail: " · 256+ files" }, "the folder follows paths past the cap");
	assert.deepEqual(stepSummary(record(...many(300, (index) => read(`docs/page-${index}.md`)))), { text: "read 256+ files" }, "reads too");
});

test("tool arguments lose escape sequences and control characters before they reach the panel (S61)", () => {
	assert.deepEqual(oddAction("bash", { command: "\x1b[31mnpm\x1b[0m test\x07" }, CWD), { kind: "run", target: "npm test" }, "CSI colors and BEL");
	assert.deepEqual(oddAction("bash", { command: "echo \x1b]0;window title\x07done" }, CWD), { kind: "run", target: "echo done" }, "an OSC title sequence");
	assert.deepEqual(oddAction("bash", { command: "echo \x1b]8;;https://x.test\x1b\\link\x1b]8;;\x1b\\" }, CWD), { kind: "run", target: "echo link" }, "an OSC 8 hyperlink");
	assert.deepEqual(oddAction("edit", { path: "lib/\x1b[2Ja.ts" }, CWD), { kind: "edit", target: "lib/a.ts" }, "a screen clear in a path");
	assert.deepEqual(oddAction("read", { path: "lib/\u202Eevil.ts" }, CWD), { kind: "read", target: "lib/evil.ts" }, "bidi overrides");
	assert.deepEqual(oddAction("subagent_run", { agent: "worker\x1b[1m", label: "tab\u0008les\u009b" }, CWD), { kind: "agent", target: "worker · tables" }, "C0 and C1 controls");
	assert.deepEqual(oddAction("grep", { pattern: "a\tb\x00c" }, CWD), { kind: "search", target: "a bc" }, "a tab becomes a space, NUL goes");
	const deep = `E:/DEV/project/${"very-long-folder-name/".repeat(12)}a.ts`;
	assert.deepEqual(oddAction("edit", { path: deep }, CWD), { kind: "edit", target: `${"very-long-folder-name/".repeat(12)}a.ts`.slice(0, 200) }, "a long path loses its session folder before it is bounded");
	assert.equal(oddAction("bash", { command: "\x1b[31m\x1b[0m" }, CWD), undefined, "nothing left to show");
});

test("paths match the session folder case-insensitively only for Windows drive and UNC paths (S61)", () => {
	assert.deepEqual(oddAction("edit", { path: "e:/dev/PROJECT/lib/a.ts" }, "E:/DEV/project"), { kind: "edit", target: "lib/a.ts" }, "Windows drive");
	assert.deepEqual(oddAction("edit", { path: "\\\\Server\\Share\\p\\lib\\a.ts" }, "//server/share/p"), { kind: "edit", target: "lib/a.ts" }, "UNC share");
	assert.deepEqual(oddAction("edit", { path: "/home/u/Project/lib/a.ts" }, "/home/u/project"), { kind: "edit", target: "/home/u/Project/lib/a.ts" }, "POSIX paths are case-sensitive");
	assert.deepEqual(oddAction("edit", { path: "/home/u/project/lib/a.ts" }, "/home/u/project/"), { kind: "edit", target: "lib/a.ts" }, "a trailing slash on the folder");
	assert.deepEqual(oddAction("edit", { path: "/home/u/project-two/a.ts" }, "/home/u/project"), { kind: "edit", target: "/home/u/project-two/a.ts" }, "a sibling folder with the same prefix");
});

test("a detail fits its width: paths keep their end from a folder boundary, the rest is cut at the end (S60)", () => {
	const path = { text: "editing lib/some/very/long/folder/tables/table-row.ts", keepEnd: true };
	assert.equal(fitDetail(path, 60), path.text, "fits as is");
	assert.equal(fitDetail(path, 30), "editing …/tables/table-row.ts", "cut at a /");
	assert.equal(fitDetail({ text: "editing lib/a-very-long-file-name-without-folders.ts", keepEnd: true }, 30), "editing …me-without-folders.ts", "a file name longer than the room: its end");
	assert.equal(fitDetail({ text: "running node --test tests/tables.test.ts" }, 20), "running node --test…");
	for (const width of [41, 20, 9, 5, 2, 1, 0]) {
		for (const detail of [path, { text: "running node --test tests/tables.test.ts" }]) assert.ok(visibleWidth(fitDetail(detail, width)) <= width, `${width}: ${fitDetail(detail, width)}`);
	}
});

test("a summary's count stays whole when its line is cut; only the path before it is cut, at a folder (S61)", () => {
	const folder = { text: "edited lib/some/long/folder/tables/", keepEnd: true, tail: " · 12 files" };
	assert.equal(detailText(folder), "edited lib/some/long/folder/tables/ · 12 files");
	assert.equal(fitDetail(folder, 60), "edited lib/some/long/folder/tables/ · 12 files", "fits as is");
	assert.equal(fitDetail(folder, 30), "edited …/tables/ · 12 files");
	const ran = { text: "ran node --test tests/odd-timeline.test.ts", tail: " · +2 more" };
	assert.equal(fitDetail(ran, 30), "ran node --test tes… · +2 more");
	assert.equal(detailText({ text: "ran npm test" }), "ran npm test", "no tail");
	for (const width of [47, 30, 20, 14, 12, 9, 5, 1, 0]) {
		for (const detail of [folder, ran]) assert.ok(visibleWidth(fitDetail(detail, width)) <= width, `${width}: ${fitDetail(detail, width)}`);
	}
	assert.equal(fitDetail(folder, 12), "edited lib/…", "too narrow for the count: the whole line is cut at the end");
});
