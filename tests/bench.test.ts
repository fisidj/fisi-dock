import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("bench: --save without a file name stops before measuring, with a usage line on stderr and exit code 2", () => {
	const result = spawnSync(process.execPath, ["scripts/bench.ts", "--save"], { cwd: ROOT, encoding: "utf8", timeout: 20_000 });
	assert.equal(result.status, 2, `exit code; stderr: ${result.stderr}`);
	assert.equal(result.stderr.trimEnd(), "bench: --save needs a file name, as in --save tmp/bench.json");
	assert.equal(result.stdout, "");
});
