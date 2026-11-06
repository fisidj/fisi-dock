import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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

/** Saves `{ "enabled": …, "theme": … }` (no theme key without one), creating its folder. False when it could not be written. */
export function writeDockEnabled(path: string, enabled: boolean, theme?: string): boolean {
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(theme ? { enabled, theme } : { enabled })}\n`);
		return true;
	} catch {
		return false;
	}
}
