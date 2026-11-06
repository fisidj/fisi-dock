import type { RddInfo, RddReview } from "./panel-model.ts";
import { trailStep, trailSummary, type ReviewTrail } from "./rdd-detail.ts";

// The session's RDD reviews (S50): Gentle Shell's `gentle-ai:review-sidebar`
// snapshots ({ state, scope }) folded into one row per review, newest last.
// Pure; the caller passes the clock.

export type RddStatus = RddReview["status"];

export interface RddRow {
	/** The reviewed files as shown: the first file's name, then ` +N` more. */
	scope: string;
	status: RddStatus;
	startedAt: number;
	/** Set once the review finished (approved, outdated, unavailable, skipped). */
	endedAt?: number;
	/** The muted line under the row (S62): the running step, then the finished summary. */
	detail?: string;
	/** Opened by an update with no files (S63): the next update with files names it, `ready` or `unknown` removes it. */
	unnamed?: true;
}

export interface ReviewSnapshot {
	state: string;
	scope: string;
}

// Gentle Shell's review states (lib/review-sidebar-state.ts REVIEW_SIDEBAR_LABELS);
// ready and unknown say nothing about a review and make no row.
const STATUS: Record<string, RddStatus> = {
	reviewing: "reviewing",
	in_review: "reviewing",
	checking: "reviewing",
	approved: "reviewing",
	forecast: "reviewing",
	correction: "fixing",
	consent: "waiting",
	closed: "approved",
	invalidated: "outdated",
	unavailable: "unavailable",
	declined: "skipped",
};

/** Gentle Shell's text for a review without known files (REVIEW_SCOPE_UNAVAILABLE). */
const SCOPE_UNAVAILABLE = "Candidate scope unavailable";
/** The row name when the first snapshot of a review has no files. */
const NO_SCOPE = "changes";
/** States saying no review runs: they close a row still waiting for its files (S63). */
const NO_REVIEW = new Set(["ready", "unknown"]);

const finished = (status: RddStatus) => status !== "reviewing" && status !== "fixing" && status !== "waiting";

/** `orbs.ts +2 files` -> `orbs.ts +2`: the count says enough in the rail. */
export function shortScope(scope: string): string {
	return scope.replace(/ \+(\d+) files?$/, " +$1");
}

/** `{ sessionId, snapshot: { state, scope } }` for `sessionId`; undefined when it is not ours or has no state. */
export function reviewSnapshot(event: unknown, sessionId: string): ReviewSnapshot | undefined {
	const value = event !== null && typeof event === "object" ? (event as Record<string, unknown>) : undefined;
	if (!value || value.sessionId !== sessionId) return undefined;
	const snapshot = value.snapshot !== null && typeof value.snapshot === "object" ? (value.snapshot as Record<string, unknown>) : undefined;
	if (!snapshot || typeof snapshot.state !== "string") return undefined;
	return { state: snapshot.state, scope: typeof snapshot.scope === "string" ? snapshot.scope : "" };
}

/**
 * `rows` after `snapshot` at `now`. The last row is updated (keeping its
 * start) while it is unfinished and has the same scope, the snapshot has no
 * known scope, or the row has none yet (S63); otherwise a new row starts.
 * States with no row return `rows`, except `ready` and `unknown`, which remove
 * an unfinished row that never got its files: an inspect or a status call
 * opens one before the answer says no review runs.
 */
export function reduceReviews(rows: RddRow[], snapshot: ReviewSnapshot, now: number, trail?: ReviewTrail): RddRow[] {
	const status = Object.hasOwn(STATUS, snapshot.state) ? STATUS[snapshot.state] : undefined;
	const last = rows.at(-1);
	if (!status) return last?.unnamed && !finished(last.status) && NO_REVIEW.has(snapshot.state) ? rows.slice(0, -1) : rows;
	const known = snapshot.scope.trim() !== "" && snapshot.scope !== SCOPE_UNAVAILABLE;
	const scope = known ? shortScope(snapshot.scope.trim()) : undefined;
	const end = finished(status) ? { endedAt: now } : {};
	// S62: the running row shows the trail's step, the row that finishes its summary.
	const line = trail ? (finished(status) ? trailSummary(trail) : trailStep(trail)) : undefined;
	const detail = line !== undefined ? { detail: line } : {};
	// A row with no files yet stays unnamed until it gets them or finishes.
	const unnamed = (stillUnnamed: boolean) => (stillUnnamed && !finished(status) ? { unnamed: true as const } : {});
	if (last && !finished(last.status) && (scope === undefined || scope === last.scope || last.unnamed)) {
		const kept = trail === undefined && last.detail !== undefined ? { detail: last.detail } : detail;
		const named = scope ?? last.scope;
		return [...rows.slice(0, -1), { scope: named, status, startedAt: last.startedAt, ...end, ...kept, ...unnamed(last.unnamed === true && scope === undefined) }];
	}
	return [...rows, { scope: scope ?? NO_SCOPE, status, startedAt: now, ...end, ...detail, ...unnamed(scope === undefined) }];
}

/** `rows` with the running last row's line set to `trail`'s step (S62); the same rows when it is unchanged or the last row finished. */
export function withTrail(rows: RddRow[], trail: ReviewTrail | undefined): RddRow[] {
	const last = rows.at(-1);
	if (!last || finished(last.status)) return rows;
	const step = trailStep(trail);
	if (step === last.detail) return rows;
	const { detail: _, ...row } = last;
	return [...rows.slice(0, -1), step !== undefined ? { ...row, detail: step } : row];
}

/** What the panel draws for `rows` at `now`: running time for unfinished rows, the end time for finished ones. */
export function rddView(rows: RddRow[] | undefined, now: number): RddInfo | undefined {
	if (!rows?.length) return undefined;
	return {
		reviews: rows.map((row): RddReview => {
			const detail = row.detail !== undefined ? { detail: row.detail } : {};
			if (row.endedAt !== undefined) return { scope: row.scope, status: row.status, endedAt: row.endedAt, ...detail };
			return { scope: row.scope, status: row.status, seconds: Math.max(0, Math.floor((now - row.startedAt) / 1000)), ...detail };
		}),
	};
}

/** True while a review runs or waits for the user: its row shows a live m:ss. */
export function rddLive(info: RddInfo | undefined): boolean {
	return info?.reviews.some((review) => !finished(review.status)) ?? false;
}
