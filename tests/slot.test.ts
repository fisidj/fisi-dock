import assert from "node:assert/strict";
import test from "node:test";
import { SIDEBAR_CACHE, SIDEBAR_STATE, createSlotTakeover, railOwnsHost } from "../lib/slot.ts";

const part = (name: string) => ({ name, render: () => [], invalidate() {} });

function terminalWithFooter(footer?: object) {
	const parts = new Map<string, unknown>();
	if (footer) parts.set("footer", footer);
	const cache = { revision: 0 };
	return { terminal: { [SIDEBAR_STATE]: { active: true, parts }, [SIDEBAR_CACHE]: cache } as Record<symbol, unknown>, parts, cache };
}

test("takeover stores the original and installs ours", () => {
	const original = part("gentle-status");
	const ours = part("fisi-dock");
	const { terminal, parts, cache } = terminalWithFooter(original);
	const slot = createSlotTakeover("footer", ours);

	assert.equal(slot.assert(terminal), true);
	assert.equal(parts.get("footer"), ours);
	assert.equal(slot.original(), original);
	assert.equal(cache.revision, 1);
});

test("re-assert after Gentle Shell overwrites the slot", () => {
	const first = part("gentle-status-1");
	const second = part("gentle-status-2");
	const ours = part("fisi-dock");
	const { terminal, parts, cache } = terminalWithFooter(first);
	const slot = createSlotTakeover("footer", ours);
	slot.assert(terminal);

	parts.set("footer", second);
	assert.equal(slot.assert(terminal), true);
	assert.equal(parts.get("footer"), ours);
	assert.equal(slot.original(), second);
	assert.equal(cache.revision, 2);
});

test("no double-wrap when ours is already installed", () => {
	const original = part("gentle-status");
	const ours = part("fisi-dock");
	const { terminal, parts, cache } = terminalWithFooter(original);
	const slot = createSlotTakeover("footer", ours);
	slot.assert(terminal);

	assert.equal(slot.assert(terminal), false);
	assert.equal(slot.assert(terminal), false);
	assert.equal(parts.get("footer"), ours);
	assert.equal(slot.original(), original);
	assert.equal(cache.revision, 1);
});

test("an empty slot is left alone until Gentle Shell registers its part", () => {
	const ours = part("fisi-dock");
	const { terminal, parts, cache } = terminalWithFooter();
	const slot = createSlotTakeover("footer", ours);

	assert.equal(slot.assert(terminal), false);
	assert.equal(parts.has("footer"), false);
	assert.equal(cache.revision, 0);
});

test("restore puts the original back while ours is still installed", () => {
	const original = part("gentle-status");
	const ours = part("fisi-dock");
	const { terminal, parts, cache } = terminalWithFooter(original);
	const slot = createSlotTakeover("footer", ours);
	slot.assert(terminal);

	assert.equal(slot.restore(terminal), true);
	assert.equal(parts.get("footer"), original);
	assert.equal(cache.revision, 2);
	assert.equal(slot.restore(terminal), false);
	assert.equal(parts.get("footer"), original);
});

test("restore leaves the slot untouched when someone else owns it", () => {
	const original = part("gentle-status");
	const newer = part("gentle-status-new");
	const ours = part("fisi-dock");
	const { terminal, parts, cache } = terminalWithFooter(original);
	const slot = createSlotTakeover("footer", ours);
	slot.assert(terminal);
	parts.set("footer", newer);

	assert.equal(slot.restore(terminal), false);
	assert.equal(parts.get("footer"), newer);
	assert.equal(cache.revision, 1);
});

test("missing terminal or state is a no-op without throwing", () => {
	const slot = createSlotTakeover("footer", part("fisi-dock"));
	for (const terminal of [undefined, null, {}, { [SIDEBAR_STATE]: {} }, { [SIDEBAR_STATE]: { parts: "nope" } }]) {
		assert.doesNotThrow(() => slot.assert(terminal));
		assert.equal(slot.assert(terminal), false);
		assert.equal(slot.restore(terminal), false);
	}
	assert.equal(slot.original(), undefined);
});

test("a missing cache does not block the takeover", () => {
	const original = part("gentle-status");
	const ours = part("fisi-dock");
	const parts = new Map<string, unknown>([["footer", original]]);
	const terminal = { [SIDEBAR_STATE]: { active: false, parts } };
	const slot = createSlotTakeover("footer", ours);

	assert.equal(slot.assert(terminal), true);
	assert.equal(parts.get("footer"), ours);
	assert.equal(slot.restore(terminal), true);
	assert.equal(parts.get("footer"), original);
});

test("header slot: takeover keeps the original, re-asserts, restores only while ours", () => {
	const original = part("gentle-header");
	const newer = part("gentle-header-new");
	const ours = part("fisi-dock-header");
	const parts = new Map<string, unknown>([["header", original], ["footer", part("gentle-status")]]);
	const cache = { revision: 0 };
	const terminal = { [SIDEBAR_STATE]: { active: true, parts }, [SIDEBAR_CACHE]: cache };
	const slot = createSlotTakeover("header", ours);

	assert.equal(slot.assert(terminal), true);
	assert.equal(parts.get("header"), ours);
	assert.equal(slot.original(), original);
	assert.equal((parts.get("footer") as { name: string }).name, "gentle-status");

	parts.set("header", newer);
	assert.equal(slot.assert(terminal), true);
	assert.equal(parts.get("header"), ours);
	assert.equal(slot.original(), newer);

	assert.equal(slot.restore(terminal), true);
	assert.equal(parts.get("header"), newer);
	assert.equal(slot.restore(terminal), false);

	const other = part("someone-else");
	slot.assert(terminal);
	parts.set("header", other);
	assert.equal(slot.restore(terminal), false);
	assert.equal(parts.get("header"), other);
	assert.equal(cache.revision, 4);
});

test("railOwnsHost follows Gentle Shell's ownsHost, falls back to active, and never throws", () => {
	const withState = (state: unknown) => ({ [SIDEBAR_STATE]: state });
	assert.equal(railOwnsHost(withState({ ownsHost: () => true, active: false, parts: new Map() })), true);
	assert.equal(railOwnsHost(withState({ ownsHost: () => false, active: true, parts: new Map() })), false);
	assert.equal(railOwnsHost(withState({ active: true, parts: new Map() })), true);
	assert.equal(railOwnsHost(withState({ active: false, parts: new Map() })), false);
	assert.equal(railOwnsHost(withState({ ownsHost: () => { throw new Error("boom"); } })), false);
	assert.equal(railOwnsHost({}), false);
	assert.equal(railOwnsHost(undefined), false);
});
