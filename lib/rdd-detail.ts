// What each RDD review is doing (S62, artboard 23 option C): the review tools
// the agent calls are folded into a trail; the running review shows its step,
// a finished one keeps a summary of what it found. Display only: it reads the
// facade's explicit outcomes and never decodes an opaque binding. Only known
// lens names and numbers reach the panel, so no model text is printed.

export interface ReviewTrail {
	/** The lenses START asked for, known names only. */
	lenses?: readonly string[];
	phase?: "consent" | "starting" | "preparing" | "running" | "check" | "fixing" | "validating" | "closing" | "escalated";
	/** Reviewers in the current capture. */
	reviewers?: number;
	/** Reviewer results captured so far in it. */
	done?: number;
	/** The lines the correction plan asks for. */
	lines?: number;
	/** Advisory findings on approval; set once the review is approved. */
	findings?: number;
	/** A correction ran (native allows at most one per review). */
	fixed?: boolean;
	/** Findings an escalation names. */
	escalated?: number;
}

const REVIEW_TOOL = "gentle_review";
const CAPTURE_TOOL = "gentle_review_capture";
const GROUP_TOOL = "gentle_review_capture_group";
/** The native lens names (gentle_review START input). */
const LENSES = new Set(["risk", "resilience", "readability", "reliability"]);
/** Native bounds a correction plan to 200 lines; more reviewers than lenses never come. */
const MAX_LINES = 200;
const MAX_REVIEWERS = 4;

const record = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** A whole number in 1..max, else undefined. */
function count(value: unknown, max: number): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max ? value : undefined;
}

/** START's `input`: an object or its serialized form. */
function startInput(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "string") return record(value);
	try {
		return record(JSON.parse(value));
	} catch {
		return undefined;
	}
}

function lensesOf(input: Record<string, unknown> | undefined): string[] | undefined {
	const lenses = input?.lenses;
	if (!Array.isArray(lenses)) return undefined;
	const known = [...new Set(lenses.filter((lens): lens is string => typeof lens === "string" && LENSES.has(lens)))];
	return known.length > 0 ? known : undefined;
}

/** `trail` after the agent starts `toolName` with `args`; the same trail when it says nothing new. */
export function trailStart(trail: ReviewTrail | undefined, toolName: string, args: unknown): ReviewTrail | undefined {
	const input = record(args);
	if (toolName === REVIEW_TOOL) {
		const operation = input?.operation;
		if (operation === "start") {
			const lenses = lensesOf(startInput(input?.input));
			return { phase: "starting", ...(lenses ? { lenses } : {}) };
		}
		if (operation === "answer-consent") return { ...trail, phase: "starting" };
		if (operation === "acknowledge-approved") return { ...trail, phase: "closing" };
		return trail;
	}
	if (toolName === GROUP_TOOL) {
		const bindings = Array.isArray(input?.collectBindings) ? input.collectBindings.length : 0;
		const reviewers = Math.min(MAX_REVIEWERS, Math.max(1, bindings));
		const phase = trail?.fixed ? "validating" : input?.reviewerRunAcknowledged === true ? "running" : "preparing";
		return { ...trail, phase, reviewers, done: 0 };
	}
	if (toolName === CAPTURE_TOOL) {
		const lines = count(input?.correctionLines, MAX_LINES);
		if (lines !== undefined) return { ...trail, phase: "fixing", fixed: true, lines };
		if (trail?.fixed) return { ...trail, phase: "validating" };
		if (input?.reviewerRunAcknowledged === true) {
			// A sequential slot of a group keeps the group's count and progress.
			const group = trail?.phase === "running" && (trail.reviewers ?? 1) > 1;
			return group ? trail : { ...trail, phase: "running", reviewers: 1, done: 0 };
		}
		return { ...trail, phase: "check", reviewers: 1, done: 0 };
	}
	return trail;
}

/** `trail` after `toolName` returned `details`; failed calls and other outcomes leave it as it was. */
export function trailEnd(trail: ReviewTrail | undefined, toolName: string, details: unknown, isError?: boolean): ReviewTrail | undefined {
	if (isError || (toolName !== REVIEW_TOOL && toolName !== CAPTURE_TOOL && toolName !== GROUP_TOOL)) return trail;
	const data = record(details);
	const outcome = data?.outcome;
	if (outcome === "native-review-consent-required") return { ...trail, phase: "consent" };
	if (toolName === REVIEW_TOOL) return trail;
	if (outcome === "reviewer-model-run-forecast") return { ...trail, phase: "preparing" };
	if (outcome === "native-reviewer-result-captured") {
		const reviewers = trail?.reviewers ?? 1;
		return { ...trail, done: Math.min(reviewers, (trail?.done ?? 0) + 1) };
	}
	if (outcome !== "native-last-event-closure") return trail;
	const closure = record(data?.closure);
	if (closure?.state === "approved") {
		const findings = record(closure.advisory_findings)?.findings;
		return { ...trail, phase: "closing", findings: Array.isArray(findings) ? findings.length : 0 };
	}
	if (closure?.state === "correction_required") {
		const lines = count(closure.correction_lines, MAX_LINES) ?? trail?.lines;
		return { ...trail, phase: "fixing", fixed: true, ...(lines !== undefined ? { lines } : {}) };
	}
	if (closure?.state === "escalated") {
		const ids = record(closure.escalation)?.finding_ids;
		const escalated = Array.isArray(ids) && ids.length > 0 ? ids.length : undefined;
		return { ...trail, phase: "escalated", ...(escalated !== undefined ? { escalated } : {}) };
	}
	return trail;
}

const plural = (amount: number, word: string, many = `${word}s`) => `${amount} ${amount === 1 ? word : many}`;
const lensCount = (trail: ReviewTrail) => (trail.lenses?.length ? plural(trail.lenses.length, "lens", "lenses") : undefined);
const findingsText = (findings: number) => (findings === 0 ? "no findings" : plural(findings, "finding"));

/** The running review's line: what it is doing now; undefined without a trail. */
export function trailStep(trail: ReviewTrail | undefined): string | undefined {
	if (!trail?.phase) return undefined;
	const reviewers = trail.reviewers ?? 1;
	switch (trail.phase) {
		case "consent": {
			const lenses = lensCount(trail);
			return lenses ? `asks to review · ${lenses}` : "asks to review";
		}
		case "starting":
			return trail.lenses?.length ? `starting · ${trail.lenses.join(", ")}` : "starting";
		case "preparing":
			return `preparing ${plural(reviewers, "reviewer")}`;
		case "running": {
			const done = trail.done ?? 0;
			return `running ${plural(reviewers, "reviewer")}${done > 0 && done < reviewers ? ` · ${done} done` : ""}`;
		}
		case "check":
			return "running a check";
		case "fixing":
			return trail.lines !== undefined ? `fixing · up to ${trail.lines} lines` : "fixing the findings";
		case "validating":
			return "validating the fix";
		case "closing": {
			if (trail.findings === undefined) return "closing";
			return trail.findings === 0 ? "closing · no findings" : `closing · ${findingsText(trail.findings)}, none blocking`;
		}
		case "escalated":
			return trail.escalated !== undefined ? `stopped · ${plural(trail.escalated, "finding")} ${trail.escalated === 1 ? "needs" : "need"} your decision` : "stopped · needs your decision";
	}
}

/** A finished review's line, once its findings are known: `7 findings · none blocking · 2 lenses`. */
export function trailSummary(trail: ReviewTrail | undefined): string | undefined {
	if (trail?.findings === undefined) return undefined;
	const outcome = trail.fixed ? "1 fix" : trail.findings > 0 ? "none blocking" : undefined;
	return [findingsText(trail.findings), outcome, lensCount(trail)].filter(Boolean).join(" · ");
}
