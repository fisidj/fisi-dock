import assert from "node:assert/strict";
import test from "node:test";
import { trailEnd, trailStart, trailStep, trailSummary, type ReviewTrail } from "../lib/rdd-detail.ts";

// What each RDD review is doing (S62, artboard 23 option C). The tool shapes
// follow gentle-pi's facade: START input lenses, the consent and forecast
// outcomes, nonterminal reviewer captures and the last-event closure.

const start = (input: unknown) => ({ operation: "start", idempotencyKey: "k1", input });
const closure = (fields: Record<string, unknown>) => ({ tool: "gentle_review_capture", status: "closed", outcome: "native-last-event-closure", closure: { schema: "gentle-ai.review-last-event-closure/v1", ...fields } });
const advisory = (count: number) => ({ statement: "advisory", findings: Array.from({ length: count }, (_, index) => ({ id: `F${index}`, severity: "minor", disposition: "advisory" })) });
const group = (count: number, ack?: boolean) => ({ lineageId: "l1", collectBindings: Array.from({ length: count }, (_, index) => `{"b":${index}}`), ...(ack === undefined ? {} : { reviewerRunAcknowledged: ack }) });

/** Runs `events` in order from no trail; `["start", tool, args]` or `["end", tool, details, isError?]`. */
function play(events: [string, string, unknown, boolean?][]): ReviewTrail | undefined {
	let trail: ReviewTrail | undefined;
	for (const [kind, tool, data, isError] of events) trail = kind === "start" ? trailStart(trail, tool, data) : trailEnd(trail, tool, data, isError);
	return trail;
}

test("START says it is starting and with which lenses; the input may be a JSON string; unknown lens names are dropped (S62)", () => {
	assert.equal(trailStep(play([["start", "gentle_review", start({ mode: "ordinary", lenses: ["readability", "reliability"], lensesReason: "x" })]])), "starting · readability, reliability");
	assert.equal(trailStep(play([["start", "gentle_review", start(JSON.stringify({ mode: "ordinary", lenses: ["risk"] }))]])), "starting · risk");
	assert.equal(trailStep(play([["start", "gentle_review", start({ mode: "ordinary", lenses: ["risk", "\x1b]0;evil\x07", "made-up", "risk"] })]])), "starting · risk");
	assert.equal(trailStep(play([["start", "gentle_review", start({ mode: "ordinary" })]])), "starting");
	assert.equal(trailStep(play([["start", "gentle_review", start("{not json")]])), "starting");
});

test("consent: it asks to review with its lens count, then starts again once answered (S62)", () => {
	const asked = play([
		["start", "gentle_review", start({ mode: "ordinary", lenses: ["readability", "reliability"] })],
		["end", "gentle_review", { outcome: "native-review-consent-required" }],
	]);
	assert.equal(trailStep(asked), "asks to review · 2 lenses");
	assert.equal(trailStep(trailStart(asked, "gentle_review", { operation: "answer-consent", input: { consentBinding: "c", answer: "granted" } })), "starting · readability, reliability");
	assert.equal(trailStep(play([["start", "gentle_review", start({ mode: "ordinary" })], ["end", "gentle_review", { outcome: "native-review-consent-required" }]])), "asks to review");
});

test("reviewers: preparing until the forecast is acknowledged, then running with how many are done (S62)", () => {
	const base: [string, string, unknown, boolean?][] = [["start", "gentle_review", start({ mode: "ordinary", lenses: ["readability", "reliability"] })]];
	assert.equal(trailStep(play([...base, ["start", "gentle_review_capture_group", group(2)]])), "preparing 2 reviewers");
	assert.equal(trailStep(play([...base, ["start", "gentle_review_capture_group", group(2)], ["end", "gentle_review_capture_group", { outcome: "reviewer-model-run-forecast" }]])), "preparing 2 reviewers");
	assert.equal(trailStep(play([...base, ["start", "gentle_review_capture_group", group(2, true)]])), "running 2 reviewers");
	assert.equal(trailStep(play([...base, ["start", "gentle_review_capture_group", group(2, true)], ["end", "gentle_review_capture", { outcome: "native-reviewer-result-captured" }]])), "running 2 reviewers · 1 done");
	assert.equal(trailStep(play([...base, ["start", "gentle_review_capture", { lineageId: "l1", collectBinding: "{}", reviewerRunAcknowledged: true }]])), "running 1 reviewer");
	assert.equal(trailStep(play([...base, ["start", "gentle_review_capture", { lineageId: "l1", collectBinding: "{}" }]])), "running a check");
	assert.equal(trailStep(play([...base, ["start", "gentle_review_capture", { lineageId: "l1", collectBinding: "{}" }], ["end", "gentle_review_capture", { outcome: "reviewer-model-run-forecast" }]])), "preparing 1 reviewer");
});

test("approved: closing with the advisory findings, then a kept summary with the lenses (S62)", () => {
	const approved = play([
		["start", "gentle_review", start({ mode: "ordinary", lenses: ["readability", "reliability"] })],
		["start", "gentle_review_capture_group", group(2, true)],
		["end", "gentle_review_capture_group", closure({ state: "approved", advisory_findings: advisory(7) })],
	]);
	assert.equal(trailStep(approved), "closing · 7 findings, none blocking");
	assert.equal(trailSummary(approved), "7 findings · none blocking · 2 lenses");
	assert.equal(trailStep(trailStart(approved, "gentle_review", { operation: "acknowledge-approved", lineageId: "l1" })), "closing · 7 findings, none blocking");
	const clean = play([
		["start", "gentle_review", start({ mode: "ordinary", lenses: ["risk"] })],
		["end", "gentle_review_capture", closure({ state: "approved" })],
	]);
	assert.equal(trailStep(clean), "closing · no findings");
	assert.equal(trailSummary(clean), "no findings · 1 lens");
	assert.equal(trailSummary(play([["end", "gentle_review_capture", closure({ state: "approved", advisory_findings: advisory(1) })]])), "1 finding · none blocking", "no START seen: no lens count");
});

test("a fix: fixing, its planned lines, validating, then a summary that says it took 1 fix (S62)", () => {
	const events: [string, string, unknown, boolean?][] = [
		["start", "gentle_review", start({ mode: "ordinary", lenses: ["risk", "reliability"] })],
		["start", "gentle_review_capture_group", group(2, true)],
		["end", "gentle_review_capture_group", closure({ state: "correction_required" })],
	];
	assert.equal(trailStep(play(events)), "fixing the findings");
	events.push(["start", "gentle_review_capture", { lineageId: "l1", collectBinding: "{}", correctionLines: 38 }]);
	assert.equal(trailStep(play(events)), "fixing · up to 38 lines");
	events.push(["end", "gentle_review_capture", closure({ state: "correction_required", correction_lines: 38 })]);
	assert.equal(trailStep(play(events)), "fixing · up to 38 lines");
	events.push(["start", "gentle_review_capture", { lineageId: "l1", collectBinding: "{}" }]);
	assert.equal(trailStep(play(events)), "validating the fix");
	events.push(["end", "gentle_review_capture", closure({ state: "approved", advisory_findings: advisory(3) })]);
	assert.equal(trailSummary(play(events)), "3 findings · 1 fix · 2 lenses");
});

test("escalated: it stopped and names how many findings need a decision (S62)", () => {
	const escalated = (ids: unknown) => play([
		["start", "gentle_review", start({ mode: "ordinary", lenses: ["risk"] })],
		["end", "gentle_review_capture", closure({ state: "escalated", escalation: { cause: "c", finding_ids: ids } })],
	]);
	assert.equal(trailStep(escalated(["F1", "F2"])), "stopped · 2 findings need your decision");
	assert.equal(trailStep(escalated(["F1"])), "stopped · 1 finding needs your decision");
	assert.equal(trailStep(escalated(undefined)), "stopped · needs your decision");
});

test("failed calls, other tools and other operations leave the trail as it was; no summary before findings are known (S62)", () => {
	const trail = play([["start", "gentle_review", start({ mode: "ordinary", lenses: ["risk"] })]]);
	assert.equal(trailEnd(trail, "gentle_review_capture", closure({ state: "approved", advisory_findings: advisory(2) }), true), trail, "isError");
	assert.equal(trailStart(trail, "bash", { command: "ls" }), trail);
	assert.equal(trailEnd(trail, "read", { outcome: "native-review-consent-required" }), trail);
	for (const operation of ["status", "inspect", "assess"]) assert.equal(trailStart(trail, "gentle_review", { operation }), trail, operation);
	assert.equal(trailEnd(trail, "gentle_review", undefined), trail);
	assert.equal(trailEnd(trail, "gentle_review_capture", closure({ state: "invalidated" })), trail);
	assert.equal(trailSummary(trail), undefined);
	assert.equal(trailSummary(undefined), undefined);
	assert.equal(trailStep(undefined), undefined);
});
