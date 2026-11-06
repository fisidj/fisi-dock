import { existsSync, readdirSync } from "node:fs";
import { posix, win32 } from "node:path";
import { createSerialRefresh } from "./live-store.ts";

// The RDD switch (S85): official Gentle Shell publishes no idle mode (its
// `gentle-ai:review-sidebar` event only runs while a review tool runs), so
// Fisi Dock asks Gentle AI itself with its read-only status command,
// `gentle-ai review mode status --cwd <folder> --json`, at session start and
// after each turn. The binary is `gentle-ai` on PATH, else the one the
// gentle-pi package bundles under `.gentle-ai/<version>/`; the package is the
// one the gentle-shell launcher tells children to load
// (GENTLE_SHELL_CHILD_PACKAGE_INJECTION, docs/gentle-shell.md), else the
// global npm one. Nothing is imported from Gentle Shell.

export type ReviewMode = "on" | "off";

/** The status command gets this long; gentle-ai answers at once, so a slow answer is a stuck one. */
export const REVIEW_MODE_TIMEOUT_MS = 5_000;

/** The launcher's variable with the `-e` set it injected (lib/child-package-injection.ts there). */
export const CHILD_PACKAGE_INJECTION_ENV = "GENTLE_SHELL_CHILD_PACKAGE_INJECTION";

const BUNDLE_DIR = ".gentle-ai";

/** The read-only status command for `cwd` (the clone-local switch counts there); without a folder, the global answer. */
export function reviewModeArgs(cwd: string): string[] {
	return ["review", "mode", "status", ...(cwd ? ["--cwd", cwd] : []), "--json"];
}

/**
 * The effective mode in gentle-ai's answer: `status.effective` of the --json
 * envelope (`gentle-ai.review-mode/v1`), else the first line of the plain
 * text, `receipt-driven development: on (decided by global)`. Anything else
 * is unreadable: undefined, and the caller keeps what it knew.
 */
export function parseReviewMode(stdout: string): ReviewMode | undefined {
	const text = stdout.trim();
	if (!text) return undefined;
	if (text.startsWith("{")) {
		try {
			const value = JSON.parse(text) as { status?: { effective?: unknown } } | null;
			const effective = value && typeof value === "object" ? value.status?.effective : undefined;
			return effective === "on" || effective === "off" ? effective : undefined;
		} catch {
			return undefined;
		}
	}
	const match = /^receipt-driven development:\s*(on|off)\b/m.exec(text);
	return match ? (match[1] as ReviewMode) : undefined;
}

export interface BinaryFs {
	existsSync(path: string): boolean;
	readdirSync(path: string): string[];
}

export interface BinaryOptions {
	platform?: string;
	/** The user's home, for `~/.npm-global`. */
	homedir?: string;
	/** Node's own binary: its prefix holds the global node_modules. */
	execPath?: string;
	fs?: BinaryFs;
}

/** `v4.10.0` before `v4.3.1`, a plain release before its prereleases (`v5.0.0` before `v5.0.0-rc.1`). */
function compareVersions(a: string, b: string): number {
	const parse = (name: string) => {
		const match = /^v?(\d+(?:\.\d+)*)(?:-(.+))?$/.exec(name);
		return match ? { numbers: match[1].split(".").map(Number), pre: match[2] } : undefined;
	};
	const left = parse(a);
	const right = parse(b);
	if (!left || !right) return left ? -1 : right ? 1 : a.localeCompare(b);
	for (let index = 0; index < Math.max(left.numbers.length, right.numbers.length); index++) {
		const delta = (right.numbers[index] ?? 0) - (left.numbers[index] ?? 0);
		if (delta !== 0) return delta;
	}
	if ((left.pre === undefined) !== (right.pre === undefined)) return left.pre === undefined ? -1 : 1;
	return (right.pre ?? "").localeCompare(left.pre ?? "");
}

/** The paths the launcher injected, in order; undefined for an absent or malformed value, like the launcher's own parser. */
function injectedPaths(env: Record<string, string | undefined>): string[] | undefined {
	const raw = env[CHILD_PACKAGE_INJECTION_ENV];
	if (!raw) return undefined;
	try {
		const paths = (JSON.parse(raw) as { extensionPaths?: unknown } | null)?.extensionPaths;
		return Array.isArray(paths) && paths.every((path): path is string => typeof path === "string" && path.length > 0) ? paths : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The Gentle AI binary to run, or undefined when none is found: `gentle-ai`
 * on PATH (`gentle-ai.exe` on Windows), else the newest bundled in a package
 * the launcher injected, else in the global npm package (`%APPDATA%\npm\node_modules\gentle-pi`
 * on Windows; `$NPM_CONFIG_PREFIX`, node's own prefix, `/usr/local`, `/usr` and
 * `~/.npm-global` `lib/node_modules/gentle-pi` elsewhere). Only existence
 * checks: `npm root -g` is too slow for a session start.
 */
export function gentleAiBinary(env: Record<string, string | undefined>, options: BinaryOptions = {}): string | undefined {
	const platform = options.platform ?? process.platform;
	const windows = platform === "win32";
	const path = windows ? win32 : posix;
	const fs = options.fs ?? { existsSync, readdirSync };
	const name = windows ? "gentle-ai.exe" : "gentle-ai";
	const exists = (candidate: string) => {
		try {
			return fs.existsSync(candidate);
		} catch {
			return false;
		}
	};
	const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH");
	for (const dir of (pathKey ? env[pathKey] ?? "" : "").split(path.delimiter).filter(Boolean)) {
		const candidate = path.join(dir, name);
		if (exists(candidate)) return candidate;
	}
	const bundled = (root: string): string | undefined => {
		const dir = path.join(root, BUNDLE_DIR);
		let versions: string[];
		try {
			versions = fs.readdirSync(dir);
		} catch {
			return undefined;
		}
		for (const version of [...versions].sort(compareVersions)) {
			const candidate = path.join(dir, version, name);
			if (exists(candidate)) return candidate;
		}
		return undefined;
	};
	for (const root of injectedPaths(env) ?? []) {
		const found = bundled(root);
		if (found) return found;
	}
	const roots: string[] = [];
	const execPath = options.execPath ?? process.execPath;
	if (windows) {
		if (env.APPDATA) roots.push(path.join(env.APPDATA, "npm", "node_modules", "gentle-pi"));
		roots.push(path.join(path.dirname(execPath), "node_modules", "gentle-pi"));
	} else {
		if (env.NPM_CONFIG_PREFIX) roots.push(path.join(env.NPM_CONFIG_PREFIX, "lib", "node_modules", "gentle-pi"));
		roots.push(path.join(path.dirname(path.dirname(execPath)), "lib", "node_modules", "gentle-pi"), "/usr/local/lib/node_modules/gentle-pi", "/usr/lib/node_modules/gentle-pi");
		if (options.homedir) roots.push(path.join(options.homedir, ".npm-global", "lib", "node_modules", "gentle-pi"));
	}
	for (const root of roots) {
		const found = bundled(root);
		if (found) return found;
	}
	return undefined;
}

export interface ReviewModeReaderOptions {
	/** Runs the binary; Pi's exec with the session cwd and REVIEW_MODE_TIMEOUT_MS in the extension. */
	exec(command: string, args: string[]): Promise<{ stdout: string; code: number }>;
	/** From gentleAiBinary; undefined reads nothing, so the section never shows until a review event. */
	binary: string | undefined;
	/** The session folder, for the clone-local switch. */
	cwd: string;
	/** Called with each mode read; never for a failed, timed-out or unreadable read, so the last known mode stays. */
	onMode(mode: ReviewMode): void;
}

/**
 * A trigger that reads the mode, never with two calls in flight: triggers
 * that arrive while one runs collapse into one more read after it.
 */
export function createReviewModeReader(options: ReviewModeReaderOptions): () => void {
	const { binary, cwd } = options;
	if (!binary) return () => {};
	return createSerialRefresh(async () => {
		let result: { stdout: string; code: number } | undefined;
		try {
			result = await options.exec(binary, reviewModeArgs(cwd));
		} catch {
			return;
		}
		if (!result || result.code !== 0) return;
		const mode = parseReviewMode(typeof result.stdout === "string" ? result.stdout : "");
		if (mode) options.onMode(mode);
	});
}
