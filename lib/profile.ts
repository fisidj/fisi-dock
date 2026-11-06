// The session's agent-model profile (S99), the label Gentle Shell's own Status
// section (`Agent profile:`) and top row show, which Fisi Dock takes over.
// Gentle Shell keeps it in process-wide registries keyed by session id
// (lib/session-profile-binding.ts and lib/session-profile-freeze.ts in
// gentle-pi); they are read here by key, never imported, and the label is
// spelled as its sessionProfileLabel does: `name (session)` for a profile chosen
// with Use in this session, `name (local)` or `name (repo)` for a pinned one,
// the bare name for the global one. A shape this version does not know reads as
// no profile, so the row goes away instead of showing a wrong one.

export const PROFILE_BINDINGS = Symbol.for("gentle-pi:session-profile-bindings");
export const PROFILE_STARTUP_NONE = Symbol.for("gentle-pi:session-profile-startup-none");
export const PROFILE_FREEZE = Symbol.for("gentle-pi:session-profile-freeze");

const ORIGINS = new Set(["user", "local", "repo", "global"]);

function label(profile: unknown): string | undefined {
	if (profile === null || typeof profile !== "object") return undefined;
	const { name, origin } = profile as { name?: unknown; origin?: unknown };
	if (typeof name !== "string" || name === "" || typeof origin !== "string" || !ORIGINS.has(origin)) return undefined;
	if (origin === "user") return `${name} (session)`;
	return origin === "global" ? name : `${name} (${origin})`;
}

/**
 * The profile label for `sessionId`, by Gentle Shell's resolution order: the
 * session's recorded binding, then no profile when it started without one,
 * then the profile frozen at its start. Undefined when none applies.
 */
export function readSessionProfile(sessionId: string, holder: Record<symbol, unknown> = globalThis as Record<symbol, unknown>): string | undefined {
	if (!sessionId) return undefined;
	const bindings = holder[PROFILE_BINDINGS];
	if (bindings instanceof Map && bindings.has(sessionId)) return label(bindings.get(sessionId));
	const startupNone = holder[PROFILE_STARTUP_NONE];
	if (startupNone instanceof Set && startupNone.has(sessionId)) return undefined;
	const frozen = (holder[PROFILE_FREEZE] as { frozen?: unknown } | undefined)?.frozen;
	if (!(frozen instanceof Map)) return undefined;
	return label((frozen.get(sessionId) as { profile?: unknown } | undefined)?.profile);
}
