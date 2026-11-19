import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { PeerSessionInfo } from "./panel-model.ts";
import { ACTIVITY_SIZE_CAP, clean, HEADER_SIZE_CAP, record, seedTask } from "./subagents.ts";

// The other Gentle Shell sessions with unfinished agents (peer-agents 02): one
// entry per live session, from the presence headers Gentle Shell 4.9 writes
// beside this session's own activity file. Their shapes are restated here,
// never imported. Every read is bounded and nothing here throws.

/** The presence directory is read this often (the sessions section, S6). */
export const SESSIONS_POLL_MS = 5_000;
/** Gentle Shell's own rule: a session is live while its heartbeat is at most this old (and not this far ahead). */
export const PRESENCE_LIVE_MS = 15_000;
/** Header files read per poll at most, the most recently written first; the rest of a crowded directory is ignored. */
export const HEADER_SCAN_CAP = 256;
/** Header files whose write time is looked up per poll at most, to find the most recent ones (Gentle Shell leaves ended sessions' files behind). */
const HEADER_STAT_CAP = 4_096;
/** A session name is bounded like other model text (lib/subagents.ts TASK_CAP). */
const NAME_CAP = 120;

const HEADER_FILE = /^([a-f0-9]{64})\.([0-9a-f-]{36})\.header\.json$/;

interface PresenceHeader {
	hash: string;
	incarnation: string;
	label: string | undefined;
	heartbeat: number;
	generation: number | undefined;
	running: number;
	queued: number;
	waiting: number;
	/** Why the incarnation's activity file is not published, when the header says; null or absent: it is. */
	unavailable: unknown;
}

const count = (value: unknown): number | undefined => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined);

/** One header file, or undefined when it is not a file, past HEADER_SIZE_CAP, unreadable or not a schema 1 header with a heartbeat and counts. */
async function readHeader(dir: string, name: string, hash: string, incarnation: string): Promise<PresenceHeader | undefined> {
	try {
		const path = join(dir, name);
		const stat = await fs.stat(path);
		if (!stat.isFile() || stat.size > HEADER_SIZE_CAP) return undefined;
		const header = record(JSON.parse(await fs.readFile(path, "utf8")));
		const counts = record(header?.counts);
		const [running, queued, waiting] = [count(counts?.running), count(counts?.queued), count(counts?.waiting)];
		const heartbeat = header?.heartbeat;
		if (header?.schema !== 1 || typeof heartbeat !== "number" || !Number.isFinite(heartbeat) || running === undefined || queued === undefined || waiting === undefined) return undefined;
		const generation = header.generation;
		return {
			hash,
			incarnation,
			label: clean(header.label, NAME_CAP),
			heartbeat,
			generation: typeof generation === "number" && Number.isFinite(generation) ? generation : undefined,
			running,
			queued,
			waiting,
			unavailable: header.unavailable,
		};
	} catch {
		return undefined;
	}
}

/** Epoch ms the longest-waiting task of an activity file started waiting; undefined without one, past ACTIVITY_SIZE_CAP or unreadable. */
async function readWaitingSince(path: string): Promise<number | undefined> {
	try {
		const stat = await fs.stat(path);
		if (!stat.isFile() || stat.size > ACTIVITY_SIZE_CAP) return undefined;
		const file = record(JSON.parse(await fs.readFile(path, "utf8")));
		const tasks = record(file?.activity)?.tasks ?? file?.tasks;
		if (!Array.isArray(tasks)) return undefined;
		const starts = tasks.flatMap((row) => {
			const task = seedTask(row);
			return task?.status === "waiting" && task.startedAt !== undefined ? [task.startedAt] : [];
		});
		return starts.length > 0 ? Math.min(...starts) : undefined;
	} catch {
		return undefined;
	}
}

/** What the cache of readPeerSessions keeps for a waiting session: the header generation the time was read at. */
export type WaitingCache = Map<string, { generation: number | undefined; since: number | undefined }>;

/**
 * The other live sessions with unfinished agents (running + queued + waiting > 0),
 * from `<agentHome>/gentle-agents/presence/<sessionHash>.<incarnation>.header.json`.
 * Live: a heartbeat within PRESENCE_LIVE_MS of `now`, past or future; this session's
 * own hash (`sessionId`) is skipped; per session hash only its newest live
 * incarnation counts. At most HEADER_SCAN_CAP files are read, the most recently
 * written first (a live session rewrites its header with every heartbeat); a missing directory,
 * a malformed, oversized or unreadable file gives nothing for it. The counts come
 * from the header. A session with a waiting agent also gets `waitingSince`, from its
 * activity file's longest-waiting task, unless the header says the activity is
 * unavailable. `cache` keeps that time per incarnation while the header's generation
 * (known) stays the same, so a large activity file is not parsed on every poll; it is
 * pruned to the sessions still waiting.
 */
export async function readPeerSessions(agentHome: string, sessionId: string, now: number, cache?: WaitingCache): Promise<PeerSessionInfo[]> {
	const dir = join(agentHome, "gentle-agents", "presence");
	const own = createHash("sha256").update(sessionId).digest("hex");
	let names: string[];
	try {
		names = await fs.readdir(dir);
	} catch {
		return [];
	}
	const candidates = names
		.toSorted()
		.flatMap((name) => {
			const match = HEADER_FILE.exec(name);
			return match && match[1] !== own ? [{ name, hash: match[1], incarnation: match[2] }] : [];
		})
		.slice(0, HEADER_STAT_CAP);
	const written = await Promise.all(candidates.map((file) => fs.stat(join(dir, file.name)).then((stat) => stat.mtimeMs, () => -Infinity)));
	const files = candidates
		.map((file, index) => ({ file, mtime: written[index] }))
		.sort((a, b) => b.mtime - a.mtime)
		.slice(0, HEADER_SCAN_CAP)
		.map(({ file }) => file);
	const headers = await Promise.all(files.map((file) => readHeader(dir, file.name, file.hash, file.incarnation)));
	const newest = new Map<string, PresenceHeader>();
	for (const header of headers) {
		if (!header || Math.abs(now - header.heartbeat) > PRESENCE_LIVE_MS) continue;
		const known = newest.get(header.hash);
		if (!known || header.heartbeat > known.heartbeat) newest.set(header.hash, header);
	}
	const kept: NonNullable<typeof cache> = new Map();
	const peers: PeerSessionInfo[] = [];
	for (const header of newest.values()) {
		if (header.running + header.queued + header.waiting === 0) continue;
		let waitingSince: number | undefined;
		if (header.waiting > 0 && (header.unavailable === null || header.unavailable === undefined)) {
			const key = `${header.hash}.${header.incarnation}`;
			const cached = cache?.get(key);
			const entry = cached && cached.generation !== undefined && cached.generation === header.generation ? cached : { generation: header.generation, since: await readWaitingSince(join(dir, `${key}.activity.json`)) };
			kept.set(key, entry);
			waitingSince = entry.since;
		}
		peers.push({
			name: header.label ?? header.hash.slice(0, 8),
			running: header.running,
			queued: header.queued,
			waiting: header.waiting,
			...(waitingSince !== undefined ? { waitingSince } : {}),
		});
	}
	if (cache) {
		cache.clear();
		for (const [key, entry] of kept) cache.set(key, entry);
	}
	return peers;
}
