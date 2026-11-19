import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { sessionSnapshot } from "../lib/live-data.ts";
import { createLiveStore } from "../lib/live-store.ts";
import { readPeerSessions, SESSIONS_POLL_MS } from "../lib/sessions.ts";

// Gentle Shell 4.9's presence headers, as it writes them (`<hash>.<incarnation>.header.json`).

const NOW = 1_795_071_325_202;
const OWN = "s1";
const hashOf = (id: string) => createHash("sha256").update(id).digest("hex");
const INC_A = "11111111-1111-4111-8111-111111111111";
const INC_B = "22222222-2222-4222-8222-222222222222";

/** A fresh agent home with an (optional) presence dir; removed when the test ends. */
function presence(t: TestContext, make = true) {
	const scratch = mkdtempSync(join(tmpdir(), "fisi-dock-sessions-"));
	t.after(() => rmSync(scratch, { recursive: true, force: true }));
	const agentHome = join(scratch, "agent");
	const dir = join(agentHome, "gentle-agents", "presence");
	if (make) mkdirSync(dir, { recursive: true });
	const header = (id: string, over: Record<string, unknown> = {}, incarnation = INC_A) => {
		const hash = hashOf(id);
		const file = {
			schema: 1,
			sessionHash: hash,
			incarnation,
			label: id,
			heartbeat: NOW - 1_000,
			generation: 449,
			counts: { running: 1, queued: 0, waiting: 0, finished: 0 },
			digest: "56a1".padEnd(64, "0"),
			unavailable: null,
			...over,
		};
		writeFileSync(join(dir, `${hash}.${incarnation}.header.json`), JSON.stringify(file));
		return hash;
	};
	const activity = (id: string, tasks: unknown[], incarnation = INC_A) => {
		const hash = hashOf(id);
		writeFileSync(join(dir, `${hash}.${incarnation}.activity.json`), JSON.stringify({ schema: 1, sessionHash: hash, incarnation, generation: 449, activity: { tasks } }));
		return join(dir, `${hash}.${incarnation}.activity.json`);
	};
	return { agentHome, dir, header, activity };
}
const counts = (running: number, queued = 0, waiting = 0) => ({ running, queued, waiting, finished: 0 });
const task = (status: string, startedAt: number | null) => ({ summary: { id: `t-${status}`, agent: "explore", label: "Which SSH port?", status, model: "haiku", createdAt: 1_000, startedAt, endedAt: null, lastActivityAt: 2_000 }, thread: { version: 1, dropped: 0, items: [] } });

test("S5 a missing presence directory gives no sessions; the poll is about 5 s", async (t) => {
	const { agentHome } = presence(t, false);
	assert.deepEqual(await readPeerSessions(agentHome, OWN, NOW), []);
	assert.equal(SESSIONS_POLL_MS, 5_000);
});

test("S1 S5 each other live session with unfinished agents is one entry with its header counts; idle, finished-only and own sessions are left out", async (t) => {
	const { agentHome, header } = presence(t);
	header("stray-kids-hub", { counts: counts(1, 1) });
	header("control-movil", { counts: counts(0, 0, 1) });
	header("idle-session", { counts: counts(0) });
	header("done-session", { counts: { running: 0, queued: 0, waiting: 0, finished: 4 } });
	header(OWN, { counts: counts(3) });
	const peers = await readPeerSessions(agentHome, OWN, NOW);
	assert.deepEqual(
		peers.toSorted((a, b) => a.name.localeCompare(b.name)),
		[
			{ name: "control-movil", running: 0, queued: 0, waiting: 1 },
			{ name: "stray-kids-hub", running: 1, queued: 1, waiting: 0 },
		],
	);
});

test("S5 live means a heartbeat within 15 s, in the past or the future; the real header example is read as it is", async (t) => {
	const { agentHome, header } = presence(t);
	header("edge-live", { heartbeat: NOW - 15_000 });
	header("edge-stale", { heartbeat: NOW - 15_001 });
	header("future-live", { heartbeat: NOW + 15_000 });
	header("future-far", { heartbeat: NOW + 15_001 });
	header("not-a-time", { heartbeat: "yesterday" });
	header("fisi-dock", { heartbeat: 1795071325202, generation: 449, counts: counts(2) });
	const names = (await readPeerSessions(agentHome, OWN, NOW)).map((peer) => peer.name).toSorted();
	assert.deepEqual(names, ["edge-live", "fisi-dock", "future-live"]);
});

test("S5 per session hash only the newest live incarnation counts", async (t) => {
	const { agentHome, header } = presence(t);
	header("hub", { heartbeat: NOW - 9_000, counts: counts(5) }, INC_A);
	header("hub", { heartbeat: NOW - 2_000, counts: counts(1, 2) }, INC_B);
	assert.deepEqual(await readPeerSessions(agentHome, OWN, NOW), [{ name: "hub", running: 1, queued: 2, waiting: 0 }], "the higher heartbeat wins");
	header("hub", { heartbeat: NOW - 30_000, counts: counts(7) }, INC_B);
	assert.deepEqual(await readPeerSessions(agentHome, OWN, NOW), [{ name: "hub", running: 5, queued: 0, waiting: 0 }], "a stale incarnation never wins");
});

test("S5 malformed, oversized, foreign-named and unreadable files are skipped, the rest still read", async (t) => {
	const { agentHome, dir, header } = presence(t);
	header("good", { counts: counts(1) });
	writeFileSync(join(dir, `${hashOf("broken")}.${INC_A}.header.json`), "{ not json");
	writeFileSync(join(dir, `${hashOf("array")}.${INC_A}.header.json`), "[1,2]");
	writeFileSync(join(dir, `${hashOf("nocounts")}.${INC_A}.header.json`), JSON.stringify({ schema: 1, label: "nocounts", heartbeat: NOW }));
	writeFileSync(join(dir, `${hashOf("badcounts")}.${INC_A}.header.json`), JSON.stringify({ schema: 1, label: "badcounts", heartbeat: NOW, counts: { running: -1, queued: "x", waiting: null } }));
	writeFileSync(join(dir, `${hashOf("schema2")}.${INC_A}.header.json`), JSON.stringify({ schema: 2, label: "schema2", heartbeat: NOW, counts: counts(1) }));
	const big = join(dir, `${hashOf("big")}.${INC_A}.header.json`);
	writeFileSync(big, JSON.stringify({ schema: 1, label: "big", heartbeat: NOW, counts: counts(1), pad: "" }));
	truncateSync(big, 64 * 1024 + 1);
	writeFileSync(join(dir, "notes.header.json"), JSON.stringify({ schema: 1, label: "notes", heartbeat: NOW, counts: counts(1) }));
	mkdirSync(join(dir, `${hashOf("dir")}.${INC_A}.header.json`));
	assert.deepEqual(await readPeerSessions(agentHome, OWN, NOW), [{ name: "good", running: 1, queued: 0, waiting: 0 }]);
});

test("S5 the label is made printable and bounded to 120 characters; without one the hash starts the name", async (t) => {
	const { agentHome, header } = presence(t);
	header("dirty", { label: "\x1b]0;evil\x07\x1b[31mred‮\tproject\n name" });
	header("long", { label: "x".repeat(300) });
	header("blank", { label: "  \x1b[0m " });
	const peers = await readPeerSessions(agentHome, OWN, NOW);
	assert.ok(peers.some((peer) => peer.name === "red project name"), JSON.stringify(peers));
	assert.equal(peers.find((peer) => peer.name.startsWith("x"))!.name.length, 120);
	assert.ok(peers.some((peer) => peer.name === hashOf("blank").slice(0, 8)), "no printable label: the short hash");
});

test("S5 at most 256 header files are read per poll", async (t) => {
	const { agentHome, header } = presence(t);
	for (let index = 0; index < 300; index++) header(`session-${index}`, { counts: counts(1) });
	assert.equal((await readPeerSessions(agentHome, OWN, NOW)).length, 256);
});

test("S5 in a crowded directory the most recently written headers are the ones read, so a live session is found whatever its file name", async (t) => {
	const { agentHome, dir, header } = presence(t);
	for (let index = 0; index < 300; index++) header(`gone-${index}`, { heartbeat: NOW - 3_600_000, counts: counts(1) });
	for (const name of readdirSync(dir)) utimesSync(join(dir, name), 1_000, 1_000);
	let live = 0;
	while (!hashOf(`live-${live}`).startsWith("ff")) live++;
	header(`live-${live}`, { label: "live", counts: counts(2) });
	assert.deepEqual(await readPeerSessions(agentHome, OWN, NOW), [{ name: "live", running: 2, queued: 0, waiting: 0 }]);
});

test("S5 a waiting session's time comes from its activity file's waiting task, only when the header says it is available", async (t) => {
	const { agentHome, dir, header, activity } = presence(t);
	header("asks", { counts: counts(1, 0, 1) });
	activity("asks", [task("running", NOW - 90_000), task("waiting", NOW - 65_000), task("waiting", NOW - 20_000)]);
	header("busy", { counts: counts(1) });
	activity("busy", [task("waiting", NOW - 5_000)]);
	header("no-file", { counts: counts(0, 0, 1) });
	header("too-large", { counts: counts(0, 0, 1), unavailable: "activity-too-large" });
	activity("too-large", [task("waiting", NOW - 5_000)]);
	header("no-start", { counts: counts(0, 0, 1) });
	activity("no-start", [task("waiting", null)]);
	header("huge", { counts: counts(0, 0, 1) });
	truncateSync(activity("huge", []), 16 * 1024 * 1024 + 1);
	header("bad-file", { counts: counts(0, 0, 1) });
	writeFileSync(join(dir, `${hashOf("bad-file")}.${INC_A}.activity.json`), "{ nope");
	const peers = await readPeerSessions(agentHome, OWN, NOW);
	const get = (name: string) => peers.find((peer) => peer.name === name)!;
	assert.equal(get("asks").waitingSince, NOW - 65_000, "the longest wait");
	for (const name of ["busy", "no-file", "too-large", "no-start", "huge", "bad-file"]) assert.ok(!("waitingSince" in get(name)), `${name}: no time`);
	assert.equal(get("no-file").waiting, 1, "the counts stay");
});

test("S5 S6 a waiting session's activity file is read again only when its generation moved", async (t) => {
	const { agentHome, header, activity } = presence(t);
	const cache = new Map();
	header("asks", { counts: counts(0, 0, 1), generation: 7 });
	activity("asks", [task("waiting", NOW - 65_000)]);
	assert.equal((await readPeerSessions(agentHome, OWN, NOW, cache))[0].waitingSince, NOW - 65_000);
	activity("asks", [task("waiting", NOW - 10_000)]);
	assert.equal((await readPeerSessions(agentHome, OWN, NOW, cache))[0].waitingSince, NOW - 65_000, "same generation: the cached time");
	header("asks", { counts: counts(0, 0, 1), generation: 8 });
	assert.equal((await readPeerSessions(agentHome, OWN, NOW, cache))[0].waitingSince, NOW - 10_000, "a new generation reads again");
	header("asks", { counts: counts(0), generation: 9 });
	await readPeerSessions(agentHome, OWN, NOW, cache);
	assert.equal(cache.size, 0, "sessions that left the list are forgotten");
});

// --- the live store ---

test("S6 the live store carries the sessions; the same data again is no change, an empty list takes the key away", () => {
	const store = createLiveStore("app", () => 1_000);
	const hub = { name: "hub", running: 1, queued: 0, waiting: 0 };
	assert.equal(store.model().sessions, undefined);
	assert.equal(store.update({ sessions: [hub] }), true);
	assert.deepEqual(store.model().sessions, [hub]);
	assert.equal(store.update({ sessions: [{ ...hub }] }), false, "unchanged data: no repaint");
	assert.equal(store.update({ sessions: [{ ...hub, queued: 2 }] }), true);
	assert.equal(store.update({ sessions: [] }), true);
	assert.ok(!("sessions" in store.model()), "no empty key");
	assert.equal(store.update({ sessions: undefined }), false);
});

test("S2 the shared spinner turns while another session runs agents, not for queued or waiting ones", () => {
	const store = createLiveStore("app", () => 1_000);
	store.update({ sessions: [{ name: "q", running: 0, queued: 2, waiting: 1 }] });
	assert.equal(store.spinning(), false);
	store.update({ sessions: [{ name: "r", running: 1, queued: 0, waiting: 0 }] });
	assert.equal(store.spinning(), true);
	assert.equal(sessionSnapshot({ project: "app", sessions: [{ name: "r", running: 1, queued: 0, waiting: 0 }], spinner: 3 }).spinner, 3);
});
