import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { forgetSquashVerdicts, readHeadsUpGit } from "../lib/heads-up.ts";
import type { GitExec } from "../lib/live-store.ts";

// S4: readHeadsUpGit against real git in a throwaway repository. Commits use
// their own identity and no hooks, so global git config does not matter.

const IDENTITY = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=no-hooks"];

function run(cwd: string, args: string[]) {
	return spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

/** Runs a setup step; any failure stops the test with git's own message. */
function git(cwd: string, ...args: string[]): string {
	const result = run(cwd, [...IDENTITY, ...args]);
	if (result.error) throw result.error;
	assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout;
}

function commit(cwd: string, files: Record<string, string>, message: string) {
	for (const [name, text] of Object.entries(files)) writeFileSync(join(cwd, name), text);
	git(cwd, "add", "--", ...Object.keys(files));
	git(cwd, "commit", "-q", "-m", message);
}

/** The GitExec the extension uses, on spawnSync, recording every call's arguments. */
function recordingExec(cwd: string) {
	const calls: string[][] = [];
	const exec: GitExec = async (args) => {
		calls.push(args);
		const result = run(cwd, args);
		if (result.error) throw result.error;
		return { stdout: result.stdout, code: result.status ?? 1 };
	};
	return { exec, calls };
}

test("readHeadsUpGit on a real repository: squash, cherry-pick, real changes, conflict, current branch (S4, S3)", async (t) => {
	if (run(tmpdir(), ["--version"]).status !== 0) return t.skip("git is not installed");
	// The real path: git reports worktrees by it (macOS /var is /private/var, Windows runners use 8.3 short names).
	const repo = realpathSync.native(mkdtempSync(join(tmpdir(), "fisi-dock-heads-up-")));
	t.after(() => rmSync(repo, { recursive: true, force: true }));

	git(repo, "init", "-q", "-b", "main");
	git(repo, "config", "core.autocrlf", "false");
	commit(repo, { "a.txt": "one\ntwo\nthree\n", "b.txt": "base\n" }, "base");
	if (run(repo, ["merge-tree", "--write-tree", "main", "main"]).status !== 0) return t.skip("git merge-tree --write-tree is not supported (git 2.38+)");

	// A branch to cherry-pick later (forked here so the pick is a new commit, not the same one).
	git(repo, "switch", "-q", "-c", "cherry");
	commit(repo, { "c.txt": "cherry\n" }, "cherry");

	// Squash-merged branch with several commits, then main moves on with an unrelated change.
	git(repo, "switch", "-q", "main");
	git(repo, "switch", "-q", "-c", "squashed");
	commit(repo, { "s1.txt": "s1\n" }, "squash 1");
	commit(repo, { "s2.txt": "s2\n" }, "squash 2");
	commit(repo, { "s1.txt": "s1 again\n" }, "squash 3");
	git(repo, "switch", "-q", "main");
	git(repo, "merge", "-q", "--squash", "squashed");
	git(repo, "commit", "-q", "-m", "squashed (#1)");
	commit(repo, { "b.txt": "base\nunrelated\n" }, "unrelated");

	// Cherry-picked onto main.
	git(repo, "cherry-pick", "cherry");

	// A branch with real changes.
	git(repo, "switch", "-q", "-c", "changes");
	commit(repo, { "real.txt": "real\n" }, "real changes");

	// A branch that conflicts with main.
	git(repo, "switch", "-q", "main");
	git(repo, "switch", "-q", "-c", "conflict");
	commit(repo, { "a.txt": "one\nTWO on the branch\nthree\n" }, "conflict branch");
	git(repo, "switch", "-q", "main");
	commit(repo, { "a.txt": "one\nTWO on main\nthree\n" }, "conflict main");

	// The session's own branch, with real changes, checked out.
	git(repo, "switch", "-q", "-c", "current");
	commit(repo, { "current.txt": "current\n" }, "current work");

	forgetSquashVerdicts();
	try {
		const first = recordingExec(repo);
		assert.deepEqual(await readHeadsUpGit(first.exec, repo, "current"), { worktrees: [], unmerged: ["changes", "conflict"] });
		assert.deepEqual(
			first.calls.filter((args) => args[0] === "merge-tree").map((args) => args[3]),
			["changes", "cherry", "conflict", "squashed"],
		);

		// Nothing changed: the remembered verdicts answer, no merge-tree runs (S3).
		const second = recordingExec(repo);
		assert.deepEqual(await readHeadsUpGit(second.exec, repo, "current"), { worktrees: [], unmerged: ["changes", "conflict"] });
		assert.deepEqual(second.calls.filter((args) => args[0] === "merge-tree"), [], "no merge-tree on the second read");

		// A new commit on the cherry-picked branch is checked again, and only it.
		git(repo, "switch", "-q", "cherry");
		commit(repo, { "more.txt": "more\n" }, "more on cherry");
		git(repo, "switch", "-q", "current");
		const third = recordingExec(repo);
		assert.deepEqual(await readHeadsUpGit(third.exec, repo, "current"), { worktrees: [], unmerged: ["changes", "cherry", "conflict"] });
		assert.deepEqual(third.calls.filter((args) => args[0] === "merge-tree").map((args) => args[3]), ["cherry"]);
	} finally {
		forgetSquashVerdicts();
	}
});
