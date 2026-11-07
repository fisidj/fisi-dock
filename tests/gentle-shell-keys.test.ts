// Fisi Dock reads Gentle Shell state through Symbol.for keys, never through imports, so a
// renamed or removed key in Gentle Shell would not fail type checking: Fisi Dock would just
// go quiet. This test reads the installed official Gentle Shell package (gentle-pi, the one
// `gentle-shell --link` loads) and checks that every gentle-pi.* key Fisi Dock reads still
// exists there. It proves the key exists, not the shape of the data behind it. The package
// is GENTLE_SHELL_DIR when set, else the one Gentle Shell itself loads (the package its
// launcher injects into a session, else the `gentle-shell` launcher's own on PATH: pnpm and
// npm alike), else gentle-pi in the global npm root (`npm root -g`); among several, the
// version provisioned for the agent home in ~/.gentle-shell/config.json. Every candidate must
// be a folder whose package.json is gentle-pi's. Skipped when none is found on this PC (CI).
import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";
import test from "node:test";
import { injectedPaths } from "../lib/rdd-mode.ts";

const FISI_DOCK_DIR = join(import.meta.dirname, "..");

/** The disk the resolver reads; both may throw. */
interface PackageFs {
	readFile(path: string): string;
	realpath(path: string): string;
}

interface PackageSources {
	/** The user's home, for ~/.gentle-shell. */
	home: string;
	platform: string;
	fs: PackageFs;
	/** `npm root -g`; may throw. */
	npmRoot: () => string;
}

// The script a launcher shim runs: pnpm's sh shim names it absolutely, sh shims beside
// $basedir, .cmd shims beside %~dp0 (pnpm) or %dp0% (npm). Only scripts: not node itself.
const SHIM_TARGETS = [/^# cmd-shim-target=(.+?)\s*$/gm, /"\$basedir\/([^"]+)"/g, /"%(?:~dp0|dp0%)\\([^"]+)"/g];
const SCRIPT = /\.[cm]?js$/;

/**
 * The Gentle Shell package to check: GENTLE_SHELL_DIR, else the packages Gentle Shell itself
 * loads (the extension paths its launcher injects, then each `gentle-shell` launcher on PATH),
 * then gentle-pi in the global npm root. Only folders whose package.json is named gentle-pi
 * count; among them the version provisioned for the agent home in the launcher's config.json
 * (GENTLE_SHELL_CONFIG, else ~/.gentle-shell/config.json) wins, else the first found.
 * Undefined when there is none.
 */
function gentleShellDir(env: Record<string, string | undefined>, sources: PackageSources): string | undefined {
	const path = sources.platform === "win32" ? win32 : posix;
	const { fs } = sources;
	const attempt = <T>(read: () => T): T | undefined => {
		try {
			return read();
		} catch {
			return undefined;
		}
	};
	const versionAt = (dir: string): string | undefined => {
		const manifest = attempt(() => JSON.parse(fs.readFile(path.join(dir, "package.json"))) as { name?: unknown; version?: unknown } | null);
		return manifest?.name === "gentle-pi" ? (typeof manifest.version === "string" ? manifest.version : "") : undefined;
	};
	const packageAbove = (start: string): string | undefined => {
		for (let dir = start; ; dir = path.dirname(dir)) {
			if (versionAt(dir) !== undefined) return dir;
			if (path.dirname(dir) === dir) return undefined;
		}
	};
	if (env.GENTLE_SHELL_DIR && versionAt(env.GENTLE_SHELL_DIR) !== undefined) return env.GENTLE_SHELL_DIR;

	const launcherScripts = function* (): Generator<string> {
		const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH");
		const names = sources.platform === "win32" ? ["gentle-shell.cmd", "gentle-shell"] : ["gentle-shell"];
		for (const dir of (pathKey ? env[pathKey] ?? "" : "").split(path.delimiter).filter(Boolean)) {
			for (const name of names) {
				const launcher = path.join(dir, name);
				const real = attempt(() => fs.realpath(launcher));
				if (real === undefined) continue;
				if (SCRIPT.test(real)) yield real;
				const shim = attempt(() => fs.readFile(launcher)) ?? "";
				for (const [index, pattern] of SHIM_TARGETS.entries()) {
					for (const match of shim.matchAll(pattern)) {
						const script = index === 0 ? path.normalize(match[1]) : path.join(dir, match[1]);
						if (SCRIPT.test(script)) yield attempt(() => fs.realpath(script)) ?? script;
					}
				}
			}
		}
	};
	const candidates = function* (): Generator<string | undefined> {
		for (const extension of injectedPaths(env) ?? []) yield packageAbove(extension);
		for (const script of launcherScripts()) yield packageAbove(path.dirname(script));
		const root = attempt(() => sources.npmRoot().trim());
		if (root) yield versionAt(path.join(root, "gentle-pi")) !== undefined ? path.join(root, "gentle-pi") : undefined;
	};

	const agentHome = env.GENTLE_PI_AGENT_HOME || env.PI_CODING_AGENT_DIR || path.join(sources.home, ".gentle-shell", "agent");
	const configPath = env.GENTLE_SHELL_CONFIG || path.join(sources.home, ".gentle-shell", "config.json");
	const config = attempt(() => JSON.parse(fs.readFile(configPath)) as { provisioned?: Record<string, { gentlePi?: unknown }> } | null);
	const provisioned = config?.provisioned?.[attempt(() => fs.realpath(agentHome)) ?? agentHome]?.gentlePi;
	const wanted = typeof provisioned === "string" ? provisioned : undefined;
	let first: string | undefined;
	for (const dir of candidates()) {
		if (dir === undefined) continue;
		if (wanted === undefined || versionAt(dir) === wanted) return dir;
		first ??= dir;
	}
	return first;
}

// npm is npm.cmd on Windows, which runs only through a shell; there the fixed
// command line goes as one string, since a shell with separate arguments is deprecated.
const npmGlobalRoot = () => {
	const options = { encoding: "utf8" as const, stdio: ["ignore", "pipe", "ignore"] as ("ignore" | "pipe")[], timeout: 15_000 };
	return process.platform === "win32" ? execSync("npm root -g", options) : execFileSync("npm", ["root", "-g"], options);
};
const GENTLE_SHELL_DIR = gentleShellDir(process.env, {
	home: homedir(),
	platform: process.platform,
	fs: { readFile: (path) => readFileSync(path, "utf8"), realpath: (path) => realpathSync(path) },
	npmRoot: npmGlobalRoot,
});
const NO_GENTLE_SHELL =
	GENTLE_SHELL_DIR === undefined ? "no Gentle Shell package found (GENTLE_SHELL_DIR, the injected package, the gentle-shell launcher on PATH, the global npm root): set GENTLE_SHELL_DIR" : false;
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

// A fake disk for the resolver: file bodies and symlinks by path (either slash). No real home is read.
function fakeDisk(files: Record<string, string>, links: Record<string, string> = {}): PackageFs {
	const normal = (path: string) => path.replace(/\\/g, "/");
	const bodies = new Map(Object.entries(files).map(([path, body]) => [normal(path), body]));
	const targets = new Map(Object.entries(links).map(([path, target]) => [normal(path), target]));
	return {
		readFile: (path) => {
			const body = bodies.get(normal(path));
			if (body === undefined) throw new Error(`ENOENT: ${path}`);
			return body;
		},
		realpath: (path) => {
			const target = targets.get(normal(path));
			if (target !== undefined) return target;
			if (!bodies.has(normal(path))) throw new Error(`ENOENT: ${path}`);
			return path;
		},
	};
}
const gentlePi = (version: string) => JSON.stringify({ name: "gentle-pi", version });
const injected = (...paths: string[]) => JSON.stringify({ version: 1, noExtensions: false, extensionPaths: paths });
const nix = { home: "/home/me", platform: "linux" };
const noNpm = () => {
	throw new Error("npm not found");
};

test("S2 the Gentle Shell package is GENTLE_SHELL_DIR, else gentle-pi in the global npm root; none when npm cannot say", () => {
	const fs = fakeDisk({ "/opt/gentle-pi/package.json": gentlePi("4.6.0"), "/usr/lib/node_modules/gentle-pi/package.json": gentlePi("4.6.0") });
	const npm = (root: string) => ({ ...nix, fs, npmRoot: () => root });
	assert.equal(gentleShellDir({ GENTLE_SHELL_DIR: "/opt/gentle-pi" }, npm("/usr/lib/node_modules")), "/opt/gentle-pi");
	assert.equal(gentleShellDir({}, npm("/usr/lib/node_modules\n")), "/usr/lib/node_modules/gentle-pi");
	assert.equal(gentleShellDir({ GENTLE_SHELL_DIR: "" }, npm("/usr/lib/node_modules")), "/usr/lib/node_modules/gentle-pi");
	assert.equal(gentleShellDir({}, npm("")), undefined, "npm printed nothing");
	assert.equal(gentleShellDir({}, { ...nix, fs, npmRoot: noNpm }), undefined, "npm missing or failing");
});

test("S1 else the package Gentle Shell itself loads: the one its launcher injects, then the gentle-shell launcher's own on PATH (pnpm, npm), before the global npm root", () => {
	const store = "/home/me/.local/share/pnpm/store/v11/links/@/gentle-pi/4.6.0-main.dd37ffe5573d/c78a/node_modules/gentle-pi";
	const globalNpm = { "/usr/lib/node_modules/gentle-pi/package.json": gentlePi("4.5.0") };
	const fs = fakeDisk({ [`${store}/package.json`]: gentlePi("4.6.0-main.dd37ffe5573d"), "/work/fisi-dock/package.json": JSON.stringify({ name: "fisi-dock" }), ...globalNpm });
	const npmRoot = () => "/usr/lib/node_modules";
	// In a Gentle Shell session: the injected extension paths, walked up to the folder whose package.json is gentle-pi's.
	assert.equal(gentleShellDir({ GENTLE_SHELL_CHILD_PACKAGE_INJECTION: injected("/work/fisi-dock", `${store}/extensions`) }, { ...nix, fs, npmRoot }), store, "fisi-dock's own path is no gentle-pi package");
	assert.equal(gentleShellDir({ GENTLE_SHELL_DIR: "/work/fisi-dock", GENTLE_SHELL_CHILD_PACKAGE_INJECTION: injected(store) }, { ...nix, fs, npmRoot }), store, "a GENTLE_SHELL_DIR that is not gentle-pi is passed over");

	// Outside a session, pnpm's launcher on PATH is a shell shim naming its target beside $basedir, a symlink into the store.
	const pnpmBin = "/home/me/.local/share/pnpm";
	const shim = '#!/bin/sh\nbasedir=$(dirname "$0")\nexec node  "$basedir/global/v11/2f08/node_modules/gentle-pi/bin/gentle-shell.mjs" "$@"\n';
	const pnpm = fakeDisk({ [`${pnpmBin}/gentle-shell`]: shim, [`${store}/package.json`]: gentlePi("4.6.0-main.dd37ffe5573d"), ...globalNpm }, { [`${pnpmBin}/global/v11/2f08/node_modules/gentle-pi/bin/gentle-shell.mjs`]: `${store}/bin/gentle-shell.mjs` });
	assert.equal(gentleShellDir({ PATH: `/usr/bin:${pnpmBin}` }, { ...nix, fs: pnpm, npmRoot }), store, "the launcher's package, not the global npm one");
	// npm links the launcher straight to the package's bin script.
	const npm = fakeDisk({ "/opt/npm/lib/node_modules/gentle-pi/package.json": gentlePi("4.6.0") }, { "/opt/npm/bin/gentle-shell": "/opt/npm/lib/node_modules/gentle-pi/bin/gentle-shell.mjs" });
	assert.equal(gentleShellDir({ PATH: "/opt/npm/bin" }, { ...nix, fs: npm, npmRoot: noNpm }), "/opt/npm/lib/node_modules/gentle-pi");

	// Windows: pnpm's and npm's .cmd shims name the target beside %~dp0 / %dp0%; pnpm's sh shim also as cmd-shim-target.
	const win = { home: "C:\\Users\\me", platform: "win32", npmRoot: noNpm };
	const winStore = "C:\\Users\\me\\AppData\\Local\\pnpm\\store\\v11\\links\\@\\gentle-pi\\4.6.0-main.dd37ffe5573d\\c78a\\node_modules\\gentle-pi";
	const winLink = { "C:\\Users\\me\\AppData\\Local\\pnpm\\global\\v11\\2f08\\node_modules\\gentle-pi\\bin\\gentle-shell.mjs": `${winStore}\\bin\\gentle-shell.mjs` };
	const pnpmCmd = '@SETLOCAL\r\n  node  "%~dp0\\..\\global\\v11\\2f08\\node_modules\\gentle-pi\\bin\\gentle-shell.mjs" %*\r\n';
	const pnpmWin = fakeDisk({ "C:\\Users\\me\\AppData\\Local\\pnpm\\bin\\gentle-shell.cmd": pnpmCmd, [`${winStore}\\package.json`]: gentlePi("4.6.0-main.dd37ffe5573d") }, winLink);
	assert.equal(gentleShellDir({ Path: "C:\\Windows;C:\\Users\\me\\AppData\\Local\\pnpm\\bin" }, { ...win, fs: pnpmWin }), winStore, "pnpm's .cmd shim");
	const pnpmSh = '#!/bin/sh\nexec node  "$basedir/../somewhere/else.mjs" "$@"\n# cmd-shim-target=C:/Users/me/AppData/Local/pnpm/global/v11/2f08/node_modules/gentle-pi/bin/gentle-shell.mjs\n';
	const pnpmShWin = fakeDisk({ "C:\\pnpm\\bin\\gentle-shell": pnpmSh, [`${winStore}\\package.json`]: gentlePi("4.6.0-main.dd37ffe5573d") }, winLink);
	assert.equal(gentleShellDir({ PATH: "C:\\pnpm\\bin" }, { ...win, fs: pnpmShWin }), winStore, "pnpm's sh shim names its absolute target");
	const npmWin = "C:\\Users\\me\\AppData\\Roaming\\npm";
	const npmCmd = '@ECHO off\r\nSET dp0=%~dp0\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\gentle-pi\\bin\\gentle-shell.mjs" %*\r\n';
	const npmCmdWin = fakeDisk({ [`${npmWin}\\gentle-shell.cmd`]: npmCmd, [`${npmWin}\\node_modules\\gentle-pi\\package.json`]: gentlePi("4.6.0") });
	assert.equal(gentleShellDir({ Path: npmWin }, { ...win, fs: npmCmdWin }), `${npmWin}\\node_modules\\gentle-pi`, "npm's .cmd shim");
});

test("S1 when several Gentle Shell packages are found, the one provisioned for the agent home in ~/.gentle-shell/config.json wins; else the first found", () => {
	const old = "/srv/gentle-pi-4.5.0";
	const current = "/srv/gentle-pi-4.6.0";
	const files = { [`${old}/package.json`]: gentlePi("4.5.0"), [`${current}/package.json`]: gentlePi("4.6.0-main.dd37ffe5573d"), "/usr/lib/node_modules/gentle-pi/package.json": gentlePi("4.4.0") };
	const links = { "/usr/local/bin/gentle-shell": `${current}/bin/gentle-shell.mjs` };
	const provisioned = (home: string, version: unknown) => JSON.stringify({ provisioned: { [home]: { gentleAi: "4.3.1", gentlePi: version, at: "2026-11-06T22:02:47.773Z" } } });
	const config = (home: string, version: unknown) => ({ "/home/me/.gentle-shell/config.json": provisioned(home, version) });
	const at = (extra: Record<string, string>) => ({ ...nix, fs: fakeDisk({ ...files, ...extra }, links), npmRoot: () => "/usr/lib/node_modules" });
	const env = { GENTLE_SHELL_CHILD_PACKAGE_INJECTION: injected(old), PATH: "/usr/local/bin" };
	const agent = "/home/me/.gentle-shell/agent";
	assert.equal(gentleShellDir(env, at({})), old, "no config: the injected one, first found");
	assert.equal(gentleShellDir(env, at(config(agent, "4.6.0-main.dd37ffe5573d"))), current, "the default agent home's provisioned version");
	assert.equal(gentleShellDir(env, at(config(agent, "4.4.0"))), "/usr/lib/node_modules/gentle-pi", "the global npm one when it is the provisioned version");
	assert.equal(gentleShellDir(env, at(config(agent, "9.9.9"))), old, "no package of the provisioned version: the first found");
	assert.equal(gentleShellDir(env, at(config("/elsewhere", "4.6.0-main.dd37ffe5573d"))), old, "another home's provisioned version does not count");
	assert.equal(gentleShellDir({ ...env, GENTLE_PI_AGENT_HOME: "/work/home" }, at(config("/work/home", "4.6.0-main.dd37ffe5573d"))), current, "GENTLE_PI_AGENT_HOME names the agent home");
	assert.equal(gentleShellDir({ ...env, PI_CODING_AGENT_DIR: "/work/home" }, at(config("/work/home", "4.6.0-main.dd37ffe5573d"))), current, "else PI_CODING_AGENT_DIR");
	assert.equal(gentleShellDir({ ...env, GENTLE_SHELL_CONFIG: "/etc/gs.json" }, at({ "/etc/gs.json": provisioned(agent, "4.6.0-main.dd37ffe5573d") })), current, "GENTLE_SHELL_CONFIG names the config, as for the launcher");
	assert.equal(gentleShellDir(env, at({ "/home/me/.gentle-shell/config.json": "{ not json" })), old, "an unreadable config: the first found");
	assert.equal(gentleShellDir({ ...env, GENTLE_SHELL_DIR: old }, at(config(agent, "4.6.0-main.dd37ffe5573d"))), old, "GENTLE_SHELL_DIR always wins");
});

test("S1 with no Gentle Shell anywhere (CI) there is no package, so the key tests skip", () => {
	assert.equal(gentleShellDir({}, { ...nix, fs: fakeDisk({}), npmRoot: () => "/usr/lib/node_modules" }), undefined, "npm's root has no gentle-pi");
	const nothing = { PATH: "/usr/bin", GENTLE_SHELL_DIR: "/nowhere", GENTLE_SHELL_CHILD_PACKAGE_INJECTION: injected("/nowhere/ext") };
	assert.equal(gentleShellDir(nothing, { ...nix, fs: fakeDisk({ "/usr/bin/gentle-shell": "not a shim" }), npmRoot: noNpm }), undefined);
	const impostor = fakeDisk({ "/usr/lib/node_modules/gentle-pi/package.json": JSON.stringify({ name: "gentle-pie" }) });
	assert.equal(gentleShellDir({}, { ...nix, fs: impostor, npmRoot: () => "/usr/lib/node_modules" }), undefined, "a folder whose package.json is not gentle-pi's");
});
