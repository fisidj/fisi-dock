// Fisi Dock reads Gentle Shell state through Symbol.for keys, never through imports, so a
// renamed or removed key in Gentle Shell would not fail type checking: Fisi Dock would just
// go quiet. This test reads the installed official Gentle Shell package (gentle-pi, the one
// `gentle-shell --link` loads) and checks that every gentle-pi.* key Fisi Dock reads still
// exists there. It proves the key exists, not the shape of the data behind it. The package
// is GENTLE_SHELL_DIR when set, else gentle-pi in the global npm root (`npm root -g`).
// Skipped when neither gives a folder on this PC.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const FISI_DOCK_DIR = join(import.meta.dirname, "..");
/** GENTLE_SHELL_DIR, else gentle-pi in the global npm root; undefined when npm is missing, fails or prints nothing. */
function gentleShellDir(env: Record<string, string | undefined>, npmRoot: () => string): string | undefined {
	if (env.GENTLE_SHELL_DIR) return env.GENTLE_SHELL_DIR;
	try {
		const root = npmRoot().trim();
		return root ? join(root, "gentle-pi") : undefined;
	} catch {
		return undefined;
	}
}

// npm is npm.cmd on Windows, which runs only through a shell.
const npmGlobalRoot = () => execFileSync("npm", ["root", "-g"], { encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 });
const GENTLE_SHELL_DIR = gentleShellDir(process.env, npmGlobalRoot);
const NO_GENTLE_SHELL = GENTLE_SHELL_DIR === undefined || !existsSync(GENTLE_SHELL_DIR) ? `no Gentle Shell package at ${GENTLE_SHELL_DIR ?? "the global npm root"} (set GENTLE_SHELL_DIR)` : false;
const SOURCE_DIRS = ["extensions", "lib"];
const KEY_PATTERN = /Symbol\.for\(\s*["'](gentle-pi[.:][^"']+)["']/g;

function sourceFiles(root: string): string[] {
	const files: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name !== "node_modules") walk(path);
			} else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
				files.push(path);
			}
		}
	};
	for (const dir of SOURCE_DIRS) if (existsSync(join(root, dir))) walk(join(root, dir));
	return files;
}

function gentlePiKeys(root: string): Set<string> {
	const keys = new Set<string>();
	for (const file of sourceFiles(root)) {
		for (const match of readFileSync(file, "utf8").matchAll(KEY_PATTERN)) keys.add(match[1]);
	}
	return keys;
}

function missingKeys(wanted: Set<string>, available: Set<string>): string[] {
	return [...wanted].filter((key) => !available.has(key)).sort();
}

test("Fisi Dock reads these Gentle Shell keys", () => {
	assert.deepEqual([...gentlePiKeys(FISI_DOCK_DIR)].sort(), [
		"gentle-pi.experimental-sidebar.cache",
		"gentle-pi.experimental-sidebar.state",
		"gentle-pi.odd-phase-registry",
		"gentle-pi.prompt-owner",
		"gentle-pi:session-profile-bindings",
		"gentle-pi:session-profile-freeze",
		"gentle-pi:session-profile-startup-none",
	]);
});

// The prompt box (S88) wraps Gentle Shell's editor and rebuilds the rows its
// `framePromptLines` / `panelPromptRule` paint, counting its `topRowCount` top
// rows. These names are Gentle Shell internals, read here as text only: when an
// update renames or drops one, the box may paint wrong or fall back to the line.
const PROMPT_PIECES: [string, string[]][] = [
	["lib/shell-prompt.ts", ["framePromptLines", "panelPromptRule"]],
	["extensions/gentle-shell.ts", ["topRowCount"]],
];

test("the installed Gentle Shell still defines the prompt pieces the box relies on", { skip: NO_GENTLE_SHELL }, () => {
	for (const [file, names] of PROMPT_PIECES) {
		const path = join(GENTLE_SHELL_DIR!, file);
		assert.ok(existsSync(path), `Gentle Shell at ${GENTLE_SHELL_DIR} has no ${file}: the prompt box (S88) may be broken`);
		const source = readFileSync(path, "utf8");
		for (const name of names) assert.ok(source.includes(name), `Gentle Shell at ${GENTLE_SHELL_DIR} no longer defines ${name} in ${file}: the prompt box (S88) may be broken`);
	}
});

test("a key Gentle Shell no longer defines is reported", () => {
	const wanted = new Set(["gentle-pi.experimental-sidebar.state", "gentle-pi.odd-phase-registry"]);
	assert.deepEqual(missingKeys(wanted, new Set(["gentle-pi.odd-phase-registry"])), ["gentle-pi.experimental-sidebar.state"]);
	assert.deepEqual(missingKeys(wanted, wanted), []);
});

test("every Gentle Shell key Fisi Dock reads still exists in the installed Gentle Shell package", { skip: NO_GENTLE_SHELL }, () => {
	const missing = missingKeys(gentlePiKeys(FISI_DOCK_DIR), gentlePiKeys(GENTLE_SHELL_DIR!));
	assert.deepEqual(missing, [], `Gentle Shell at ${GENTLE_SHELL_DIR} no longer defines: ${missing.join(", ")}`);
});

test("S2 the Gentle Shell package is GENTLE_SHELL_DIR, else gentle-pi in the global npm root; none when npm cannot say", () => {
	assert.equal(gentleShellDir({ GENTLE_SHELL_DIR: "/opt/gentle-pi" }, () => "/usr/lib/node_modules"), "/opt/gentle-pi");
	assert.equal(gentleShellDir({}, () => "/usr/lib/node_modules\n"), join("/usr/lib/node_modules", "gentle-pi"));
	assert.equal(gentleShellDir({ GENTLE_SHELL_DIR: "" }, () => "/usr/lib/node_modules"), join("/usr/lib/node_modules", "gentle-pi"));
	assert.equal(gentleShellDir({}, () => ""), undefined, "npm printed nothing");
	assert.equal(
		gentleShellDir({}, () => {
			throw new Error("npm not found");
		}),
		undefined,
		"npm missing or failing",
	);
});
