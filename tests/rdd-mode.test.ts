import assert from "node:assert/strict";
import test from "node:test";
import { createReviewModeReader, gentleAiBinary, parseReviewMode, reviewModeArgs } from "../lib/rdd-mode.ts";

// Captured from the real binary (gentle-ai 4.3.1 bundled in gentle-pi 4.6.0,
// `.gentle-ai/v4.3.1/gentle-ai.exe`) on 2026-11-05: `review mode status --json`
// in this repository, the same from a scratch HOME after `review mode disable
// --scope global --global-only` (never the real one), and `--global-only --json`
// in a fresh scratch HOME where nobody has chosen (decided by default).
const JSON_ON = `{
  "schema": "gentle-ai.review-mode/v1",
  "operation": "status",
  "scope": "both",
  "status": {
    "schema": "gentle-ai.rdd-mode-status/v1",
    "global": "on",
    "clone_local": "",
    "effective": "on",
    "source": "global"
  }
}
`;
const JSON_OFF = `{
  "schema": "gentle-ai.review-mode/v1",
  "operation": "status",
  "scope": "both",
  "status": {
    "schema": "gentle-ai.rdd-mode-status/v1",
    "global": "off",
    "clone_local": "",
    "effective": "off",
    "source": "global"
  }
}
`;
const JSON_DEFAULT = `{
  "schema": "gentle-ai.review-mode/v1",
  "operation": "status",
  "scope": "global",
  "status": {
    "schema": "gentle-ai.rdd-mode-status/v1",
    "global": "",
    "clone_local": "",
    "effective": "on",
    "source": "default"
  }
}
`;
// The same command without --json.
const PLAIN_ON = `receipt-driven development: on (decided by global)
  global:      on
  clone-local: unset
`;
const PLAIN_OFF = `receipt-driven development: off (decided by global)
  global:      off
  clone-local: unset
`;

test("parseReviewMode reads the effective mode from the --json output of gentle-ai review mode status (S85)", () => {
	assert.equal(parseReviewMode(JSON_ON), "on");
	assert.equal(parseReviewMode(JSON_OFF), "off");
	assert.equal(parseReviewMode(JSON_DEFAULT), "on", "nobody chose: on by default, as the binary says");
});

test("parseReviewMode reads the plain output too, and nothing else (S85)", () => {
	assert.equal(parseReviewMode(PLAIN_ON), "on");
	assert.equal(parseReviewMode(PLAIN_OFF), "off");
	assert.equal(parseReviewMode(""), undefined);
	assert.equal(parseReviewMode("   \n"), undefined);
	assert.equal(parseReviewMode("gentle-ai: unknown command"), undefined);
	assert.equal(parseReviewMode('{"status":{"effective":"maybe"}}'), undefined, "an unknown effective value is no mode");
	assert.equal(parseReviewMode('{"status":"on"}'), undefined);
	assert.equal(parseReviewMode("[1,2]"), undefined);
	assert.equal(parseReviewMode("receipt-driven development: unknown"), undefined);
});

test("reviewModeArgs: the read-only status command for the session folder, --json; without a folder the global answer (S85)", () => {
	assert.deepEqual(reviewModeArgs("E:\\DEV\\app"), ["review", "mode", "status", "--cwd", "E:\\DEV\\app", "--json"]);
	assert.deepEqual(reviewModeArgs(""), ["review", "mode", "status", "--json"]);
});

/** A fake file system: `files` exist, `dirs` list their entries. */
function fakeFs(files: string[], dirs: Record<string, string[]> = {}) {
	const normal = (path: string) => path.replace(/\\/g, "/");
	const present = new Set(files.map(normal));
	return {
		existsSync: (path: string) => present.has(normal(path)),
		readdirSync: (path: string) => {
			const entries = dirs[normal(path)];
			if (!entries) throw new Error(`ENOENT: ${path}`);
			return entries;
		},
	};
}

const win = { platform: "win32", homedir: "C:\\Users\\me", execPath: "C:\\Program Files\\nodejs\\node.exe" };
const nix = { platform: "linux", homedir: "/home/me", execPath: "/usr/local/bin/node" };
const PACKAGE = "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\gentle-pi";
const injection = (...paths: string[]) => JSON.stringify({ version: 1, noExtensions: true, extensionPaths: paths });

test("gentleAiBinary: gentle-ai on PATH first (gentle-ai.exe on Windows, gentle-ai elsewhere) (S85)", () => {
	const fs = fakeFs(["C:/tools/gentle-ai.exe", "C:/other/gentle-ai", `${PACKAGE.replace(/\\/g, "/")}/.gentle-ai/v4.3.1/gentle-ai.exe`], { [`${PACKAGE.replace(/\\/g, "/")}/.gentle-ai`]: ["v4.3.1"] });
	assert.equal(gentleAiBinary({ Path: "C:\\other;C:\\tools", APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, { ...win, fs }), "C:\\tools\\gentle-ai.exe", "a bare gentle-ai file is not a Windows executable");
	assert.equal(gentleAiBinary({ PATH: "/usr/bin:/opt/ai/bin" }, { ...nix, fs: fakeFs(["/opt/ai/bin/gentle-ai"]) }), "/opt/ai/bin/gentle-ai");
	assert.equal(gentleAiBinary({ PATH: "/usr/bin" }, { ...nix, fs: fakeFs(["/usr/bin/gentle-ai.exe"]) }), undefined, "an .exe is not a Linux binary");
});

test("gentleAiBinary: else the binary bundled in the package the launcher injects, newest version first (S85)", () => {
	const root = "E:/tools/gentle-pi";
	const fs = fakeFs([`${root}/.gentle-ai/v4.3.1/gentle-ai.exe`, `${root}/.gentle-ai/v4.10.0/gentle-ai.exe`, `${root}/.gentle-ai/v5.0.0-rc.1/gentle-ai.exe`], { [`${root}/.gentle-ai`]: ["v4.3.1", "v4.10.0", "v5.0.0-rc.1", "notes.txt"] });
	const env = { Path: "C:\\nothing", GENTLE_SHELL_CHILD_PACKAGE_INJECTION: injection("E:\\DEV\\fisi-dock", "E:\\tools\\gentle-pi") };
	assert.equal(gentleAiBinary(env, { ...win, fs }), "E:\\tools\\gentle-pi\\.gentle-ai\\v5.0.0-rc.1\\gentle-ai.exe", "the first injected path without a bundle is skipped");
	const partial = fakeFs([`${root}/.gentle-ai/v4.3.1/gentle-ai.exe`], { [`${root}/.gentle-ai`]: ["v4.10.0", "v4.3.1"] });
	assert.equal(gentleAiBinary(env, { ...win, fs: partial }), "E:\\tools\\gentle-pi\\.gentle-ai\\v4.3.1\\gentle-ai.exe", "a version folder without the binary is skipped");
	for (const bad of ["", "nope", "{}", JSON.stringify({ version: 1, extensionPaths: "x" }), JSON.stringify({ version: 1, extensionPaths: [3] })]) {
		assert.equal(gentleAiBinary({ Path: "C:\\nothing", GENTLE_SHELL_CHILD_PACKAGE_INJECTION: bad }, { ...win, fs }), undefined, JSON.stringify(bad));
	}
});

test("gentleAiBinary: else the global npm package: %APPDATA%\\npm\\node_modules\\gentle-pi on Windows, the usual prefixes elsewhere (S85)", () => {
	const appdata = fakeFs([`${PACKAGE.replace(/\\/g, "/")}/.gentle-ai/v4.3.1/gentle-ai.exe`], { [`${PACKAGE.replace(/\\/g, "/")}/.gentle-ai`]: ["v4.3.1"] });
	assert.equal(gentleAiBinary({ Path: "C:\\nothing", APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, { ...win, fs: appdata }), `${PACKAGE}\\.gentle-ai\\v4.3.1\\gentle-ai.exe`);
	const nodeDir = fakeFs(["C:/Program Files/nodejs/node_modules/gentle-pi/.gentle-ai/v4.3.1/gentle-ai.exe"], { "C:/Program Files/nodejs/node_modules/gentle-pi/.gentle-ai": ["v4.3.1"] });
	assert.equal(gentleAiBinary({ Path: "C:\\nothing", APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, { ...win, fs: nodeDir }), "C:\\Program Files\\nodejs\\node_modules\\gentle-pi\\.gentle-ai\\v4.3.1\\gentle-ai.exe", "node's own prefix");
	const prefix = fakeFs(["/opt/npm/lib/node_modules/gentle-pi/.gentle-ai/v4.3.1/gentle-ai"], { "/opt/npm/lib/node_modules/gentle-pi/.gentle-ai": ["v4.3.1"] });
	assert.equal(gentleAiBinary({ PATH: "/usr/bin", NPM_CONFIG_PREFIX: "/opt/npm" }, { ...nix, fs: prefix }), "/opt/npm/lib/node_modules/gentle-pi/.gentle-ai/v4.3.1/gentle-ai");
	const usrLocal = fakeFs(["/usr/local/lib/node_modules/gentle-pi/.gentle-ai/v4.3.1/gentle-ai"], { "/usr/local/lib/node_modules/gentle-pi/.gentle-ai": ["v4.3.1"] });
	assert.equal(gentleAiBinary({ PATH: "/usr/bin" }, { ...nix, fs: usrLocal }), "/usr/local/lib/node_modules/gentle-pi/.gentle-ai/v4.3.1/gentle-ai");
	const home = fakeFs(["/home/me/.npm-global/lib/node_modules/gentle-pi/.gentle-ai/v4.3.1/gentle-ai"], { "/home/me/.npm-global/lib/node_modules/gentle-pi/.gentle-ai": ["v4.3.1"] });
	assert.equal(gentleAiBinary({ PATH: "/usr/bin" }, { ...nix, fs: home }), "/home/me/.npm-global/lib/node_modules/gentle-pi/.gentle-ai/v4.3.1/gentle-ai");
	assert.equal(gentleAiBinary({ PATH: "/usr/bin" }, { ...nix, fs: fakeFs([]) }), undefined, "nothing anywhere: no binary, no section");
	assert.equal(gentleAiBinary({}, { ...win, fs: fakeFs([]) }), undefined, "no PATH, no APPDATA: nothing to look at");
});

test("the reader never runs two calls at once, and a failed or unreadable read keeps the last known mode (S85)", async () => {
	const modes: string[] = [];
	let answer: { stdout: string; code: number } | Error = { stdout: JSON_ON, code: 0 };
	let inFlight = 0;
	let maxInFlight = 0;
	let calls = 0;
	let release: (() => void) | undefined;
	const exec = async (command: string, args: string[]) => {
		assert.equal(command, "C:\\tools\\gentle-ai.exe");
		assert.deepEqual(args, reviewModeArgs("E:\\DEV\\app"));
		calls++;
		inFlight++;
		maxInFlight = Math.max(maxInFlight, inFlight);
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		inFlight--;
		if (answer instanceof Error) throw answer;
		return answer;
	};
	const read = createReviewModeReader({ exec, binary: "C:\\tools\\gentle-ai.exe", cwd: "E:\\DEV\\app", onMode: (mode) => void modes.push(mode) });
	read();
	read();
	read();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(calls, 1, "the triggers that arrive in flight collapse into one more run");
	release!();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.deepEqual(modes, ["on"]);
	assert.equal(calls, 2, "one more run after the first");
	answer = { stdout: JSON_OFF, code: 0 };
	release!();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.deepEqual(modes, ["on", "off"]);
	assert.equal(maxInFlight, 1, "never two calls in flight");
	for (const failure of [{ stdout: "", code: 1 }, { stdout: "boom", code: 0 }, new Error("timeout")]) {
		answer = failure;
		read();
		await new Promise((resolve) => setTimeout(resolve, 5));
		release!();
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.deepEqual(modes, ["on", "off"], "failures report nothing: the last known mode stays");
	answer = { stdout: PLAIN_ON, code: 0 };
	read();
	await new Promise((resolve) => setTimeout(resolve, 5));
	release!();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.deepEqual(modes, ["on", "off", "on"]);
});

test("the reader without a binary never runs anything (S85)", async () => {
	let calls = 0;
	const read = createReviewModeReader({ exec: async () => (calls++, { stdout: JSON_ON, code: 0 }), binary: undefined, cwd: "E:\\DEV\\app", onMode: () => assert.fail("no mode without a binary") });
	read();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(calls, 0);
});
