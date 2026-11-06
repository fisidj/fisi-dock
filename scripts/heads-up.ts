// Prints the heads-up rows (plain text) for a real folder, read-only: git
// worktree/branch/rev-list queries and the folder's odd/tasks files.
//   node scripts/heads-up.ts <folder>

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { headsUpWarnings, readHeadsUpGit, readOddPlans } from "../lib/heads-up.ts";
import { parseAhead, parseBranch } from "../lib/live-data.ts";
import type { GitExec } from "../lib/live-store.ts";

const cwd = resolve(process.argv[2] ?? process.cwd());

const exec: GitExec = (args) =>
	new Promise((resolve) => {
		execFile("git", args, { cwd, timeout: 3_000, windowsHide: true }, (error, stdout) => resolve({ stdout: String(stdout), code: error ? 1 : 0 }));
	});

const run = async (args: string[]) => {
	const result = await exec(args);
	return result.code === 0 ? result.stdout : undefined;
};

const branch = parseBranch(await run(["rev-parse", "--abbrev-ref", "HEAD"]));
const ahead = parseAhead(await run(["rev-list", "--count", "@{upstream}..HEAD"]));
const { worktrees, unmerged } = await readHeadsUpGit(exec, cwd, branch);
const plans = await readOddPlans(cwd);
const warnings = headsUpWarnings({ worktrees, ahead, unmerged, plans });

console.log(`folder: ${cwd}`);
console.log(`branch: ${branch ?? "(none)"} · ahead: ${ahead ?? "(no upstream)"} · worktrees: ${JSON.stringify(worktrees)} · unmerged: ${JSON.stringify(unmerged)} · plans: ${JSON.stringify(plans)}`);
console.log(warnings.length > 0 ? warnings.map((warning) => `! ${warning.text}`).join("\n") : "(no heads-up: section not drawn)");
