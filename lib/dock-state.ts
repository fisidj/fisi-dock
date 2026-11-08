import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
 * Writes `fields` over what the file already holds (S5), so each writer keeps the others'
 * keys; `undefined` drops a key. A missing or malformed file starts empty. False when it
 * could not be written.
 */
function mergeState(path: string, fields: Record<string, unknown>): boolean {
	try {
		mkdirSync(dirname(path), { recursive: true });
		const state: Record<string, unknown> = { ...readState(path) };
		for (const [key, value] of Object.entries(fields)) {
			if (value === undefined) delete state[key];
			else state[key] = value;
		}
		writeFileSync(path, `${JSON.stringify(state)}\n`);
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
