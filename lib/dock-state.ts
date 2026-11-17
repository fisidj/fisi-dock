import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
 * A chain of links is followed to its end, up to a small depth; a loop or a longer chain fails the save.
 */
const MAX_LINK_DEPTH = 8;
let tempSequence = 0;
function replaceFile(path: string, text: string): void {
	let target = path;
	let mode: number | undefined;
	for (let depth = 0; ; depth++) {
		try {
			target = realpathSync(target);
			const stat = statSync(target);
			if (stat.isFile()) mode = stat.mode & 0o777;
			break;
		} catch {
			// No file yet: it is made at `target` with the default mode; a link to a missing file is followed.
		}
		let next: string | undefined;
		try {
			// The folder is resolved first: a relative link counts from the real folder of the link that holds it, not a linked alias.
			if (lstatSync(target).isSymbolicLink()) next = resolve(realpathSync(dirname(target)), readlinkSync(target));
		} catch {
			// Nothing at `target` at all.
		}
		if (next === undefined) break;
		if (depth >= MAX_LINK_DEPTH) throw new Error(`too many levels of symbolic links: ${path}`);
		target = next;
	}
	// The counter keeps two writes in one millisecond apart; another process has another pid.
	const temp = `${target}.${process.pid}.${Date.now().toString(36)}.${(++tempSequence).toString(36)}.tmp`;
	let made = false;
	try {
		const fd = openSync(temp, "wx");
		made = true;
		try {
			writeFileSync(fd, text);
		} finally {
			closeSync(fd);
		}
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
		// Only a file this write created is removed (a failed exclusive create leaves a foreign one alone); a half-written one is removed too.
		if (made) rmSync(temp, { force: true });
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
