import type { OddDetail } from "./odd-detail.ts";

// What the panel draws. Adapters (T4, T5) fill it from real sources; the
// renderer only reads it. Every section but session is optional, and an absent
// or empty section is not drawn.

export interface SessionInfo {
	project: string;
	branch?: string;
	/** Commits ahead of upstream. */
	ahead?: number;
	contextPercent?: number;
	tokensUsed?: number;
	tokensMax?: number;
	/** Gentle Shell's agent-model profile label (S99, lib/profile.ts); no row when absent. */
	profile?: string;
	/** Configured MCP servers in config order (S32): one row each; [] is no MCP config (a muted `none configured` row); no row while absent (not read yet). */
	mcp?: McpServerInfo[];
	/** Engram, the memory row of the connections group (lib/memory.ts); no row while absent (Pi's tool list unreadable). */
	memory?: MemoryInfo;
}

export interface MemoryInfo {
	/** Missing: no mem_save tool, gentle-engram is not installed. Connected: its tools are loaded and the last mem_* call did not fail. */
	state: "connected" | "unreachable" | "missing";
	/** Connected only: mem_save calls that ended without error in this session. */
	saved?: number;
}

export interface McpServerInfo {
	name: string;
	/** Unknown: still connecting, or Pi's tool list cannot tell. */
	state: "connected" | "failing" | "unknown";
}

export interface TodoTask {
	title: string;
	state: "done" | "active" | "pending" | "blocked" | "dropped";
}

export interface TodoInfo {
	done: number;
	total: number;
	active?: string;
	next?: string;
	/** Pending tasks not shown as active or next. */
	more: number;
	/** Every task in list order, for /dock (S26); the side panel draws only the counts above. */
	tasks?: TodoTask[];
	/** The active task row's entrance step (S54, lib/entrance.ts); only while it plays. */
	entrance?: number;
}

export interface OddStep {
	phase: string;
	state: "done" | "active";
	seconds: number;
	/** Active step only: the phase orb frame on screen; the still frame when absent. */
	frame?: number;
	/** Active step only: the label's shine step (S49); a still muted label when absent. */
	scan?: number;
	/** Active step only: its entrance step (S54); the shine above takes over once it ends. */
	entrance?: number;
	/** What the step is doing (active) or did (done), one muted line under it (S60). */
	detail?: OddDetail;
}

export interface OddInfo {
	/** Timeline in occurrence order; a phase may appear more than once. */
	steps: OddStep[];
	/** Steps before `steps` that are no longer kept; the renderer draws the latest 6 and a "+N earlier" row. */
	earlier?: number;
	/** The request is over (agent_settled, S52): the rail shows one summary row, /dock the steps. */
	settled?: boolean;
	/** Request wall time: its first phase start, dropped steps included, to its last step end. */
	totalSeconds?: number;
}

export interface AgentInfo {
	/** Stable identity for start stamping and entrances when the name is not one (subagent tasks: `call:<tool call id>` from their launch call, `task:<id>` when only events or the presence file know them, S87); the name when absent. */
	id?: string;
	name: string;
	task: string;
	/** Queued: a subagent task waiting for a slot (S87). Waiting: it asks the user something, drawn like RDD's needs-your-OK row. */
	state: "done" | "running" | "failed" | "queued" | "waiting";
	/** Epoch ms the agent started: a job's own startedAt, else when Fisi Dock first saw it running (S35). */
	startedAt?: number;
	/** A newly running agent's entrance step (S54, lib/entrance.ts); only while it plays. */
	entrance?: number;
	/** The agent's model id, e.g. "claude-bridge/claude-opus-5-5" (S56); a model label at the right of the agent row when present (S69). */
	model?: string;
	/** Its reasoning effort, e.g. "high"; drawn after the model only. */
	effort?: string;
}

export interface ChangeInfo {
	status: "M" | "A" | "D" | "R" | "?";
	path: string;
	added: number;
	removed: number;
}

export interface HeadsUpWarning {
	kind: "worktrees" | "todo" | "unpushed" | "branches" | "plan";
	/** One short line, counts first. */
	text: string;
}

export interface RddReview {
	/** The reviewed files: the first file's name, then ` +N` more. */
	scope: string;
	/** Reviewing and fixing run, waiting needs the user's OK; the rest are finished. */
	status: "reviewing" | "fixing" | "waiting" | "approved" | "outdated" | "unavailable" | "skipped";
	/** Running and waiting rows: seconds since the review started. */
	seconds?: number;
	/** Finished rows: epoch ms the review ended, drawn as local HH:MM. */
	endedAt?: number;
	/** A new review row's entrance step (S54, lib/entrance.ts); only while it plays. */
	entrance?: number;
	/** One muted line under the row (S62): what a running review is doing, what a finished one found. */
	detail?: string;
}

export interface RddInfo {
	/** The session's reviews, newest last; the renderer draws the latest 6 and a "+N earlier" row. */
	reviews: RddReview[];
}

export interface CiCheck {
	/** The workflow name, printable and bounded. */
	name: string;
	state: "running" | "queued" | "passed" | "failed" | "cancelled";
	/** Running: seconds since it started; finished: its duration; absent when gh gave no times. */
	seconds?: number;
	/** Failed only: `<job> · <first failed step>`, one muted line under the row. */
	failedJob?: string;
}

/** The checks of the branch's last pushed commit (S64); no section without runs. */
export interface CiInfo {
	/** The commit's short sha (7), on the title's right. */
	sha: string;
	/** One per workflow, sorted by name; the renderer draws the first 6 and a "+N more" row. */
	checks: CiCheck[];
	/** Epoch ms of the latest update, drawn as local HH:MM once all passed. */
	endedAt?: number;
	/** The last successful read is over 90 s old: running times stay at it and their spinners hold the still frame (S66). */
	stale?: boolean;
}

/** Drawn as the session's cost row (S32) and the RDD switch on the RDD title (S50); there is no panel footer any more. */
export interface FooterInfo {
	/** Session cost in dollars. */
	cost: number;
	/** Session tokens (S37); with the cost at 0 (a subscription) they show instead of it. */
	tokens?: number;
	/** API-equivalent dollars for those tokens at Pi's model prices; absent when no price is known. */
	estimate?: number;
	/** Review lifecycle text; no longer drawn, the RDD section shows the reviews (S50). */
	review?: string;
	/** RDD switch for the session folder, from `gentle-ai review mode status` (S85), on the RDD title. */
	rdd?: "on" | "off";
}

export interface PanelModel {
	session: SessionInfo;
	/** Things left open; the renderer draws the first 4 and a "+N more" row past 5. */
	headsUp?: HeadsUpWarning[];
	todo?: TodoInfo;
	odd?: OddInfo;
	/** All known agents; the renderer draws the first 4 and a "+N more" row. */
	agents?: AgentInfo[];
	/** All changed files; the renderer draws the first 4 and a "+N more" row. */
	changes?: ChangeInfo[];
	/** The session's RDD reviews (S50); the section also shows with only `footer.rdd`. */
	rdd?: RddInfo;
	/** CI checks of the last pushed commit (S64), after RDD. */
	ci?: CiInfo;
	footer?: FooterInfo;
	/** Running spinner frame (S31) on the active todo task, running agents, a running review and a running CI check; the still frame when absent. */
	spinner?: number;
}

/** Sample content for previews (scripts/preview.ts) and tests. */
export const samplePanelModel: PanelModel = {
	session: {
		project: "my-sample-app",
		branch: "main",
		ahead: 1,
		contextPercent: 6,
		tokensUsed: 12_100,
		tokensMax: 200_000,
		profile: "claude",
	},
	todo: { done: 3, total: 7, active: "Confirm CI is green", next: "Commit workflow fix", more: 2 },
	odd: {
		steps: [
			{ phase: "exploring", state: "done", seconds: 31 },
			{ phase: "implementing", state: "done", seconds: 72 },
			{ phase: "exploring", state: "done", seconds: 20 },
			{ phase: "checking", state: "active", seconds: 42 },
		],
	},
	agents: [
		{ name: "explore", task: "Map CI workflow", state: "done" },
		{ name: "verify", task: "Check PR 265 checks", state: "running" },
	],
	changes: [{ status: "M", path: ".github/workflows/ci.yml", added: 1, removed: 0 }],
	rdd: {
		reviews: [
			{ scope: "fisi-dock.md", status: "approved", endedAt: Date.UTC(2026, 9, 29, 22, 5) },
			{ scope: "lib/orbs.ts +2", status: "reviewing", seconds: 18 },
		],
	},
	footer: { cost: 0, rdd: "on" },
};
