import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Look, normalizeLook } from "./look.ts";

/**
 * Where `/fisi-dock on|off` is remembered across restarts (S95): Pi's agent dir
 * (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`), outside any repository.
 */
export function dockStatePath(env: Record<string, string | undefined>, home: string): string {
	return join(env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent"), "fisi-dock", "state.json");
}

function readState(path: string): Record<string, unknown> | undefined {
	try {
		const state = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return state && typeof state === "object" && !Array.isArray(state) ? (state as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

/** Off only when the file says `"enabled": false`; a missing, unreadable or malformed file means on. */
export function readDockEnabled(path: string): boolean {
	return readState(path)?.enabled !== false;
}

/** The theme in use before `/fisi-dock on` (S7), for off to put back; undefined unless a non-empty string. */
export function readDockTheme(path: string): string | undefined {
	const theme = readState(path)?.theme;
	return typeof theme === "string" && theme !== "" ? theme : undefined;
}

/** Whether the first start already applied the Fisi-Dock theme once (T9): only `"themeApplied": true` says so. */
export function readDockThemeApplied(path: string): boolean {
	return readState(path)?.themeApplied === true;
}

/** The look picked in `/fisi-dock settings` (S5); each missing or bad field is the default (S6). */
export function readDockLook(path: string): Look {
	return normalizeLook(readState(path)?.look);
}

/**
 * Writes `text` to a temporary file next to `path`, then renames it over `path`, so a
 * failed write leaves the previous file whole and readers never see a half-written one.
 * Windows can refuse the rename for a moment while another process reads the file, so
 * it is tried a few times, with a short pause between tries. The temporary file is removed when the write fails.
 * A symlinked file is replaced at its target, so the link stays, and the replaced file keeps its mode.
 */
let tempSequence = 0;
function replaceFile(path: string, text: string): void {
	let target = path;
	let mode: number | undefined;
	try {
		target = realpathSync(path);
		const stat = statSync(target);
		if (stat.isFile()) mode = stat.mode & 0o777;
	} catch {
		// No file yet: it is made at `path` with the default mode.
	}
	// The counter keeps two writes in one millisecond apart; another process has another pid.
	const temp = `${target}.${process.pid}.${Date.now().toString(36)}.${(++tempSequence).toString(36)}.tmp`;
	try {
		writeFileSync(temp, text, { flag: "wx" });
		if (mode !== undefined) chmodSync(temp, mode);
		for (let attempt = 1; ; attempt++) {
			try {
				renameSync(temp, target);
				return;
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (attempt >= 5 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw error;
				// A short synchronous pause lets the other process close the file.
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * attempt);
			}
		}
	} catch (error) {
		// The name is this write's own, so a half-written file left by a failed write is removed too.
		rmSync(temp, { force: true });
		throw error;
	}
}

/**
 * Writes `fields` over what the file already holds (S5), so each writer keeps the others'
 * keys; `undefined` drops a key. A missing or malformed file starts empty. False when it
 * could not be written; the previous file then stays as it was.
 */
function mergeState(path: string, fields: Record<string, unknown>): boolean {
	try {
		mkdirSync(dirname(path), { recursive: true });
		const state: Record<string, unknown> = { ...readState(path) };
		for (const [key, value] of Object.entries(fields)) {
			if (value === undefined) delete state[key];
			else state[key] = value;
		}
		replaceFile(path, `${JSON.stringify(state)}\n`);
		return true;
	} catch {
		return false;
	}
}

/** Saves the look under `"look"`, keeping the rest of the file. False when it could not be written. */
export function writeDockLook(path: string, look: Look): boolean {
	return mergeState(path, { look: normalizeLook(look) });
}

/**
 * Saves `{ "enabled": …, "theme": …, "themeApplied": true }` (no theme key without one, no
 * themeApplied key unless true), creating its folder and keeping the look (S5). False when
 * it could not be written.
 */
export function writeDockEnabled(path: string, enabled: boolean, theme?: string, themeApplied = false): boolean {
	return mergeState(path, { enabled, theme: theme || undefined, themeApplied: themeApplied || undefined });
}
