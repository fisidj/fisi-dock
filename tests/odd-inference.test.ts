import assert from "node:assert/strict";
import test from "node:test";
import { inferOddPhase, oddPhase } from "../lib/odd-inference.ts";

test("read-only tools explore", () => {
	for (const tool of ["read", "grep", "find", "ls", "codegraph", "mcp__custom-tools__read"]) assert.equal(inferOddPhase(tool, {}), "exploring", tool);
});

test("edit and write implement; ODD task documents are planning", () => {
	assert.equal(inferOddPhase("edit", { path: "lib/a.ts" }), "implementing");
	assert.equal(inferOddPhase("write", { file_path: "src/b.ts" }), "implementing");
	assert.equal(inferOddPhase("edit", { path: "odd\\tasks\\fisi-dock.md" }), "planning");
});

test("questions decide, todo plans, reviews check", () => {
	assert.equal(inferOddPhase("ask_user_choice", {}), "deciding");
	assert.equal(inferOddPhase("ask_user_question", {}), "deciding");
	assert.equal(inferOddPhase("todo", { action: "add" }), "planning");
	assert.equal(inferOddPhase("gentle_review", {}), "checking");
});

test("known subagents map by role; unknown roles are no signal", () => {
	assert.equal(inferOddPhase("subagent_run", { agent: "gentle-ai-worker" }), "implementing");
	assert.equal(inferOddPhase("subagent_run", { agent: "gentle-ai-verify" }), "checking");
	assert.equal(inferOddPhase("mcp__x__subagent_run", { agent: "gentle-ai-explore" }), "exploring");
	assert.equal(inferOddPhase("subagent_run", { agent: "someone-else" }), undefined);
	assert.equal(inferOddPhase("subagent_run", {}), undefined);
});

test("shell: test, lint, build and typecheck runners check", () => {
	for (const command of ["npm test", "pnpm run lint", "CI=1 yarn build", "node --test tests/*.test.ts", "npx tsc --noEmit", "go test ./...", "cargo clippy", "cd app && npm run typecheck 2>&1", "gh pr checks 12"]) {
		assert.equal(inferOddPhase("bash", { command }), "checking", command);
	}
	assert.equal(inferOddPhase("powershell", { command: "npm test" }), "checking");
});

test("shell: read-only inspection explores", () => {
	for (const command of ["git status", "git -C repo log --oneline -5", "ls -la && cat a.txt | head", "rg foo src", "git branch --show-current", "sed -n 1,20p a.ts", "find . -name '*.ts'"]) {
		assert.equal(inferOddPhase("bash", { command }), "exploring", command);
	}
});

test("shell: ambiguous, mutating or unknown commands are no signal", () => {
	for (const command of ["npm install", "git commit -m x", "echo hi > out.txt", "sed -i s/a/b/ f", "find . -delete", "./run-something", "rm -rf build", "git branch new-feature", "cd src", ""]) {
		assert.equal(inferOddPhase("bash", { command }), undefined, command);
	}
	assert.equal(inferOddPhase("bash", {}), undefined);
});

test("unknown tools and the explicit phase tool are no signal", () => {
	assert.equal(inferOddPhase("web_search", { query: "x" }), undefined);
	assert.equal(inferOddPhase("gentle_odd_phase", { phase: "checking" }), undefined);
	assert.equal(inferOddPhase("", undefined), undefined);
});

test("phase names: Gentle Shell's eight, with or without the trailing ellipsis", () => {
	for (const phase of ["authorizing", "exploring", "researching", "deciding", "planning", "implementing", "checking", "closing"]) {
		assert.equal(oddPhase(phase), phase);
		assert.equal(oddPhase(`${phase}…`), phase);
	}
	assert.equal(oddPhase("working"), undefined);
	assert.equal(oddPhase(undefined), undefined);
	assert.equal(oddPhase(3), undefined);
});
