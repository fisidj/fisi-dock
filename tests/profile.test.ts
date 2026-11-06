import assert from "node:assert/strict";
import test from "node:test";
import { PROFILE_BINDINGS, PROFILE_FREEZE, PROFILE_STARTUP_NONE, readSessionProfile } from "../lib/profile.ts";

// Gentle Shell's in-process profile registries (S99), keyed by session id, as
// lib/session-profile-binding.ts and lib/session-profile-freeze.ts keep them.
function holder(parts: { bindings?: [string, unknown][]; startupNone?: string[]; frozen?: [string, unknown][] } = {}): Record<symbol, unknown> {
	const store: Record<symbol, unknown> = {};
	if (parts.bindings) store[PROFILE_BINDINGS] = new Map(parts.bindings);
	if (parts.startupNone) store[PROFILE_STARTUP_NONE] = new Set(parts.startupNone);
	if (parts.frozen) store[PROFILE_FREEZE] = { frozen: new Map(parts.frozen) };
	return store;
}

test("the keys are Gentle Shell's own registry symbols (S99)", () => {
	assert.equal(PROFILE_BINDINGS, Symbol.for("gentle-pi:session-profile-bindings"));
	assert.equal(PROFILE_STARTUP_NONE, Symbol.for("gentle-pi:session-profile-startup-none"));
	assert.equal(PROFILE_FREEZE, Symbol.for("gentle-pi:session-profile-freeze"));
});

test("a profile chosen with Use in this session reads `name (session)` (S99)", () => {
	assert.equal(readSessionProfile("s1", holder({ bindings: [["s1", { name: "claude", origin: "user", modelProfiles: {} }]] })), "claude (session)");
});

test("a recorded startup profile reads with its layer, the global one bare (S99)", () => {
	assert.equal(readSessionProfile("s1", holder({ bindings: [["s1", { name: "team", origin: "local", modelProfiles: {} }]] })), "team (local)");
	assert.equal(readSessionProfile("s1", holder({ bindings: [["s1", { name: "team", origin: "repo", modelProfiles: {} }]] })), "team (repo)");
	assert.equal(readSessionProfile("s1", holder({ bindings: [["s1", { name: "claude", origin: "global", modelProfiles: {} }]] })), "claude");
});

test("the profile frozen at startup reads with its layer when nothing is bound (S99)", () => {
	assert.equal(readSessionProfile("s1", holder({ frozen: [["s1", { profile: { name: "claude", origin: "global", modelProfiles: {} } }]] })), "claude");
	assert.equal(readSessionProfile("s1", holder({ frozen: [["s1", { profile: { name: "team", origin: "repo", modelProfiles: {} } }]] })), "team (repo)");
});

test("a binding wins over the frozen profile (S99)", () => {
	const store = holder({
		bindings: [["s1", { name: "fast", origin: "user", modelProfiles: {} }]],
		frozen: [["s1", { profile: { name: "claude", origin: "global", modelProfiles: {} } }]],
	});
	assert.equal(readSessionProfile("s1", store), "fast (session)");
});

// Gentle Shell resolves a recorded binding first and stops there, so a binding of
// a shape this version does not know reads as no profile instead of falling
// through to the frozen one (S8).
test("a recorded binding of an unknown shape reads as no profile, even with a valid frozen profile (S8)", () => {
	const frozen: [string, unknown][] = [["s1", { profile: { name: "claude", origin: "global", modelProfiles: {} } }]];
	for (const binding of [{ name: "fast", origin: "elsewhere", modelProfiles: {} }, { name: "", origin: "user" }, null, "fast"]) {
		assert.equal(readSessionProfile("s1", holder({ bindings: [["s1", binding]], frozen })), undefined, JSON.stringify(binding));
	}
	assert.equal(readSessionProfile("s1", holder({ frozen })), "claude", "without the binding the frozen profile reads");
});

test("no profile: started without one, frozen without one, nothing recorded, another session's (S99)", () => {
	const frozen: [string, unknown][] = [["s1", { profile: { name: "claude", origin: "global", modelProfiles: {} } }]];
	assert.equal(readSessionProfile("s1", holder({ startupNone: ["s1"], frozen })), undefined);
	assert.equal(readSessionProfile("s1", holder({ frozen: [["s1", { profile: undefined }]] })), undefined);
	assert.equal(readSessionProfile("s1", holder()), undefined);
	assert.equal(readSessionProfile("s1", holder({ bindings: [["s2", { name: "claude", origin: "user", modelProfiles: {} }]] })), undefined);
	assert.equal(readSessionProfile("", holder({ bindings: [["", { name: "claude", origin: "user", modelProfiles: {} }]] })), undefined);
});

test("a shape this version does not know reads as no profile, never throws (S99)", () => {
	const odd: Record<symbol, unknown>[] = [
		{ [PROFILE_BINDINGS]: "not a map" },
		{ [PROFILE_BINDINGS]: new Map([["s1", { name: "", origin: "user" }]]) },
		{ [PROFILE_BINDINGS]: new Map([["s1", { name: "claude", origin: "elsewhere" }]]) },
		{ [PROFILE_BINDINGS]: new Map([["s1", null]]) },
		{ [PROFILE_FREEZE]: { frozen: "not a map" } },
		{ [PROFILE_FREEZE]: { frozen: new Map([["s1", { profile: { name: 7, origin: "global" } }]]) } },
	];
	for (const store of odd) assert.equal(readSessionProfile("s1", store), undefined);
});
