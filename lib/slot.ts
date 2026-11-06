// Gentle Shell keeps its fullscreen rail parts on the terminal under global
// symbols. Reading them through Symbol.for keeps Fisi Dock free of Gentle Shell
// imports, so a Gentle Shell update cannot break module resolution here.
export const SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");
export const SIDEBAR_CACHE = Symbol.for("gentle-pi.experimental-sidebar.cache");

type PartsMap = Map<string, unknown>;

/**
 * Gentle Shell 4.6.0's other rail parts (`todo`, `jobs`, `agents`, stacked
 * above `footer` in lib/shell-sidebar-layout.ts) and its `statusbar` row
 * (lib/shell-sidebar.ts sidebarStatusBar). Fisi Dock takes them over with
 * parts that paint nothing, so only its panel shows in the rail (S83) and no
 * status bar repeats the model and effort under it (S84): the layout leaves
 * out sections without lines and a status bar without rows.
 */
export const EMPTIED_PARTS = ["todo", "jobs", "agents", "statusbar"] as const;

/** A rail part that paints nothing; its fixed digest keeps the rail memo from re-rendering it. */
export function emptyPart(): object {
	return { digest: () => "fisi-dock:empty", render: () => [], invalidate() {} };
}

export interface SlotTakeover {
	/** Install our part when the slot holds someone else's. True when the slot changed. */
	assert(terminal: unknown): boolean;
	/** Put the remembered original back, only while our part still owns the slot. */
	restore(terminal: unknown): boolean;
	/** The last foreign part we replaced. */
	original(): unknown;
}

function sidebarParts(terminal: unknown): PartsMap | undefined {
	if (!terminal || typeof terminal !== "object") return undefined;
	const state = (terminal as Record<symbol, unknown>)[SIDEBAR_STATE] as { parts?: unknown } | undefined;
	return state && state.parts instanceof Map ? (state.parts as PartsMap) : undefined;
}

/**
 * True while Gentle Shell's fullscreen rail owns the screen (fullscreen, wide
 * enough, placement auto/right). Fisi Dock only reshapes the screen then; in
 * narrow or regular mode Gentle Shell's own header and bars stay in charge.
 * Older states without `ownsHost` fall back to `active`.
 */
export function railOwnsHost(terminal: unknown): boolean {
	if (!terminal || typeof terminal !== "object") return false;
	const state = (terminal as Record<symbol, unknown>)[SIDEBAR_STATE] as { active?: unknown; ownsHost?: unknown } | undefined;
	if (!state) return false;
	try {
		return typeof state.ownsHost === "function" ? state.ownsHost() === true : state.active === true;
	} catch {
		return false;
	}
}

function bumpRevision(terminal: unknown): void {
	const cache = (terminal as Record<symbol, unknown>)[SIDEBAR_CACHE] as { revision?: unknown } | undefined;
	if (cache && typeof cache.revision === "number") cache.revision++;
}

export function createSlotTakeover(key: string, part: object): SlotTakeover {
	let original: unknown;
	return {
		assert(terminal) {
			const parts = sidebarParts(terminal);
			if (!parts) return false;
			const current = parts.get(key);
			// An empty slot means Gentle Shell has not registered yet; wait for it.
			if (current === undefined || current === part) return false;
			original = current;
			parts.set(key, part);
			bumpRevision(terminal);
			return true;
		},
		restore(terminal) {
			const parts = sidebarParts(terminal);
			if (!parts || parts.get(key) !== part) return false;
			if (original === undefined) parts.delete(key);
			else parts.set(key, original);
			bumpRevision(terminal);
			return true;
		},
		original: () => original,
	};
}
