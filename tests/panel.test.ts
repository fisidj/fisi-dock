import assert from "node:assert/strict";
import test from "node:test";
import { samplePanelModel, type PanelModel } from "../lib/panel-model.ts";
import { DOCK_MAX_WIDTH, DOCK_TOP_ROWS, DOCK_WIDTH, formatElapsed, formatEstimate, panelDigest, renderAgentsCard, renderDock, renderPanel, renderRail, renderTodoCard } from "../lib/panel.ts";
import { bgCode, fgCode, palette, panelVivid } from "../lib/palette.ts";
import { visibleWidth } from "../lib/text.ts";

const plain = (line: string) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const clone = (model: PanelModel): PanelModel => structuredClone(model);
/** `line` with the color left off every span of frame glyphs (the rail fades its frames, the narrow cards keep them flat). */
const frameless = (line: string) => line.replace(/\x1b\[38;2;\d+;\d+;\d+m([╭╮╰╯─│ ]+)\x1b\[39m/g, "$1");

const longModel: PanelModel = {
	session: {
		project: "an-extremely-long-project-name-that-never-ends-in-the-rail",
		branch: "feature/very-long-branch-name-with-many-segments-and-words",
		ahead: 12,
		contextPercent: 99,
		tokensUsed: 198_765,
		tokensMax: 200_000,
	},
	todo: {
		done: 12,
		total: 50,
		active: "A very long active task description that goes on and on past the rail",
		next: "Another very long next task description that never seems to stop at all",
		more: 37,
	},
	odd: {
		steps: [
			{ phase: "exploring-a-very-long-phase-name-here", state: "done", seconds: 3599 },
			{ phase: "implementing-with-another-long-phase-name", state: "active", seconds: 7322 },
		],
	},
	agents: [
		{ name: "an-agent-with-a-long-name", task: "A task text that is far too long to ever fit in the rail width", state: "running" },
		{ name: "explore", task: "Short", state: "done" },
	],
	changes: [
		{ status: "M", path: "packages/some/really/deep/directory/structure/with/a/file-name-that-is-long.ts", added: 1234, removed: 987 },
		{ status: "?", path: "x", added: 0, removed: 0 },
	],
	footer: { cost: 123.456789, review: "RDD on with a long review label" },
};

function sectionBody(lines: string[], title: string): string[] {
	const start = lines.findIndex((line) => plain(line).startsWith(`╭─ ${title}`));
	assert.ok(start >= 0, `section ${title} missing`);
	const end = lines.findIndex((line, index) => index > start && plain(line).startsWith("╰"));
	return lines.slice(start + 1, end).map(plain);
}

for (const width of [55, 47, 40, 30, 20]) {
	for (const [name, model] of [["sample", samplePanelModel], ["long", longModel]] as const) {
		test(`every ${name} line fits width ${width}`, () => {
			const lines = renderPanel(model, width);
			assert.ok(lines.length > 0);
			for (const line of lines) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}: ${JSON.stringify(plain(line))}`);
		});
	}
}

test("frame lines span the full width", () => {
	for (const width of [47, 30, 20]) {
		for (const line of renderPanel(samplePanelModel, width).filter((line) => /^[╭│╰]/.test(plain(line)))) {
			assert.equal(visibleWidth(line), width, JSON.stringify(plain(line)));
		}
	}
});

test("tiny widths never throw nor overflow", () => {
	for (const width of [0, 1, 2, 3, 5, 10]) {
		for (const line of renderPanel(longModel, width)) assert.ok(visibleWidth(line) <= width, `width ${width}`);
	}
});

test("long values are cut with an ellipsis inside the frame", () => {
	const lines = renderPanel(longModel, 47).map(plain);
	const path = lines.find((line) => line.includes("file-name-that-is-long.ts pac"));
	assert.ok(path, "path row");
	assert.ok(path.includes("…"));
	assert.ok(path.startsWith("│") && path.endsWith("│"));
	const active = sectionBody(lines, "todo").find((line) => line.includes("A very long active"));
	assert.ok(active, "active row");
	assert.ok(active.includes("…"));
	assert.ok(active.endsWith("│"));
});

test("sections follow the approved order: logo, session, odd, rdd, agents, todo, changes; the panel ends with the last frame (S32, S50, S51)", () => {
	const lines = renderPanel(samplePanelModel, 47).map(plain);
	assert.match(lines[0], /^ *[⠛⣤⣿]/, "braille logo first");
	assert.ok(!lines.some((line) => line.includes("✿")), "no flower");
	const order = ["╭─ session", "╭─ ODD", "╭─ RDD", "╭─ agents", "╭─ todo", "╭─ changes"].map((title) => lines.findIndex((line) => line.startsWith(title)));
	for (const index of order) assert.ok(index > 0);
	assert.deepEqual(order, order.toSorted((a, b) => a - b));
	const cost = lines.findIndex((line) => line.includes("$0.000"));
	assert.ok(cost > order[0] && cost < order[1], "cost inside session");
	assert.match(lines.at(-1)!, /^╰─+╯$/, "no footer below the last section");
	assert.ok(!lines.some((line) => /^─+$/.test(line)), "no footer separator");
});

test("sample sections show design 07 content", () => {
	const lines = renderPanel(samplePanelModel, 47).map(plain);
	const session = sectionBody(lines, "session");
	assert.deepEqual(session.map((line) => line.replace(/ +│$/, "").replace(/(?<=context  )[━─┼]+/, "<meter>")), [
		"│ project  my-sample-app  main ↑1",
		"│ context  <meter> 6% · 12.1k/200k",
		"│ profile  claude                      $0.000",
	]);
	assert.match(session[1], /^│ context  [━─┼]{18} 6% · 12\.1k\/200k │$/);
	assert.ok(lines.find((line) => line.startsWith("╭─ todo"))!.includes(" 3/7 ─╮"));
	assert.deepEqual(sectionBody(lines, "agents").map((line) => line.replace(/ +│$/, "")), ["│ ✓ explore Map CI workflow", "│ ⠹ verify Check PR 265 checks"]);
	const changes = sectionBody(lines, "changes");
	assert.deepEqual(changes, [`│ ● ci.yml .github/workflows/${" ".repeat(11)}+1 -0 │`]);
	assert.ok(lines.find((line) => line.startsWith("╭─ changes"))!.includes(" 1 to commit ─╮"));
});

test("absent or empty sections are not drawn; session, ODD and todo always are; a clean git tree keeps changes (S52, S53, S94)", () => {
	const lines = renderPanel({ session: { project: "solo" } }, 47).map(plain);
	for (const title of ["session", "ODD", "todo"]) assert.ok(lines.some((line) => line.startsWith(`╭─ ${title}`)), title);
	for (const title of ["agents", "changes"]) assert.ok(!lines.some((line) => line.startsWith(`╭─ ${title}`)), title);
	assert.ok(!lines.some((line) => line.includes("cost")));
	const empty = renderPanel({ session: { project: "solo" }, todo: { done: 0, total: 0, more: 0 }, odd: { steps: [] }, agents: [], changes: [] }, 47).map(plain);
	for (const title of ["ODD", "todo"]) assert.ok(empty.some((line) => line.startsWith(`╭─ ${title}`)), title);
	assert.ok(!empty.some((line) => line.startsWith("╭─ agents")), "agents");
	assert.ok(empty.some((line) => line.startsWith("╭─ changes")), "changes: [] is a known, clean tree");
});

// --- S52: ODD always on screen -----------------------------------------------------

const oddText = (lines: string[]) => sectionBody(lines, "ODD").map((line) => line.replace(/^│[ ▎]/, "").replace(/ +│$/, "").replace(/ +/g, " "));
const settledOdd = (steps: number, earlier = 0, totalSeconds = 165): PanelModel["odd"] => ({
	steps: Array.from({ length: steps }, (_, index) => ({ phase: index % 2 ? "implementing" : "exploring", state: "done" as const, seconds: 10 })),
	...(earlier ? { earlier } : {}),
	settled: true,
	totalSeconds,
});

test("ODD before the first request: one muted ready row, faint ○, vivid amber title (S52)", () => {
	for (const odd of [undefined, { steps: [] }]) {
		const raw = renderPanel({ session: { project: "p" }, ...(odd ? { odd } : {}) }, 47);
		const lines = raw.map(plain);
		assert.deepEqual(oddText(lines), ["○ ready · phases show while I work"]);
		const row = raw[lines.findIndex((line) => line.startsWith("╭─ ODD")) + 1];
		assert.ok(row.includes(`${fgCode(palette.faint)}○`), "faint ○");
		assert.ok(row.includes(`${fgCode(palette.muted)}ready · phases show while I work`), "muted text");
		assert.ok(raw.find((line) => plain(line).startsWith("╭─ ODD"))!.includes(`${fgCode(panelVivid(palette.amber))}`), "vivid amber title");
	}
	for (const width of [47, 30, 20, 12]) for (const line of renderPanel({ session: { project: "p" } }, width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
});

// --- S94: todo always drawn ------------------------------------------------------

const NO_TASKS = "no tasks · the list shows while I plan";

test("todo without a list or with 0 tasks: one muted row, faint ○, vivid coral title, no count; the card stays empty (S94, S28)", () => {
	for (const todo of [undefined, { done: 0, total: 0, more: 0 }]) {
		const model: PanelModel = { session: { project: "p" }, ...(todo ? { todo } : {}) };
		const raw = renderPanel(model, 47);
		const lines = raw.map(plain);
		const start = lines.findIndex((line) => line.startsWith("╭─ todo"));
		assert.deepEqual(lines.slice(start, start + 3), [`╭─ todo ${"─".repeat(38)}╮`, `│ ○ ${NO_TASKS}    │`, `╰${"─".repeat(45)}╯`]);
		assert.ok(raw[start].includes(fgCode(panelVivid(palette.coral))), "vivid coral title");
		assert.ok(raw[start + 1].includes(`${fgCode(palette.faint)}○`), "faint ○");
		assert.ok(raw[start + 1].includes(`${fgCode(palette.muted)}${NO_TASKS}`), "muted text");
		assert.ok(!raw[start + 1].includes(bgCode(palette.highlight)), "not highlighted");
		assert.deepEqual(renderTodoCard(todo, 64), [], "no narrow card without tasks");
		for (const width of [47, 30, 20, 12, 5]) for (const line of renderPanel(model, width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
	}
	assert.match(sectionBody(renderPanel({ session: { project: "p" } }, 30), "todo")[0], /^│ ○ no tasks · the list sho… │$/, "ellipsized when narrow");
});

test("the empty todo sits after agents and before changes, in /dock too, and never drops on short screens (S94, S38)", () => {
	const model: PanelModel = { session: { project: "p" }, agents: [{ name: "explore", task: "Map", state: "done" }], changes: [{ status: "M", path: "lib/panel.ts", added: 1, removed: 0 }] };
	const lines = renderPanel(model, 47).map(plain);
	const order = ["╭─ agents", "╭─ todo", "╭─ changes"].map((title) => lines.findIndex((line) => line.startsWith(title)));
	assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], `order ${order}`);
	const dock = renderDock(model, DOCK_WIDTH + 2, 200).lines.map((line) => plain(line).slice(1, -1));
	assert.deepEqual(sectionBody(dock, "todo").map((line) => line.replace(/ +│$/, " │")), [`│ ○ ${NO_TASKS} │`], "/dock");
	const tiny = renderPanel(model, 47, { maxRows: 3 }).map(plain);
	assert.deepEqual(sectionBody(tiny, "todo"), [`│ ○ ${NO_TASKS}    │`], "kept on the shortest screen");
	assert.ok(!tiny.some((line) => line.startsWith("╭─ changes")), "changes still drops first");
});

test("a running request keeps today's timeline (S52)", () => {
	const lines = renderPanel(samplePanelModel, 58).map(plain);
	assert.deepEqual(oddText(lines).filter((line) => line !== "│"), ["✓ exploring 0:31", "✓ implementing 1:12", "✓ exploring 0:20", "⡿ checking 0:42"]);
	assert.equal(oddText(lines).filter((line) => line === "│").length, 3, "spacers kept");
});

test("a settled request collapses to one row: ✓ last request m:ss · N phases (S52)", () => {
	const raw = renderPanel({ session: { project: "p" }, odd: settledOdd(4) }, 47);
	const lines = raw.map(plain);
	assert.deepEqual(sectionBody(lines, "ODD"), [`│ ✓ last request${" ".repeat(47 - 4 - 14 - 15)}2:45 · 4 phases │`]);
	const row = raw[lines.findIndex((line) => line.startsWith("╭─ ODD")) + 1];
	assert.ok(row.includes(`${fgCode(palette.green)}✓`), "green ✓");
	assert.ok(row.includes(`${fgCode(palette.text)}last request`), "text color");
	assert.ok(row.includes(`${fgCode(palette.muted)}2:45 · 4 phases`), "muted right side");
	assert.deepEqual(oddText(renderPanel({ session: { project: "p" }, odd: settledOdd(1, 0, 7) }, 47).map(plain)), ["✓ last request 0:07 · 1 phase"]);
	assert.deepEqual(oddText(renderPanel({ session: { project: "p" }, odd: settledOdd(6, 3, 600) }, 47).map(plain)), ["✓ last request 10:00 · 9 phases"], "earlier steps count");
	for (const width of [47, 30, 20, 12]) for (const line of renderPanel({ session: { project: "p" }, odd: settledOdd(6, 120, 3725) }, width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
	assert.match(sectionBody(renderPanel({ session: { project: "p" }, odd: settledOdd(4) }, 20).map(plain), "ODD")[0], /^│ ✓ last request +│$/, "the right side drops when it does not fit");
});

test("/dock still lists every kept step after the request settled (S52)", () => {
	const odd = { ...settledOdd(0), steps: samplePanelModel.odd!.steps.map((step) => ({ ...step, state: "done" as const })) };
	const lines = renderDock({ session: { project: "p" }, odd }, DOCK_WIDTH + 2, 200).lines.map((line) => plain(line).slice(1, -1));
	assert.deepEqual(oddText(lines).filter((line) => line !== "│"), ["✓ exploring 0:31", "✓ implementing 1:12", "✓ exploring 0:20", "✓ checking 0:42"]);
	const empty = renderDock({ session: { project: "p" } }, DOCK_WIDTH + 2, 200).lines.map((line) => plain(line).slice(1, -1));
	assert.deepEqual(oddText(empty), ["○ ready · phases show while I work"], "/dock before any request");
});

const costRow = (footer: NonNullable<PanelModel["footer"]>, width = 47) =>
	renderPanel({ session: { project: "p" }, footer }, width).find((line) => /^│ cost /.test(plain(line)))!;

test("session cost row: `cost` on the left with the dollars, no review text nor RDD (S50, S32)", () => {
	assert.equal(plain(costRow({ cost: 0.0123, rdd: "on" })), `│ cost     $0.012${" ".repeat(28)} │`);
	assert.equal(plain(costRow({ cost: 0, rdd: "off" })), `│ cost     $0.000${" ".repeat(28)} │`);
	const line = costRow({ cost: 0, rdd: "on" });
	assert.ok(line.includes(`${palette.muted.join(";")}mcost`), "cost label is muted");
	assert.ok(line.includes(`${palette.text.join(";")}m$0.000`), "value in the text color");
	const session = sectionBody(renderPanel({ session: { project: "p" }, footer: { cost: 0, review: "✓ Approved", rdd: "on" } }, 47), "session").join("\n");
	assert.ok(!session.includes("RDD") && !session.includes("review") && !session.includes("Approved"), session);
});

test("the cost row sits in session after the context row and fits every rail width", () => {
	const lines = renderPanel({ session: { project: "p", contextPercent: 5, tokensUsed: 53_500, tokensMax: 1_000_000 }, footer: { cost: 0.012, rdd: "on" } }, 47).map(plain);
	assert.deepEqual(sectionBody(lines, "session").map((line) => line.replace(/ +/g, " ")), ["│ project p │", `│ context ━${"─".repeat(11)}┼${"─".repeat(4)}┼── 5% · 53.5k/1M │`, "│ cost $0.012 │"]);
	for (const width of [58, 55, 47, 30, 20, 12, 5, 1]) {
		for (const line of renderPanel({ session: { project: "p" }, footer: { cost: 123.456, rdd: "off", review: "Reviewers running…" } }, width)) assert.ok(visibleWidth(line) <= width, `width ${width}`);
	}
});

// S37: a subscription records tokens but no cost; the row shows them and Pi's API-price estimate.
const usageRow = (footer: NonNullable<PanelModel["footer"]>, width = 58) =>
	renderPanel({ session: { project: "p" }, footer }, width).find((line) => / tok|cost/.test(plain(line)))!;

test("estimates round to whole dollars from $10 and keep cents below (S37)", () => {
	assert.equal(formatEstimate(38.4), "≈$38");
	assert.equal(formatEstimate(10), "≈$10");
	assert.equal(formatEstimate(9.996), "≈$10");
	assert.equal(formatEstimate(9.99), "≈$9.99");
	assert.equal(formatEstimate(4.267), "≈$4.27");
	assert.equal(formatEstimate(0.001), "≈$0.00");
});

test("cost 0 with tokens: the cost row shows tokens and the ≈ estimate (S37, S50)", () => {
	assert.equal(plain(usageRow({ cost: 0, tokens: 12_400_000, estimate: 38.4, rdd: "on" })), `│ cost     12.4M tok · ≈$38${" ".repeat(29)} │`);
	assert.equal(plain(usageRow({ cost: 0, tokens: 53_500, estimate: 4.267, rdd: "on" })), `│ cost     53.5k tok · ≈$4.27${" ".repeat(27)} │`);
	const line = usageRow({ cost: 0, tokens: 12_400_000, estimate: 38.4, rdd: "on" });
	assert.ok(line.includes(`${palette.muted.join(";")}m tok · `), "label in the muted style");
	assert.ok(line.includes(`${palette.text.join(";")}m12.4M`) && line.includes(`${palette.text.join(";")}m≈$38`), "values in the text color");
	assert.ok(!plain(line).includes("$0.000"));
});

test("cost 0 with tokens and no price: tokens only, no estimate (S37)", () => {
	assert.equal(plain(usageRow({ cost: 0, tokens: 12_400_000, rdd: "on" })), `│ cost     12.4M tok${" ".repeat(36)} │`);
});

test("a real cost above 0 shows the dollars, tokens or not (S37)", () => {
	assert.equal(plain(usageRow({ cost: 0.0123, tokens: 12_400_000, estimate: 38.4, rdd: "on" }, 47)), `│ cost     $0.012${" ".repeat(28)} │`);
	assert.equal(plain(usageRow({ cost: 0, tokens: 0, rdd: "on" }, 47)), `│ cost     $0.000${" ".repeat(28)} │`);
});

test("the tokens row fits every rail width (S37)", () => {
	for (const width of [58, 55, 47, 30, 20, 12, 5, 1]) {
		for (const line of renderPanel({ session: { project: "p" }, footer: { cost: 0, tokens: 123_456_789, estimate: 12_345.6, rdd: "off", review: "Reviewers running…" } }, width)) assert.ok(visibleWidth(line) <= width, `width ${width}`);
	}
});

// --- S50: the RDD section ------------------------------------------------------------

const rddPanel = (model: Partial<PanelModel>, width = 47) => renderPanel({ session: { project: "p" }, ...model }, width);
const rddTitle = (lines: string[]) => lines.find((line) => plain(line).startsWith("╭─ RDD"))!;
const hhmm = (ms: number) => {
	const date = new Date(ms);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const ENDED = Date.UTC(2026, 9, 29, 22, 5, 0);

test("RDD section: vivid rose title right after ODD, `on` vivid green / `off` muted on the right (S50)", () => {
	const lines = rddPanel({ odd: samplePanelModel.odd, agents: samplePanelModel.agents, footer: { cost: 0, rdd: "on" } });
	const titles = lines.map(plain).filter((line) => line.startsWith("╭─ ")).map((line) => line.slice(3).split(" ")[0]);
	assert.deepEqual(titles, ["session", "ODD", "RDD", "agents", "todo"]);
	const on = rddTitle(lines);
	assert.ok(on.includes(`${fgCode(panelVivid(palette.rose))}RDD`), "title in vivid rose");
	assert.ok(on.includes(`${fgCode(panelVivid(palette.green))}on`), "on in vivid green");
	assert.match(plain(on), /^╭─ RDD ─+ on ─╮$/);
	const off = rddTitle(rddPanel({ footer: { cost: 0, rdd: "off" } }));
	assert.ok(off.includes(`${fgCode(palette.muted)}off`), "off muted");
	assert.match(plain(off), /^╭─ RDD ─+ off ─╮$/);
});

test("RDD idle rows: on says what it watches, off says it is off (S50)", () => {
	const on = rddPanel({ footer: { cost: 0, rdd: "on" } });
	assert.deepEqual(sectionBody(on, "RDD").map((line) => line.replace(/ +│$/, "")), ["│ ● watching · reviews high-risk changes"]);
	assert.ok(on.some((line) => line.includes(`${fgCode(palette.muted)}watching · reviews high-risk changes`)), "muted text");
	const off = rddPanel({ footer: { cost: 0, rdd: "off" } });
	assert.deepEqual(sectionBody(off, "RDD").map((line) => line.replace(/ +│$/, "")), ["│ ○ off · changes are not reviewed"]);
	assert.ok(off.some((line) => line.includes(`${fgCode(palette.muted)}off · changes are not reviewed`)), "muted text");
});

test("RDD section is hidden only with no switch and no rows (no Gentle AI) (S50)", () => {
	assert.ok(!rddPanel({ footer: { cost: 0 } }).some((line) => plain(line).startsWith("╭─ RDD")));
	assert.ok(!rddPanel({}).some((line) => plain(line).startsWith("╭─ RDD")));
	const rows = rddPanel({ rdd: { reviews: [{ scope: "a.ts", status: "approved", endedAt: ENDED }] } });
	assert.match(plain(rddTitle(rows)), /^╭─ RDD ─+╮$/, "rows without a switch: title alone");
});

test("RDD active row: highlighted, teal spinner, bold scope, muted status and m:ss (S50)", () => {
	const lines = rddPanel({ spinner: 4, footer: { cost: 0, rdd: "on" }, rdd: { reviews: [{ scope: "lib/orbs.ts +2", status: "reviewing", seconds: 18 }] } });
	const raw = lines.find((line) => plain(line).includes("lib/orbs.ts"))!;
	assert.match(plain(raw), /^│▎⠼ lib\/orbs\.ts \+2 reviewing… +0:18 │$/);
	assert.ok(raw.includes(fgCode(palette.teal)), "teal spinner");
	assert.ok(raw.includes(`\x1b[1m${fgCode(palette.text)}lib/orbs.ts +2`), "bold scope");
	assert.ok(raw.includes(`${fgCode(palette.muted)}reviewing…`), "muted status");
	const fixing = plain(rddPanel({ rdd: { reviews: [{ scope: "a.ts", status: "fixing", seconds: 75 }] } }).find((line) => plain(line).includes("a.ts"))!);
	assert.match(fixing, /^│▎⠹ a\.ts fixing… +1:15 │$/, "still frame without a spinner");
});

test("RDD waiting row: highlighted amber ! (one column, not the ambiguous-width ⚠), bold scope, amber `needs your OK`, m:ss (S50)", () => {
	const raw = rddPanel({ rdd: { reviews: [{ scope: "panel.ts +3", status: "waiting", seconds: 4 }] } }).find((line) => plain(line).includes("panel.ts"))!;
	assert.match(plain(raw), /^│▎! panel\.ts \+3 needs your OK +0:04 │$/);
	assert.ok(raw.includes(`${fgCode(palette.amber)}!`), "amber glyph");
	assert.ok(raw.includes(`[1m${fgCode(palette.text)}panel.ts +3`), "bold scope");
	assert.ok(raw.includes(`${fgCode(palette.amber)}needs your OK`), "amber label");
});

const HIGHLIGHT_BG = bgCode(palette.highlight);

test("RDD finished rows: ✓ approved, ✗ outdated / unavailable, skipped muted, each with local HH:MM (S50)", () => {
	const lines = rddPanel({
		rdd: {
			reviews: [
				{ scope: "fisi-dock.md", status: "approved", endedAt: ENDED },
				{ scope: "panel.ts", status: "outdated", endedAt: ENDED + 60_000 },
				{ scope: "x.ts", status: "unavailable", endedAt: ENDED },
				{ scope: "y.ts", status: "skipped", endedAt: ENDED },
			],
		},
	});
	const body = sectionBody(lines, "RDD").map((line) => line.replace(/ +/g, " "));
	assert.deepEqual(body, [
		`│ ✓ fisi-dock.md approved ${hhmm(ENDED)} │`,
		"│ │ │",
		`│ ✗ panel.ts outdated · code changed ${hhmm(ENDED + 60_000)} │`,
		"│ │ │",
		`│ ✗ x.ts unavailable ${hhmm(ENDED)} │`,
		"│ │ │",
		`│ - y.ts skipped ${hhmm(ENDED)} │`,
	]);
	const row = (text: string) => lines.find((line) => plain(line).includes(text))!;
	assert.ok(row("fisi-dock.md").includes(`${fgCode(palette.green)}✓`), "green check");
	assert.ok(row("fisi-dock.md").includes(`${fgCode(palette.text)}fisi-dock.md`), "scope in the text color");
	assert.ok(row("fisi-dock.md").includes(`${fgCode(palette.muted)}approved`), "muted label");
	assert.ok(row("fisi-dock.md").includes(`${fgCode(palette.muted)}${hhmm(ENDED)}`), "muted time");
	assert.ok(row("panel.ts").includes(`${fgCode(palette.red)}✗`), "red cross");
	assert.ok(row("panel.ts").includes(`${fgCode(palette.muted)}outdated · code changed`), "muted outdated label");
	assert.ok(row("y.ts").includes(`${fgCode(palette.muted)}y.ts`), "skipped scope muted");
	assert.ok(!row("fisi-dock.md").includes(HIGHLIGHT_BG), "finished rows are not highlighted");
});

test("RDD caps like ODD: the latest 6 rows and `+N earlier` (S50)", () => {
	const reviews = Array.from({ length: 9 }, (_, index) => ({ scope: `f${index}.ts`, status: "approved" as const, endedAt: ENDED }));
	const body = sectionBody(rddPanel({ rdd: { reviews } }), "RDD").filter((line) => !/^│ │ +│$/.test(line));
	assert.equal(body.length, 7);
	assert.match(body[0], /^│ {3}\+3 earlier +│$/);
	assert.ok(body[1].includes("f3.ts") && body[6].includes("f8.ts"), "newest last");
});

test("RDD rows fit 47, 30 and 20 columns, the watching row included (S50)", () => {
	const models: Partial<PanelModel>[] = [
		{ footer: { cost: 0, rdd: "on" } },
		{ footer: { cost: 0, rdd: "off" } },
		{
			footer: { cost: 0, rdd: "on" },
			rdd: {
				reviews: [
					{ scope: "a-really-long-file-name-for-the-review.ts +12", status: "outdated", endedAt: ENDED },
					{ scope: "another-long-name.ts +3", status: "waiting", seconds: 3_700 },
					{ scope: "lib/orbs.ts +2", status: "reviewing", seconds: 18 },
				],
			},
		},
	];
	for (const width of [47, 30, 20, 12, 5]) {
		for (const model of models) {
			const lines = rddPanel(model, width);
			for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${JSON.stringify(plain(line))}`);
			if (width >= 20) for (const line of lines.filter((line) => /^[╭│╰]/.test(plain(line)))) assert.equal(visibleWidth(line), width, JSON.stringify(plain(line)));
		}
	}
});

test("session profile row: Gentle Shell's label with the cost flush right; without a profile the cost keeps its own row (S99)", () => {
	const session = (profile?: string) => sectionBody(renderPanel({ session: { project: "p", contextPercent: 40, ...(profile ? { profile } : {}) }, footer: { cost: 0.012 } }, 47), "session");
	const rows = session("claude (session)");
	assert.match(rows[2], /^│ profile  claude \(session\) +\$0\.012 │$/);
	assert.ok(!rows.some((line) => line.startsWith("│ cost")), "the cost rides the profile row");
	assert.ok(!session().some((line) => line.includes("profile")), "no profile, no profile row");
	assert.match(session().at(-1)!, /^│ cost +\$0\.012 +│$/);
	for (const width of [20, 30, 47]) {
		const line = renderPanel({ session: { project: "p", profile: "a-very-long-profile-name-that-never-ends (session)" } }, width).find((row) => plain(row).includes("profile"))!;
		assert.equal(visibleWidth(line), width, JSON.stringify(plain(line)));
	}
	const long = sectionBody(renderPanel({ session: { project: "p", profile: "a-very-long-profile-name-that-never-ends (session)" }, footer: { cost: 0.127 } }, 47), "session");
	assert.match(long.find((line) => line.includes("profile"))!, /^│ profile  a-very-long-profile-name-t… \$0\.127 │$/, "the profile is cut before the cost");
});

// --- the grouped session section (design session-section/02, artboard 02) -----------------

/** The artboard's states (a)-(e), as its script draws them; (a) is the user's setup with 3 saves. */
const ART_SESSION: PanelModel["session"] = { project: "fisi-dock", branch: "main", contextPercent: 5, tokensUsed: 53_500, tokensMax: 1_000_000, profile: "claude", memory: { state: "connected", saved: 3 }, mcp: [] };
const ART_STATES: Record<string, PanelModel["session"]> = {
	a: ART_SESSION,
	b: { ...ART_SESSION, ahead: 2, mcp: [{ name: "context7", state: "connected" }, { name: "github", state: "unknown" }, { name: "sentry", state: "failing" }] },
	c: { ...ART_SESSION, memory: { state: "unreachable" } },
	d: { ...ART_SESSION, contextPercent: 87, tokensUsed: 870_000 },
	e: { ...ART_SESSION, memory: { state: "missing" } },
};
/** The session box, frame included, of `session` with the artboard's $0.127 at `width`. */
const sessionBox = (session: PanelModel["session"], width: number, raw = false, options: Parameters<typeof renderPanel>[2] = {}) => {
	const lines = renderPanel({ session, footer: { cost: 0.127 } }, width, options);
	const start = lines.findIndex((line) => plain(line).startsWith("╭─ session"));
	const end = lines.findIndex((line, index) => index > start && plain(line).startsWith("╰"));
	const box = lines.slice(start, end + 1);
	return raw ? box : box.map(plain);
};
/** A row's cells as `<color letter><glyph>` pairs for the meter glyphs ━ ─ ┼; "?" for any other color. */
const meterCells = (line: string) => {
	const letters: [readonly number[], string][] = [[palette.teal, "T"], [palette.amber, "A"], [palette.red, "R"], [palette.faint, "f"]];
	const cells: string[] = [];
	let color = "?";
	for (const match of line.matchAll(/\[38;2;(\d+);(\d+);(\d+)m|\[[0-?]*[ -/]*[@-~]|([━─┼])/g)) {
		if (match[1]) color = letters.find(([rgb]) => rgb.join(";") === `${match[1]};${match[2]};${match[3]}`)?.[1] ?? "?";
		else if (match[4]) cells.push(color + match[4]);
	}
	return cells.join("");
};
const cellRun = (letter: string, count: number, glyph = "━") => `${letter}${glyph}`.repeat(count);
/** The raw row of `box` whose plain text starts with `start`. */
const sessionRow = (box: string[], start: string) => box.find((line) => plain(line).startsWith(start))!;

const ARTBOARD: Record<string, string[]> = {
	"a@55": [
		"╭─ session ───────────────────────────────────────────╮",
		"│ project  fisi-dock  main                            │",
		"│ context  ━───────────────┼──────┼──── 5% · 53.5k/1M │",
		"│ profile  claude                              $0.127 │",
		"│ memory   ● engram  connected · 3 saved              │",
		"│ mcp      none configured                            │",
		"╰─────────────────────────────────────────────────────╯",
	],
	"b@55": [
		"╭─ session ───────────────────────────────────────────╮",
		"│ project  fisi-dock  main ↑2                         │",
		"│ context  ━───────────────┼──────┼──── 5% · 53.5k/1M │",
		"│ profile  claude                              $0.127 │",
		"│ memory   ● engram    connected · 3 saved            │",
		"│ mcp      ● context7  connected                      │",
		"│          ◌ github    connecting                     │",
		"│          ✗ sentry    failed                         │",
		"╰─────────────────────────────────────────────────────╯",
	],
	"c@55": [
		"╭─ session ───────────────────────────────────────────╮",
		"│ project  fisi-dock  main                            │",
		"│ context  ━───────────────┼──────┼──── 5% · 53.5k/1M │",
		"│ profile  claude                              $0.127 │",
		"│ memory   ✗ engram  unreachable                      │",
		"│ mcp      none configured                            │",
		"╰─────────────────────────────────────────────────────╯",
	],
	"d@55": [
		"╭─ session ───────────────────────────────────────────╮",
		"│ project  fisi-dock  main                            │",
		"│ context  ━━━━━━━━━━━━━━━━━━━━━━━━──── 87% · 870k/1M │",
		"│ profile  claude                              $0.127 │",
		"│ memory   ● engram  connected · 3 saved              │",
		"│ mcp      none configured                            │",
		"╰─────────────────────────────────────────────────────╯",
	],
	"e@55": [
		"╭─ session ───────────────────────────────────────────╮",
		"│ project  fisi-dock  main                            │",
		"│ context  ━───────────────┼──────┼──── 5% · 53.5k/1M │",
		"│ profile  claude                              $0.127 │",
		"│ memory   ○ engram  not installed                    │",
		"│ mcp      none configured                            │",
		"╰─────────────────────────────────────────────────────╯",
	],
	"a@47": [
		"╭─ session ───────────────────────────────────╮",
		"│ project  fisi-dock  main                    │",
		"│ context  ━───────────┼────┼── 5% · 53.5k/1M │",
		"│ profile  claude                      $0.127 │",
		"│ memory   ● engram  connected · 3 saved      │",
		"│ mcp      none configured                    │",
		"╰─────────────────────────────────────────────╯",
	],
	"b@47": [
		"╭─ session ───────────────────────────────────╮",
		"│ project  fisi-dock  main ↑2                 │",
		"│ context  ━───────────┼────┼── 5% · 53.5k/1M │",
		"│ profile  claude                      $0.127 │",
		"│ memory   ● engram    connected · 3 saved    │",
		"│ mcp      ● context7  connected              │",
		"│          ◌ github    connecting             │",
		"│          ✗ sentry    failed                 │",
		"╰─────────────────────────────────────────────╯",
	],
	"c@47": [
		"╭─ session ───────────────────────────────────╮",
		"│ project  fisi-dock  main                    │",
		"│ context  ━───────────┼────┼── 5% · 53.5k/1M │",
		"│ profile  claude                      $0.127 │",
		"│ memory   ✗ engram  unreachable              │",
		"│ mcp      none configured                    │",
		"╰─────────────────────────────────────────────╯",
	],
	"d@47": [
		"╭─ session ───────────────────────────────────╮",
		"│ project  fisi-dock  main                    │",
		"│ context  ━━━━━━━━━━━━━━━━━┼── 87% · 870k/1M │",
		"│ profile  claude                      $0.127 │",
		"│ memory   ● engram  connected · 3 saved      │",
		"│ mcp      none configured                    │",
		"╰─────────────────────────────────────────────╯",
	],
	"e@47": [
		"╭─ session ───────────────────────────────────╮",
		"│ project  fisi-dock  main                    │",
		"│ context  ━───────────┼────┼── 5% · 53.5k/1M │",
		"│ profile  claude                      $0.127 │",
		"│ memory   ○ engram  not installed            │",
		"│ mcp      none configured                    │",
		"╰─────────────────────────────────────────────╯",
	],
	"a@34": [
		"╭─ session ──────────────────────╮",
		"│ project  fisi-dock  main       │",
		"│ context  ━───────────┼────┼─── │",
		"│                  5% · 53.5k/1M │",
		"│ profile  claude         $0.127 │",
		"│ memory   ● engram  connected   │",
		"│ mcp      none configured       │",
		"╰────────────────────────────────╯",
	],
	"b@34": [
		"╭─ session ──────────────────────╮",
		"│ project  fisi-dock  main ↑2    │",
		"│ context  ━───────────┼────┼─── │",
		"│                  5% · 53.5k/1M │",
		"│ profile  claude         $0.127 │",
		"│ memory   ● engram   connected  │",
		"│ mcp      ● context7 connected  │",
		"│          ◌ github   connecting │",
		"│          ✗ sentry   failed     │",
		"╰────────────────────────────────╯",
	],
	"c@34": [
		"╭─ session ──────────────────────╮",
		"│ project  fisi-dock  main       │",
		"│ context  ━───────────┼────┼─── │",
		"│                  5% · 53.5k/1M │",
		"│ profile  claude         $0.127 │",
		"│ memory   ✗ engram  unreachable │",
		"│ mcp      none configured       │",
		"╰────────────────────────────────╯",
	],
};

test("the grouped session section is artboard 02 at 55 and 47 columns, states (a) to (e), and at 34 columns for (a) to (c)", () => {
	for (const [key, expected] of Object.entries(ARTBOARD)) {
		const [state, width] = key.split("@");
		assert.deepEqual(sessionBox(ART_STATES[state], Number(width)), expected, key);
	}
});

test("no group label rows, no rule between the groups; keys muted in one column (artboard 02, sidebar-chrome 02)", () => {
	const box = sessionBox(ART_STATES.b, 47, true);
	assert.ok(!box.some((line) => /^ (where|usage|connections)\b|^ ─+ *$/.test(plain(line).slice(1, -1))), "no label rows, stubs or rules inside the box");
	assert.deepEqual(box.slice(1, -1).map((line) => plain(line).slice(1).trim().split(/ +/)[0]), ["project", "context", "profile", "memory", "mcp", "◌", "✗"], "the groups follow each other directly");
	for (const key of ["project  ", "context  ", "profile  ", "memory   ", "mcp      "]) assert.ok(sessionRow(box, `│ ${key.trim()}`).includes(`${fgCode(palette.muted)}${key}`), `${key.trim()} key muted`);
	const where = sessionRow(box, "│ project");
	assert.ok(where.includes(`\x1b[1m${fgCode(palette.text)}fisi-dock`), "project bold");
	assert.ok(where.includes(`${fgCode(palette.green)}main ↑2`), "branch and ↑N green");
	const unpushed = renderPanel({ session: ART_STATES.b, headsUp: [{ kind: "unpushed", text: "2 commits not pushed" }] }, 47).map(plain);
	assert.match(sectionBody(unpushed, "session")[0], /^│ project  fisi-dock  main +│$/, "the heads-up already says ↑N (S8)");
	assert.match(sectionBody(renderPanel({ session: { ...ART_SESSION, branch: undefined } }, 47), "session")[0], /^│ project  fisi-dock +│$/, "no branch, no gap");
});

test("context meter: filled ━ in the state color, empty thin faint ─ with faint ┼ on the 60% and 85% cells; the readout bold percent, muted ·, tokens (artboard 02)", () => {
	const row = (percent: number, used = 53_500) => sessionRow(sessionBox({ ...ART_SESSION, contextPercent: percent, tokensUsed: used }, 47, true), "│ context");
	const empty = (from: number) => cellRun("f", 12 - from, "─") + cellRun("f", 1, "┼") + cellRun("f", 4, "─") + cellRun("f", 1, "┼") + cellRun("f", 2, "─");
	assert.equal(meterCells(row(5)), cellRun("T", 1) + empty(1));
	assert.equal(meterCells(row(16, 870_000)), cellRun("T", 3) + empty(3), "a readout of 13 columns leaves 20 cells");
	assert.equal(meterCells(row(0)), empty(0));
	assert.equal(meterCells(row(65, 870_000)), cellRun("A", 13) + cellRun("f", 4, "─") + cellRun("f", 1, "┼") + cellRun("f", 2, "─"), "amber from 60%, the passed mark filled");
	assert.equal(meterCells(row(87, 870_000)), cellRun("R", 17) + cellRun("f", 1, "┼") + cellRun("f", 2, "─"), "(d) 87%: red");
	assert.equal(meterCells(row(100, 1_000_000)), cellRun("R", 20));
	for (const [percent, color] of [[5, palette.teal], [65, palette.amber], [87, palette.red]] as const) {
		const line = row(percent);
		assert.ok(line.includes(`\x1b[1m${fgCode(color)}${percent}%`), `${percent}% bold in its color`);
		assert.ok(line.includes(`${fgCode(palette.muted)} · `), "muted ·");
		assert.ok(line.includes(`${fgCode(palette.text)}53.5k/1M`), "tokens in the text color");
	}
	assert.match(plain(row(87, 870_000)), /^│ context  ━{17}┼── 87% · 870k\/1M │$/);
	assert.match(plain(row(16)), /^│ context  [━─┼]{19} 16% · 53\.5k\/1M │$/, "a wider readout takes its columns from the bar, never past the frame");
});

test("the readout shares the meter row while the bar keeps 16 cells, else it moves right-aligned under the bar (artboard 02, 34 columns)", () => {
	const body = (width: number) => sectionBody(renderPanel({ session: ART_SESSION }, width), "session");
	assert.match(body(43).find((line) => line.startsWith("│ context"))!, /^│ context  [━─┼]{16} 5% · 53\.5k\/1M │$/, "16 cells: one row");
	const narrow = body(42);
	const at = narrow.findIndex((line) => line.startsWith("│ context"));
	assert.match(narrow[at], /^│ context  [━─┼]{29} │$/, "15 cells would be too short: the bar takes the row");
	assert.match(narrow[at + 1], /^│ +5% · 53\.5k\/1M │$/, "the readout under it, flush right");
	const plainPercent = sectionBody(renderPanel({ session: { project: "p", contextPercent: 42 } }, 47), "session").find((line) => line.startsWith("│ context"))!;
	assert.match(plainPercent, /^│ context  [━─┼]{20} +42% used │$/, "no token counts: the percent and a muted used");
	for (const width of [58, 55, 47, 43, 42, 34, 30, 20, 14, 12]) {
		const lines = renderPanel({ session: { ...ART_SESSION, contextPercent: 42, tokensUsed: 199_999, tokensMax: 200_000 } }, width);
		for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
	}
});

test("memory row: ● engram connected green with a muted · N saved, ✗ unreachable red, ○ not installed muted; the saved count drops first (artboard 02)", () => {
	const memory = (info: NonNullable<PanelModel["session"]["memory"]>, width = 47) => sessionRow(sessionBox({ ...ART_SESSION, memory: info }, width, true), "│ memory");
	const connected = memory({ state: "connected", saved: 0 });
	assert.match(plain(connected), /^│ memory   ● engram  connected · 0 saved +│$/, "0 saves still say so");
	assert.ok(connected.includes(`${fgCode(palette.green)}●`) && connected.includes(`${fgCode(palette.green)}connected`), "green glyph and word");
	assert.ok(connected.includes(`${fgCode(palette.text)}engram`), "name in the text color");
	assert.ok(connected.includes(`${fgCode(palette.muted)} · 0 saved`), "muted saved count");
	const unreachable = memory({ state: "unreachable" });
	assert.match(plain(unreachable), /^│ memory   ✗ engram  unreachable +│$/);
	assert.ok(unreachable.includes(`${fgCode(palette.red)}✗`) && unreachable.includes(`${fgCode(palette.red)}unreachable`), "red glyph and word");
	const missing = memory({ state: "missing" });
	assert.match(plain(missing), /^│ memory   ○ engram  not installed +│$/);
	assert.ok(missing.includes(`${fgCode(palette.faint)}○`), "faint ○");
	assert.ok(missing.includes(`${fgCode(palette.muted)}engram`) && missing.includes(`${fgCode(palette.muted)}not installed`), "muted name and words");
	assert.match(plain(memory({ state: "connected", saved: 12 }, 34)), /^│ memory   ● engram  connected +│$/, "34 columns: the count drops before the words");
	assert.ok(!sectionBody(renderPanel({ session: { project: "p" } }, 47), "session").some((line) => line.includes("memory")), "unknown: no memory row");
});

test("mcp rows: `none configured` muted without a server; one row per server with ● connected, ◌ connecting (unknown), ✗ failed; names and words in columns (artboard 02)", () => {
	const none = sessionBox({ project: "p", mcp: [] }, 47, true);
	const row = sessionRow(none, "│ mcp");
	assert.match(plain(row), /^│ mcp      none configured +│$/);
	assert.ok(row.includes(`${fgCode(palette.muted)}none configured`), "muted");
	assert.ok(!sessionBox({ project: "p" }, 47).some((line) => line.includes("mcp")), "not read yet: no mcp row");
	const box = sessionBox(ART_STATES.b, 47, true);
	const servers = box.filter((line) => /^│ (mcp {6}| {9})[●◌✗]/.test(plain(line)));
	assert.deepEqual(servers.map(plain), ["│ mcp      ● context7  connected              │", "│          ◌ github    connecting             │", "│          ✗ sentry    failed                 │"]);
	assert.ok(servers[0].includes(`${fgCode(palette.green)}●`) && servers[0].includes(`${fgCode(palette.green)}connected`), "connected green");
	assert.ok(servers[1].includes(`${fgCode(palette.amber)}◌`) && servers[1].includes(`${fgCode(palette.amber)}connecting`), "connecting amber");
	assert.ok(servers[2].includes(`${fgCode(palette.red)}✗`) && servers[2].includes(`${fgCode(palette.red)}failed`), "failed red");
	const alone = sectionBody(renderPanel({ session: { project: "p", mcp: [{ name: "rea", state: "connected" }] } }, 47), "session");
	assert.match(alone.at(-1)!, /^│ mcp      ● rea  connected +│$/, "without a memory row the names are the servers' own column");
	const long = sectionBody(renderPanel({ session: { project: "p", mcp: [{ name: "a-server-name-far-too-long-for-the-row", state: "connected" }, { name: "rea", state: "failing" }] } }, 47), "session");
	assert.deepEqual(long.slice(-2), ["│ mcp      ● a-server-na…  connected          │", "│          ✗ rea           failed             │"], "a long name is cut so the words keep their column");
	for (const width of [58, 47, 34, 30, 20, 12, 5, 1]) for (const line of renderPanel({ session: ART_STATES.b }, width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
});

/** Servers named by `states`: c connected, u unknown (connecting), f failing; `s01`, `s02`, … in that config order. */
const mcpServers = (states: string) => [...states].map((letter, index) => ({ name: `s${String(index + 1).padStart(2, "0")}`, state: ({ c: "connected", u: "unknown", f: "failing" } as const)[letter as "c" | "u" | "f"] }));
/** The plain mcp rows of the session box (the server rows and the summary under them), trailing padding cut. */
const mcpRows = (session: PanelModel["session"], width: number) => {
	const box = sessionBox(session, width);
	const start = box.findIndex((line) => line.startsWith("│ mcp"));
	return box.slice(start, -1).map((line) => line.replace(/ +│$/, ""));
};
/** 3 failed, 2 connecting and 5 connected, mixed in config order. */
const TEN = "cfucfcufcc";

test("many MCP servers: at most 4 mcp rows, failed then connecting then connected in config order, the last a `+N more` summary of the rest (S5)", () => {
	assert.deepEqual(mcpRows({ ...ART_SESSION, mcp: mcpServers(TEN) }, 47), ["│ mcp      ✗ s02     failed", "│          ✗ s05     failed", "│          ✗ s08     failed", "│            +7 more · 2 connecting"], "47: the connected count does not fit and drops");
	assert.deepEqual(mcpRows({ ...ART_SESSION, mcp: mcpServers(TEN) }, 55), ["│ mcp      ✗ s02     failed", "│          ✗ s05     failed", "│          ✗ s08     failed", "│            +7 more · 2 connecting · 5 connected"]);
	assert.deepEqual(mcpRows({ project: "p", mcp: mcpServers("cucucu") }, 47), ["│ mcp      ◌ s02  connecting", "│          ◌ s04  connecting", "│          ◌ s06  connecting", "│            +3 more · 3 connected"], "connecting before connected, in config order");
	assert.deepEqual(mcpRows({ project: "p", mcp: mcpServers("cfucu") }, 47), ["│ mcp      ✗ s02  failed", "│          ◌ s03  connecting", "│          ◌ s05  connecting", "│            +2 more · 2 connected"], "5 servers: 3 rows and +2 more");
	assert.deepEqual(mcpRows({ project: "p", mcp: mcpServers("ffffcf") }, 47), ["│ mcp      ✗ s01  failed", "│          ✗ s02  failed", "│          ✗ s03  failed", "│            +3 more · 2 failed · 1 connected"], "more failed servers than rows: the summary counts them first");
	assert.deepEqual(mcpRows({ project: "p", mcp: mcpServers("cccccccccc") }, 47), ["│ mcp      ● s01  connected", "│          ● s02  connected", "│          ● s03  connected", "│            +7 more · 7 connected"], "all connected: config order");
	const raw = sessionBox({ ...ART_SESSION, mcp: mcpServers(TEN) }, 55, true);
	const summary = raw.find((line) => plain(line).includes("+7 more"))!;
	assert.ok(summary.includes(`${fgCode(palette.muted)}+7 more`), "+N more muted");
	assert.ok(summary.includes(`${fgCode(palette.muted)} · `), "muted ·");
	assert.ok(summary.includes(`${fgCode(palette.amber)}2 connecting`), "connecting amber");
	assert.ok(summary.includes(`${fgCode(palette.green)}5 connected`), "connected green");
	assert.ok(sessionBox({ project: "p", mcp: mcpServers("ffffcf") }, 47, true).some((line) => line.includes(`${fgCode(palette.red)}2 failed`)), "failed red");
});

test("4 MCP servers or fewer: every one has its row, in config order, no summary (S5)", () => {
	assert.deepEqual(mcpRows({ project: "p", mcp: mcpServers("cufc") }, 47), ["│ mcp      ● s01  connected", "│          ◌ s02  connecting", "│          ✗ s03  failed", "│          ● s04  connected"]);
	assert.deepEqual(mcpRows({ project: "p", mcp: mcpServers("cf") }, 47), ["│ mcp      ● s01  connected", "│          ✗ s02  failed"]);
});

test("the MCP summary fits the rail: state counts drop from the right, then `+N more` alone, then it is cut (S5, 34 columns)", () => {
	assert.deepEqual(mcpRows({ ...ART_SESSION, mcp: mcpServers(TEN) }, 34), ["│ mcp      ✗ s02     failed", "│          ✗ s05     failed", "│          ✗ s08     failed", "│            +7 more"]);
	assert.equal(mcpRows({ project: "p", mcp: mcpServers("fffcuc") }, 51).at(-1), "│            +3 more · 1 connecting · 2 connected", "51: both counts just fit");
	assert.equal(mcpRows({ project: "p", mcp: mcpServers("fffcuc") }, 50).at(-1), "│            +3 more · 1 connecting", "one column less: the last count drops");
	assert.match(mcpRows({ project: "p", mcp: mcpServers(TEN) }, 20).at(-1)!, /^│ {12}\+7 m…$/, "too narrow even for +N more: ellipsized");
	for (const width of [58, 55, 51, 50, 47, 34, 30, 20, 14, 12, 5, 1]) for (const line of renderPanel({ session: { ...ART_SESSION, mcp: mcpServers(TEN) } }, width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
});

test("/dock lists every MCP server in config order, no summary (S5)", () => {
	const lines = renderDock({ session: { ...ART_SESSION, mcp: mcpServers(TEN) } }, 49, 60).lines.map((line) => plain(line).trim());
	const servers = lines.filter((line) => /^│ (mcp {6}| {9})[●◌✗] s\d\d/.test(line)).map((line) => line.replace(/ +│$/, ""));
	assert.deepEqual(servers, [
		"│ mcp      ● s01     connected",
		"│          ✗ s02     failed",
		"│          ◌ s03     connecting",
		"│          ● s04     connected",
		"│          ✗ s05     failed",
		"│          ● s06     connected",
		"│          ◌ s07     connecting",
		"│          ✗ s08     failed",
		"│          ● s09     connected",
		"│          ● s10     connected",
	]);
	assert.ok(!lines.some((line) => line.includes("more")), "no summary");
});

test("short screens: the MCP summary is a session row like any other, so it stays when the panel is a row short (S5, S38)", () => {
	const model: PanelModel = { session: { ...ART_SESSION, mcp: mcpServers(TEN) } };
	const full = renderPanel(model, 47);
	const session = sectionBody(full, "session");
	assert.equal(session.filter((line) => /^│ (mcp {6}| {9}| {11})[✗+]/.test(line)).length, 4, "3 server rows and the summary");
	assert.deepEqual(renderPanel(model, 47, { maxRows: full.length }).map(plain), full.map(plain), "exactly enough rows: the full shape");
	const short = sectionBody(renderPanel(model, 47, { maxRows: full.length - 1 }), "session");
	assert.deepEqual(short, session.map(plain), "one row short: every session row stays (no group labels to drop)");
	assert.ok(short.at(-1)!.includes("+7 more"), "the summary stays");
});

test("the user's setup: fisi-dock on main, 5%, 53.5k/1M, claude, $0.127, engram connected with 0 saved, no MCP config", () => {
	const real = { ...ART_SESSION, memory: { state: "connected" as const, saved: 0 } };
	for (const width of [55, 47]) {
		const box = sessionBox(real, width);
		assert.deepEqual(box, ARTBOARD[`a@${width}`].map((line) => line.replace("connected · 3 saved", "connected · 0 saved")), `${width}`);
		console.log(`--- the session section at ${width} columns, the user's setup\n${box.join("\n")}`);
	}
});

test("no label row with one group or several (sidebar-chrome 02)", () => {
	assert.deepEqual(sectionBody(renderPanel({ session: { project: "p", branch: "main" } }, 47), "session"), [`│ project  p  main${" ".repeat(27)} │`]);
	const two = sectionBody(renderPanel({ session: { project: "p" }, footer: { cost: 0.012 } }, 47), "session").map((line) => line.replace(/ +│$/, ""));
	assert.deepEqual(two, ["│ project  p", "│ cost     $0.012"]);
});

test("short screens: with no group labels the spacer rows drop first and every session row stays (sidebar-chrome 02, S34)", () => {
	const model: PanelModel = { session: ART_STATES.b, footer: { cost: 0.127 }, odd: samplePanelModel.odd, changes: samplePanelModel.changes };
	const full = renderPanel(model, 47).map(plain);
	const labels = (lines: string[]) => lines.filter((line) => /^│ (where|usage|connections) ──/.test(line));
	assert.deepEqual(labels(full), []);
	const spacers = full.filter(isSpacer).length;
	assert.ok(spacers > 0, "the ODD spacers");
	const noSpacers = renderPanel(model, 47, { maxRows: full.length - 1 }).map(plain);
	assert.equal(noSpacers.length, full.length - spacers, "the spacer rows, nothing else");
	assert.ok(!noSpacers.some(isSpacer), "the spacers go first");
	assert.deepEqual(sectionBody(noSpacers, "session"), sectionBody(full, "session"), "every session row stays");
	assert.deepEqual(renderPanel(model, 47, { maxRows: full.length }).map(plain), full, "it fits: spacers drawn");
	assert.deepEqual(labels(renderDock(model, DOCK_WIDTH + 2, 200).lines.map((line) => plain(line).slice(1, -1))), [], "/dock draws none either");
});

for (const total of [3, 7, 50]) {
	test(`todo body stays within 4 rows for ${total} tasks`, () => {
		const model = clone(samplePanelModel);
		model.todo = { done: 1, total, active: "Active task", next: "Next task", more: Math.max(0, total - 3) };
		const body = sectionBody(renderPanel(model, 47), "todo");
		assert.ok(body.length <= 4, `${body.length} rows`);
		assert.ok(body.some((line) => line.includes("Active task")));
	});
}

test("todo rows that do not apply are omitted", () => {
	const model = clone(samplePanelModel);
	model.todo = { done: 0, total: 2, active: "Only active", more: 0 };
	const body = sectionBody(renderPanel(model, 47), "todo");
	assert.equal(body.length, 1);
	assert.ok(body[0].includes("Only active"));
	const sample = sectionBody(renderPanel(samplePanelModel, 47), "todo");
	assert.equal(sample.length, 4);
	assert.match(sample[0], /^│ ✓ 3 done +▰+▱+ │$/);
	assert.match(sample[1], /^│▎⠹ Confirm CI is green +│$/);
	assert.match(sample[2], /^│ ○ Commit workflow fix +│$/);
	assert.match(sample[3], /^│ {3}\+2 more +\/dock all │$/);
});

test("the side panel's +N more row points to /dock, never to ctrl+t (S26)", () => {
	for (const model of [samplePanelModel, longModel]) {
		const lines = renderPanel(model, 47);
		assert.ok(!lines.some((line) => plain(line).includes("ctrl+t")));
		const more = lines.find((line) => plain(line).includes("more") && plain(line).includes("/dock all"))!;
		// Same style as before: the key in plain text, " all" muted.
		assert.ok(more.includes(`${fgCode(palette.text)}/dock`), "key in plain text");
		assert.ok(more.includes(`${fgCode(palette.muted)} all`), "muted all");
	}
});

const eightTasks: PanelModel = {
	session: { project: "p" },
	todo: {
		done: 7,
		total: 8,
		active: "Eighth task: write the release notes",
		more: 0,
		tasks: [
			...Array.from({ length: 7 }, (_, index) => ({ title: `Done task ${index + 1}`, state: "done" as const })),
			{ title: "Eighth task: write the release notes", state: "active" as const },
		],
	},
};

test("the todo card is the side panel's todo section at any width: same rows, styling and geometry; only the frame color differs (S28, S7, sidebar-chrome 02)", () => {
	for (const width of [55, 47]) {
		const lines = renderPanel(samplePanelModel, width);
		const start = lines.findIndex((line) => plain(line).startsWith("╭─ todo"));
		const end = lines.findIndex((line, index) => index > start && plain(line).startsWith("╰"));
		const card = renderTodoCard(samplePanelModel.todo, width);
		assert.deepEqual(card.map(frameless), lines.slice(start, end + 1).map(frameless), `${width}: byte-identical to the panel but for the frame color`);
		assert.notDeepEqual(card, lines.slice(start, end + 1), `${width}: the rail's frame fades, the card's stays flat`);
	}
	const card = renderTodoCard(samplePanelModel.todo, 64).map(plain);
	assert.match(card[0], /^╭─ todo ─+ 3\/7 ─╮$/);
	assert.match(card[1], /^│ ✓ 3 done +▰+▱+ │$/);
	assert.match(card[2], /^│▎⠹ Confirm CI is green +│$/);
	assert.match(card[3], /^│ ○ Commit workflow fix +│$/);
	assert.match(card[4], /^│ {3}\+2 more +\/dock all │$/);
	assert.match(card[5], /^╰─+╯$/);
	assert.equal(card.length, 6);
	for (const width of [64, 53, 40, 12, 1]) for (const line of renderTodoCard(samplePanelModel.todo, width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
	for (const width of [64, 53, 40]) for (const line of renderTodoCard(samplePanelModel.todo, width)) assert.equal(visibleWidth(line), width, "framed to the full width");
});

test("the todo card stays compact with a full task list and is empty without a todo (S28, S7)", () => {
	assert.deepEqual(renderTodoCard(eightTasks.todo, 53), renderTodoCard({ ...eightTasks.todo!, tasks: undefined }, 53));
	assert.equal(renderTodoCard(eightTasks.todo, 53).length, 4, "done row and active row between the borders");
	assert.deepEqual(renderTodoCard(undefined, 64), []);
	assert.deepEqual(renderTodoCard({ done: 0, total: 0, more: 0 }, 64), []);
	assert.deepEqual(renderTodoCard(samplePanelModel.todo, 0), []);
});

const mixedTasks: PanelModel = {
	session: { project: "p" },
	todo: {
		done: 1,
		total: 5,
		active: "Running now",
		next: "Waiting in line",
		more: 1,
		tasks: [
			{ title: "Finished first", state: "done" },
			{ title: "Running now", state: "active" },
			{ title: "Waiting in line", state: "pending" },
			{ title: "Needs an admin", state: "blocked" },
			{ title: "No longer needed", state: "dropped" },
		],
	},
};

type TaskState = "done" | "active" | "pending" | "blocked" | "dropped";

/** A todo of `states.length` tasks titled `Task N`, the counts derived from the states. */
function todoOf(states: TaskState[]): PanelModel {
	const tasks = states.map((state, index) => ({ title: `Task ${index}`, state }));
	const active = tasks.find((task) => task.state === "active")?.title;
	const next = tasks.find((task) => task.state === "pending")?.title;
	const open = tasks.filter((task) => task.state !== "done" && task.state !== "dropped").length;
	const shown = (active ? 1 : 0) + (next ? 1 : 0);
	const done = tasks.filter((task) => task.state === "done").length;
	return { session: { project: "p" }, spinner: 2, todo: { done, total: tasks.length, ...(active ? { active } : {}), ...(next ? { next } : {}), more: Math.max(0, open - shown), tasks } };
}

const statesAt = (total: number, active: number): TaskState[] =>
	Array.from({ length: total }, (_, index) => (index < active ? "done" : index === active ? "active" : "pending"));

const railTodo = (model: PanelModel, width = 47) => sectionBody(renderPanel(model, width), "todo");
const rawRailTodo = (model: PanelModel, width = 47) => {
	const lines = renderPanel(model, width);
	const start = lines.findIndex((line) => plain(line).startsWith("╭─ todo"));
	const end = lines.findIndex((line, index) => index > start && plain(line).startsWith("╰"));
	return lines.slice(start + 1, end);
};

test("the rail lists every task while they fit 8 rows, same rows as /dock, no summary row (S58)", () => {
	for (const model of [todoOf(statesAt(4, 1)), mixedTasks, eightTasks]) {
		const dock = renderPanel(model, 47, { todoExpanded: true });
		const rail = rawRailTodo(model);
		assert.equal(rail.length, model.todo!.tasks!.length, "one row per task");
		const start = dock.findIndex((line) => plain(line).startsWith("╭─ todo"));
		assert.deepEqual(rail, dock.slice(start + 1, start + 1 + rail.length), "byte-identical to the /dock rows");
		assert.ok(!rail.some((line) => /[▰▱]/.test(line) || /\d+ done|more|\/dock all/.test(plain(line))), "no summary, bar or more row in the rows");
	}
	const four = railTodo(todoOf(statesAt(4, 1)));
	for (const [index, pattern] of [/^│ ✓ Task 0 +│$/, /^│▎⠹ Task 1 +│$/, /^│ ○ Task 2 +│$/, /^│ ○ Task 3 +│$/].entries()) assert.match(four[index], pattern);
	assert.equal(railTodo(todoOf(statesAt(8, 6))).length, 8, "8 tasks: 8 rows");
	assert.match(renderPanel(todoOf(statesAt(4, 1)), 47).map(plain).find((line) => line.startsWith("╭─ todo"))!, /─ ▰▱▱▱ 1\/4 ─╮$/, "title right: bar and done/total");
});

test("past 8 tasks the rail shows a window: earlier done, 7 tasks from the last done one, +N more (S58)", () => {
	const body = railTodo(todoOf(statesAt(12, 5)));
	assert.deepEqual(body.slice(0, 8).map((line) => line.replace(/ +│$/, " │")), [
		"│ ✓ 4 earlier done │",
		"│ ✓ Task 4 │",
		"│▎⠹ Task 5 │",
		"│ ○ Task 6 │",
		"│ ○ Task 7 │",
		"│ ○ Task 8 │",
		"│ ○ Task 9 │",
		"│ ○ Task 10 │",
	]);
	assert.equal(body.length, 9);
	assert.match(body[8], /^│ {3}\+1 more +\/dock all │$/);
	const raw = rawRailTodo(todoOf(statesAt(12, 5)));
	assert.ok(raw[0].includes(`${fgCode(palette.green)}✓`), "green check");
	assert.ok(raw[0].includes(`${fgCode(palette.muted)}4 earlier done`), "muted count");
	assert.ok(raw[8].includes(`${fgCode(palette.muted)}+1 more`) && raw[8].includes(`${fgCode(palette.text)}/dock`), "the existing more row look");
	assert.match(renderPanel(todoOf(statesAt(12, 5)), 47).map(plain).find((line) => line.startsWith("╭─ todo"))!, /─ ▰▰▰▰▱▱▱▱▱▱ 5\/12 ─╮$/);
});

test("the rail window clamps at the end of the list and starts at the top for an early active task (S58)", () => {
	const end = railTodo(todoOf(statesAt(12, 11)));
	assert.equal(end.length, 8, "earlier row and 7 tasks, nothing after");
	assert.match(end[0], /^│ ✓ 5 earlier done +│$/);
	assert.match(end[1], /^│ ✓ Task 5 +│$/);
	assert.match(end[7], /^│▎⠹ Task 11 +│$/);
	const top = railTodo(todoOf(statesAt(12, 0)));
	assert.equal(top.length, 8, "7 tasks and the more row, no earlier row");
	assert.match(top[0], /^│▎⠹ Task 0 +│$/);
	assert.match(top[6], /^│ ○ Task 6 +│$/);
	assert.match(top[7], /^│ {3}\+5 more +\/dock all │$/);
	const second = railTodo(todoOf(statesAt(9, 1)));
	assert.match(second[0], /^│ ✓ Task 0 +│$/, "one done task before the active one, nothing hidden");
	assert.match(second[7], /^│ {3}\+2 more +\/dock all │$/);
});

test("the rail window without an active task anchors on the first open task, else the last task (S58)", () => {
	const states: TaskState[] = [...Array<TaskState>(6).fill("done"), "blocked", ...Array<TaskState>(5).fill("pending")];
	const open = railTodo(todoOf(states));
	assert.match(open[0], /^│ ✓ 5 earlier done +│$/);
	assert.match(open[1], /^│ ✓ Task 5 +│$/);
	assert.match(open[2], /^│ ◌ Task 6 +│$/);
	assert.match(open[7], /^│ ○ Task 11 +│$/);
	assert.equal(open.length, 8, "window reaches the end: no more row");
	const finished = railTodo(todoOf(Array<TaskState>(10).fill("done")));
	assert.match(finished[0], /^│ ✓ 3 earlier done +│$/);
	assert.match(finished[7], /^│ ✓ Task 9 +│$/);
	assert.equal(finished.length, 8);
	const mixed = railTodo(todoOf(["done", "dropped", "done", "done", "done", "active", "pending", "pending", "pending", "pending", "pending", "pending"]));
	assert.match(mixed[0], /^│ ✓ 4 earlier +│$/, "a dropped task among them: not all done");
});

for (const width of [47, 30, 20]) {
	test(`the rail todo list and window fit ${width} columns (S58)`, () => {
		for (const model of [todoOf(statesAt(4, 1)), todoOf(statesAt(12, 5)), mixedTasks]) {
			const lines = renderPanel(model, width);
			for (const line of lines) assert.equal(visibleWidth(line) <= width, true, `${width}: ${plain(line)}`);
			assert.ok(railTodo(model, width).some((line) => line.startsWith("│▎")), "active row highlighted");
		}
	});
}

test("the rail's active task keeps the highlight, the spinner frame and the entrance (S58, S54)", () => {
	const model = todoOf(statesAt(12, 5));
	const dock = renderPanel(model, 47, { todoExpanded: true });
	const active = (lines: string[]) => lines.find((line) => plain(line).includes("Task 5"))!;
	assert.equal(frameless(active(renderPanel(model, 47))), frameless(active(dock)), "same row as /dock but for the side fade, which follows each box's height");
	assert.ok(plain(active(renderPanel(model, 47))).includes("▎⠹ Task 5"), "spinner frame 2");
	const entering = clone(model);
	entering.todo!.entrance = 0;
	assert.notEqual(active(renderPanel(entering, 47)), active(renderPanel(model, 47)), "entrance changes the row");
	assert.equal(frameless(active(renderPanel(entering, 47))), frameless(active(renderPanel(entering, 47, { todoExpanded: true }))));
});

test("the rail without a task list keeps the summary rows (S58, S7)", () => {
	for (const model of [eightTasks, mixedTasks, todoOf(statesAt(12, 5))]) {
		const bare = clone(model);
		delete bare.todo!.tasks;
		const body = railTodo(bare);
		assert.ok(body.length <= 4, `${body.length} rows`);
		assert.ok(!body.some((line) => line.includes("earlier")));
	}
	assert.match(railTodo(samplePanelModel)[0], /^│ ✓ 3 done +▰+▱+ │$/);
});

const dockTodo = (model: PanelModel, width = DOCK_WIDTH + 2) => sectionBody(renderDock(model, width, 200).lines.map((line) => plain(line).slice(1, -1)), "todo");

test("/dock lists every todo task in order, done ones with ✓ and the active one highlighted (S26)", () => {
	const body = dockTodo(eightTasks);
	assert.equal(body.length, 8);
	body.slice(0, 7).forEach((line, index) => assert.match(line, new RegExp(`^│ ✓ Done task ${index + 1} +│$`)));
	assert.match(body[7], /^│▎⠹ Eighth task: write the release notes +│$/);
	assert.ok(!body.some((line) => line.includes("more") || line.includes("/dock all")));
	const lines = renderDock(eightTasks, DOCK_WIDTH + 4, 200).lines;
	const active = lines.find((line) => plain(line).includes("Eighth task"))!;
	assert.ok(active.includes(bgCode(palette.highlight)), "active row highlighted as in the rail");
	assert.ok(active.includes(`${fgCode(palette.pink)}⠹`), "pink spinner");
	const done = lines.find((line) => plain(line).includes("Done task 1"))!;
	assert.ok(done.includes(`${fgCode(palette.green)}✓`), "green check");
	assert.ok(plain(lines.find((line) => plain(line).includes("╭─ todo"))!).includes(" 7/8 ─╮"));
});

test("/dock shows pending, blocked and dropped tasks with their own glyphs (S26)", () => {
	const body = dockTodo(mixedTasks);
	assert.deepEqual(body.map((line) => line.replace(/ +│$/, "")), [
		"│ ✓ Finished first",
		"│▎⠹ Running now",
		"│ ○ Waiting in line",
		"│ ◌ Needs an admin",
		"│ - No longer needed",
	]);
	const lines = renderDock(mixedTasks, DOCK_WIDTH + 4, 200).lines;
	assert.ok(lines.find((line) => plain(line).includes("Needs an admin"))!.includes(`${fgCode(palette.amber)}◌`), "amber blocked glyph");
	assert.ok(lines.find((line) => plain(line).includes("No longer needed"))!.includes(`${fgCode(palette.muted)}No longer needed`), "dropped title muted");
});

test("/dock without a task list keeps the compact todo rows", () => {
	const bare = clone(eightTasks);
	delete bare.todo!.tasks;
	const side = sectionBody(renderPanel(bare, DOCK_WIDTH), "todo");
	assert.deepEqual(dockTodo(bare), side);
});

for (const width of [64, 53, 40]) {
	test(`/dock expanded todo fits ${width} columns, long titles cut with an ellipsis (S26)`, () => {
		const model = clone(mixedTasks);
		model.todo!.tasks![0].title = "A finished task whose title is far too long for any dock width at all";
		model.todo!.tasks![1].title = "An active task whose title is far too long for any dock width at all";
		const { lines } = renderDock(model, width, 200);
		for (const line of lines) assert.equal(visibleWidth(line), width, JSON.stringify(plain(line)));
		const body = dockTodo(model, width);
		assert.equal(body.length, 5);
		assert.ok(body[0].includes("…") && body[1].includes("…"));
	});
}

test("active rows carry the highlight background and pink bar", () => {
	const lines = renderPanel(samplePanelModel, 47);
	const active = lines.find((line) => plain(line).includes("Confirm CI is green"))!;
	assert.ok(active.includes("\x1b[48;2;38;38;38m"), "highlight background");
	assert.ok(active.includes("\x1b[1m"), "bold text");
	const checking = lines.find((line) => plain(line).includes("checking"))!;
	assert.ok(checking.includes("\x1b[48;2;38;38;38m"));
	assert.ok(plain(checking).startsWith("│▎⡿ checking"), "checking orb, still frame");
});

test("section titles are bold in 75% of the vivid version of their own color (vivid labels S2, L10)", () => {
	const lines = renderPanel(samplePanelModel, 47);
	const colors: Record<string, string> = { session: "66;223;240", todo: "248;106;75", ODD: "240;170;68", agents: "160;117;249", changes: "78;234;78" };
	for (const [title, rgb] of Object.entries(colors)) {
		const top = lines.find((line) => plain(line).startsWith(`╭─ ${title}`))!;
		assert.ok(top.includes(`\x1b[1m\x1b[38;2;${rgb}m${title}`), title);
	}
});

test("every rail section frame fades the same neutral way whatever its title color; the narrow cards keep the flat neutral gray; only titles keep their color (sidebar-chrome 02)", () => {
	const gray = fgCode(palette.frame);
	const model: PanelModel = { ...clone(samplePanelModel), headsUp: [{ kind: "unpushed", text: "1 commit not pushed" }] };
	const lines = renderPanel(model, 47);
	const titles = ["session", "heads-up", "todo", "ODD", "agents", "changes"];
	const neutral = (line: string) => [...line.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m[╭╮╰╯─│]/g)].every((match) => match[1] === match[2] && match[2] === match[3]);
	const bottoms: number[][] = [];
	for (const title of titles) {
		const start = lines.findIndex((line) => plain(line).startsWith(`╭─ ${title}`));
		assert.ok(start >= 0, title);
		const end = lines.findIndex((line, index) => index > start && plain(line).startsWith("╰"));
		const box = lines.slice(start, end + 1);
		assert.ok(box.every(neutral), `${title}: every frame glyph a neutral gray`);
		assert.ok(!box.some((line) => line.includes(`${gray}╭`) || line.includes(`${gray}│`) || line.includes(`${gray}╰`)), `${title}: no flat frame color`);
		const [topLeft] = frameLight(box[0], "╭");
		const [topRight] = frameLight(box[0], "╮");
		const bottom = frameLight(box.at(-1)!, "╰─╯");
		assert.ok(topLeft <= 0x18 && topRight <= 0x18 && bottom[0] <= 0x18 && bottom.at(-1)! <= 0x18, `${title}: corners in the background`);
		assert.deepEqual(bottom, [...bottom].reverse(), `${title}: bottom symmetric`);
		const left = box.slice(1, -1).map((line) => Number(/^\x1b\[38;2;(\d+);\d+;\d+m│/.exec(line)![1]));
		const right = box.slice(1, -1).map((line) => Number(/\x1b\[38;2;(\d+);\d+;\d+m│\x1b\[39m$/.exec(line)![1]));
		assert.deepEqual(left, [...left].reverse(), `${title}: sides symmetric`);
		assert.deepEqual(right, left, `${title}: both sides alike`);
		bottoms.push(bottom);
	}
	for (const bottom of bottoms) assert.deepEqual(bottom, bottoms[0], "the same fade on every section");
	const cards = [renderTodoCard(model.todo, 47), renderAgentsCard(model.agents, 47, 1, 0)];
	for (const card of cards) {
		assert.ok(card.length >= 3);
		assert.ok(card[0].startsWith(`${gray}╭─ `), `card top: ${JSON.stringify(card[0])}`);
		for (const line of card.slice(1, -1)) assert.ok(line.startsWith(`${gray}│`), "card side");
		assert.ok(card.at(-1)!.startsWith(`${gray}╰`), "card bottom");
	}
});

// S55 drew two context rows; artboard 02 puts the meter and its readout on one row (tests above).
test("context row: muted key, the meter, then the percent bold in its context color, a muted · and the tokens (S55, artboard 02)", () => {
	for (const [percent, color] of [[16, palette.teal], [65, palette.amber], [90, palette.red]] as const) {
		const lines = renderPanel({ session: { project: "p", contextPercent: percent, tokensUsed: 12_100, tokensMax: 200_000 } }, 47);
		const row = lines.find((line) => plain(line).startsWith("│ context"))!;
		assert.match(plain(row), new RegExp(`^│ context  [━─┼]{17} ${percent}% · 12\\.1k/200k │$`));
		assert.ok(row.includes(`${fgCode(palette.muted)}context`), `${percent}% key muted`);
		assert.ok(row.includes(`\x1b[1m${fgCode(color)}${percent}%\x1b[39m\x1b[22m`), `${percent}% bold in its color`);
		assert.ok(row.includes(`${fgCode(palette.text)}12.1k/200k`), `${percent}% tokens`);
	}
});

test("unknown context percent: no context rows (S55)", () => {
	const body = sectionBody(renderPanel({ session: { project: "p" } }, 47), "session").join("\n");
	assert.ok(!body.includes("context") && !body.includes("━"), body);
});

test("odd timeline keeps occurrence order with a repeated phase", () => {
	const body = sectionBody(renderPanel(samplePanelModel, 47), "ODD");
	const steps = body.filter((line) => !/^│ +│ +│$/.test(line));
	assert.deepEqual(steps.map((line) => line.replace(/^│[ ▎]/, "").replace(/ +│$/, "").replace(/ +/g, " ")), [
		"✓ exploring 0:31",
		"✓ implementing 1:12",
		"✓ exploring 0:20",
		"⡿ checking 0:42",
	]);
	assert.equal(body.length, 7, "connector rows between steps");
	assert.match(body[1], /^│ │ +│$/);
});

test("odd times use m:ss", () => {
	const model = clone(samplePanelModel);
	model.odd = { steps: [{ phase: "long", state: "done", seconds: 3725 }, { phase: "short", state: "active", seconds: 5 }] };
	const body = sectionBody(renderPanel(model, 47), "ODD").join("\n");
	assert.ok(body.includes("62:05"));
	assert.ok(body.includes("0:05"));
});

test("digest is stable and changes when a drawn value changes", () => {
	assert.equal(panelDigest(samplePanelModel), panelDigest(clone(samplePanelModel)));
	const edits: ((model: PanelModel) => void)[] = [
		(model) => (model.session.contextPercent = 7),
		(model) => (model.todo!.active = "Other"),
		(model) => (model.odd!.steps[3].seconds = 43),
		(model) => (model.agents![1].state = "done"),
		(model) => (model.changes![0].added = 2),
		(model) => (model.footer!.cost = 0.001),
	];
	for (const edit of edits) {
		const model = clone(samplePanelModel);
		edit(model);
		assert.notEqual(panelDigest(model), panelDigest(samplePanelModel));
	}
});

const manyAgents = Array.from({ length: 7 }, (_, index) => ({ name: `job-${index + 1}`, task: `Task number ${index + 1} with a long label`, state: "running" as const }));
const manyChanges = Array.from({ length: 9 }, (_, index) => ({ status: "M" as const, path: `src/some/deep/path/file-${index + 1}.ts`, added: index, removed: 1 }));

test("agents beyond 4 collapse into a +N more row", () => {
	const lines = renderPanel({ session: { project: "p" }, agents: manyAgents }, 47);
	const body = sectionBody(lines, "agents");
	assert.equal(body.length, 5);
	assert.ok(body[3].includes("job-4"));
	assert.match(body[4], /^│ {3}\+3 more +│$/);
});

test("exactly 4 agents draw no more row", () => {
	const body = sectionBody(renderPanel({ session: { project: "p" }, agents: manyAgents.slice(0, 4) }, 47), "agents");
	assert.equal(body.length, 4);
	assert.ok(!body.some((line) => line.includes("more")));
});

test("failed agents show a cross", () => {
	const body = sectionBody(renderPanel({ session: { project: "p" }, agents: [{ name: "job-3", task: "lint", state: "failed" }] }, 47), "agents");
	assert.match(body[0], /^│ ✗ job-3 lint +│$/);
});

test("changes beyond 4 files collapse into a muted +N more · /dock all row (S53)", () => {
	const raw = renderPanel({ session: { project: "p" }, changes: manyChanges }, 47);
	const body = sectionBody(raw, "changes");
	assert.equal(body.length, 5, "4 files, one row each, then more");
	assert.deepEqual(body.slice(0, 4).map((line) => /file-\d/.exec(line)![0]), ["file-9", "file-8", "file-7", "file-6"], "most changed first");
	assert.match(body[4], /^│ {3}\+5 more · \/dock all +│$/);
	assert.ok(raw.some((line) => line.includes(`${fgCode(palette.muted)}+5 more · /dock all`)), "muted more row");
	const four = sectionBody(renderPanel({ session: { project: "p" }, changes: manyChanges.slice(0, 4) }, 47), "changes");
	assert.equal(four.length, 4);
	assert.ok(!four.some((line) => line.includes("more")));
});

test("more rows fit every rail width", () => {
	for (const width of [47, 30, 20]) {
		for (const line of renderPanel({ session: { project: "p" }, agents: manyAgents, changes: manyChanges }, width)) {
			assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}: ${JSON.stringify(plain(line))}`);
		}
	}
});

test("session cost uses three decimals", () => {
	const footer = (cost: number) => renderPanel({ session: { project: "p" }, footer: { cost } }, 47).map(plain).find((line) => line.includes("cost"))!;
	assert.ok(footer(0.0123).includes("$0.012"));
	assert.ok(footer(1.5).includes("$1.500"));
	assert.ok(footer(Number.NaN).includes("$0.000"));
});

const manySteps = Array.from({ length: 9 }, (_, index) => ({
	phase: ["exploring", "implementing", "checking"][index % 3],
	state: (index === 8 ? "active" : "done") as "active" | "done",
	seconds: index * 61,
}));

test("odd draws at most 6 steps, the latest, after a +N earlier row", () => {
	const body = sectionBody(renderPanel({ session: { project: "p" }, odd: { steps: manySteps } }, 47), "ODD");
	assert.match(body[0], /^│ {3}\+3 earlier +│$/);
	const steps = body.filter((line) => /[✓●⡿]/.test(line));
	assert.equal(steps.length, 6);
	assert.match(steps[0], /✓ exploring +3:03 │$/);
	assert.match(steps[5], /⡿ checking +8:08 │$/, "checking orb, still frame");
	assert.equal(body.length, 1 + 6 + 6, "earlier row, 6 steps, a connector before each step");
});

test("odd adds the model's earlier count to the hidden steps", () => {
	const body = sectionBody(renderPanel({ session: { project: "p" }, odd: { steps: manySteps.slice(3), earlier: 3 } }, 47), "ODD");
	assert.match(body[0], /^│ {3}\+3 earlier +│$/);
	const fewer = sectionBody(renderPanel({ session: { project: "p" }, odd: { steps: manySteps.slice(0, 2), earlier: 4 } }, 47), "ODD");
	assert.match(fewer[0], /^│ {3}\+4 earlier +│$/);
	assert.equal(fewer.length, 1 + 2 + 2);
});

test("6 steps or fewer draw no earlier row", () => {
	const body = sectionBody(renderPanel({ session: { project: "p" }, odd: { steps: manySteps.slice(0, 6) } }, 47), "ODD");
	assert.ok(!body.some((line) => line.includes("earlier")));
	assert.equal(body.length, 6 + 5);
});

test("odd times of 10 minutes and more keep m:ss", () => {
	const body = sectionBody(renderPanel({ session: { project: "p" }, odd: { steps: [{ phase: "checking", state: "active", seconds: 600 }] } }, 47), "ODD").join("\n");
	assert.ok(body.includes("10:00"));
});

test("the earlier row fits every rail width", () => {
	for (const width of [47, 30, 20]) {
		for (const line of renderPanel({ session: { project: "p" }, odd: { steps: manySteps, earlier: 120 } }, width)) {
			assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}: ${JSON.stringify(plain(line))}`);
		}
	}
});

// --- phase orbs (S17, artboard 09) ----------------------------------------------

const oddRows = (model: PanelModel, width = 47) => sectionBody(renderPanel(model, width), "ODD").filter((line) => !/^│ +│ +│$/.test(line));
const rawOddRows = (model: PanelModel, width = 47) => {
	const lines = renderPanel(model, width);
	const start = lines.findIndex((line) => plain(line).startsWith("╭─ ODD"));
	const end = lines.findIndex((line, index) => index > start && plain(line).startsWith("╰"));
	return lines.slice(start + 1, end);
};

test("the active odd row shows its phase orb frame in the orb color; done rows keep ✓", () => {
	const model: PanelModel = { session: { project: "p" }, odd: { steps: [{ phase: "exploring", state: "done", seconds: 3 }, { phase: "checking", state: "active", seconds: 5, frame: 2 }] } };
	const rows = oddRows(model);
	assert.match(rows[0], /^│ ✓ exploring +0:03 │$/);
	assert.match(rows[1], /^│▎⣻ checking +0:05 │$/, "frame 2 of checking");
	const active = rawOddRows(model).find((line) => plain(line).includes("checking"))!;
	assert.ok(active.includes(`\x1b[38;2;${palette.amber.join(";")}m⣻`), "orb in the checking color");
	assert.ok(!active.includes(`${fgCode(palette.pink)}checking`), "the label is no longer pink (S49)");
	assert.ok(!rows.some((line) => line.includes("●")));
});

test("the active odd label is muted gray with a white shine at its scan step (S49)", () => {
	const activeRow = (scan?: number) =>
		rawOddRows({ session: { project: "p" }, odd: { steps: [{ phase: "exploring", state: "done", seconds: 3 }, { phase: "checking", state: "active", seconds: 5, frame: 2, scan }] } }).find((line) =>
			plain(line).includes("checking"),
		)!;
	const lit = activeRow(3);
	assert.match(plain(lit), /^│▎⣻ checking +0:05 │$/, "same visible row");
	assert.ok(lit.includes("\x1b[38;2;255;255;255mc"), "scan 3: the head is on the first letter");
	assert.ok(lit.includes(`${fgCode(palette.amber)}⣻`), "orb keeps the checking color");
	assert.ok(lit.includes(`${fgCode(palette.text)}0:05`), "time unchanged");
	assert.ok(!lit.includes(`${fgCode(palette.pink)}c`) && !/\x1b\[38;2;242;167;201m[a-z]/.test(lit), "no pink label");
	const still = activeRow(undefined);
	assert.ok(still.includes(`${fgCode(palette.muted)}checking`), "no scan: the whole label muted");
	assert.ok(!still.includes("255;255;255"));
});

test("an active step without a frame shows the still middle frame; an unknown phase keeps ●", () => {
	assert.match(oddRows({ session: { project: "p" }, odd: { steps: [{ phase: "checking", state: "active", seconds: 1 }] } })[0], /^│▎⡿ checking/);
	assert.match(oddRows({ session: { project: "p" }, odd: { steps: [{ phase: "dancing", state: "active", seconds: 1, frame: 3 }] } })[0], /^│▎● dancing/);
});

test("a 3-cell orb keeps every odd label in one column", () => {
	const model: PanelModel = {
		session: { project: "p" },
		odd: { steps: [...manySteps.slice(0, 7).map((step) => ({ ...step, state: "done" as const })), { phase: "planning", state: "active", seconds: 9, frame: 6 }] },
	};
	const rows = sectionBody(renderPanel(model, 47), "ODD").filter((line) => !/^│ +│ +│$/.test(line));
	assert.match(rows[0], /^│ {5}\+2 earlier/);
	assert.match(rows.at(-1)!, /^│▎⠇⠇⠇ planning +0:09 │$/);
	const column = (line: string) => line.search(/[a-z+]/);
	for (const row of rows) assert.equal(column(row), column(rows.at(-1)!), JSON.stringify(row));
});

test("orb rows fit widths 47, 30 and 20", () => {
	for (const phase of ["exploring", "researching", "authorizing", "deciding", "planning", "implementing", "checking", "closing", "implementing-with-a-long-name"]) {
		for (const width of [47, 30, 20]) {
			for (let frame = 0; frame < 16; frame++) {
				const model: PanelModel = { session: { project: "p" }, odd: { steps: [...manySteps.slice(0, 7).map((step) => ({ ...step, state: "done" as const })), { phase, state: "active", seconds: 3725, frame }] } };
				for (const line of renderPanel(model, width)) assert.ok(visibleWidth(line) <= width, `${phase} ${width}: ${JSON.stringify(plain(line))}`);
			}
		}
	}
});

test("the digest changes when the visible orb frame changes", () => {
	const at = (frame: number): PanelModel => ({ session: { project: "p" }, odd: { steps: [{ phase: "checking", state: "active", seconds: 1, frame }] } });
	assert.notEqual(panelDigest(at(1)), panelDigest(at(2)));
	assert.equal(panelDigest(at(1)), panelDigest(at(1)));
});

test("queued agents show a faint ○ and keep their place in the list", () => {
	const lines = renderPanel({ session: { project: "p" }, agents: [{ name: "explore", task: "Map", state: "running" }, { name: "verify", task: "Check", state: "queued" }] }, 47);
	const body = sectionBody(lines, "agents");
	assert.match(body[1], /^│ ○ verify Check +│$/);
	const queued = lines.find((line) => plain(line).includes("verify"))!;
	assert.ok(queued.includes(`[38;2;${palette.faint.join(";")}m○`), "faint glyph");
});

// --- S53: changes, one row per file (design 17) -----------------------------------

const changesRaw = (changes: PanelModel["changes"], width = 47) => {
	const lines = renderPanel({ session: { project: "p" }, changes }, width);
	const start = lines.findIndex((line) => plain(line).startsWith("╭─ changes"));
	const end = lines.findIndex((line, index) => index > start && plain(line).startsWith("╰"));
	return { title: lines[start], rows: lines.slice(start + 1, end) };
};

test("each status has its glyph, color and right side; edited files show +N -N (S53)", () => {
	const cases = [
		{ change: { status: "M" as const, path: "lib/panel.ts", added: 12, removed: 3 }, glyph: "●", color: palette.amber, row: /^│ ● panel\.ts lib\/ +\+12 -3 │$/ },
		{ change: { status: "?" as const, path: "lib/rdd.ts", added: 0, removed: 0 }, glyph: "+", color: palette.green, row: /^│ \+ rdd\.ts lib\/ +new │$/, word: "new" },
		{ change: { status: "A" as const, path: "lib/added.ts", added: 10, removed: 0 }, glyph: "+", color: palette.green, row: /^│ \+ added\.ts lib\/ +new │$/, word: "new" },
		{ change: { status: "D" as const, path: "scripts/old-preview.ts", added: 0, removed: 40 }, glyph: "-", color: palette.red, row: /^│ - old-preview\.ts scripts\/ +deleted │$/, word: "deleted" },
		{ change: { status: "R" as const, path: "scripts/preview.ts", added: 2, removed: 2 }, glyph: "→", color: palette.blue, row: /^│ → preview\.ts scripts\/ +renamed │$/, word: "renamed" },
	];
	for (const { change, glyph, color, row, word } of cases) {
		const { rows } = changesRaw([change]);
		assert.equal(rows.length, 1, change.path);
		assert.match(plain(rows[0]), row);
		assert.ok(rows[0].includes(`${fgCode(color)}${glyph}`), `${change.status} glyph color`);
		const name = change.path.split("/").pop()!;
		assert.ok(rows[0].includes(`\x1b[1m${fgCode(palette.text)}${name}`), "bold name");
		assert.ok(rows[0].includes(`${fgCode(palette.muted)}${change.path.slice(0, -name.length)}`), "muted folder");
		if (word) assert.ok(rows[0].includes(`${fgCode(color)}${word}`), `${word} in the glyph color`);
		assert.ok(!/uncommitted|new file|[█░−]/.test(plain(rows[0])), "no bar, no uncommitted, no new file, ASCII minus");
	}
	const edited = changesRaw([{ status: "M", path: "a.ts", added: 12, removed: 3 }]).rows[0];
	assert.ok(edited.includes(`${fgCode(palette.green)}+12`) && edited.includes(`${fgCode(palette.red)}-3`), "colored counts");
});

test("edited counts of zero are muted (S53)", () => {
	const added = changesRaw([{ status: "M", path: "a.ts", added: 5, removed: 0 }]).rows[0];
	assert.match(plain(added), /^│ ● a\.ts +\+5 -0 │$/);
	assert.ok(added.includes(`${fgCode(palette.green)}+5`) && added.includes(`${fgCode(palette.muted)}-0`));
	const removed = changesRaw([{ status: "M", path: "a.ts", added: 0, removed: 4 }]).rows[0];
	assert.ok(removed.includes(`${fgCode(palette.muted)}+0`) && removed.includes(`${fgCode(palette.red)}-4`));
});

test("a root file has no folder (S53)", () => {
	assert.match(plain(changesRaw([{ status: "M", path: "README.md", added: 4, removed: 4 }]).rows[0]), /^│ ● README\.md +\+4 -4 │$/);
});

test("narrow rails cut the folder before the name and drop the right word before the name, all width-safe (S53)", () => {
	const change = { status: "M" as const, path: "src/some/deep/path/file-1.ts", added: 1, removed: 0 };
	const at = (width: number, status: "M" | "R" = "M") => plain(changesRaw([{ ...change, status }], width).rows[0]);
	assert.match(at(47), /^│ ● file-1\.ts src\/some\/deep\/path\/ +\+1 -0 │$/);
	assert.match(at(30), /^│ ● file-1\.ts src\/som… +\+1 -0 │$/, "folder cut first");
	assert.match(at(20), /^│ ● file-1\.… +\+1 -0 │$/, "name cut only when no folder fits");
	assert.match(at(20, "R"), /^│ → file-1\.ts src… │$/, "the right word drops before the name");
	const all = [change, { ...change, status: "R" as const }, { ...change, status: "?" as const }, { ...change, status: "D" as const }, ...manyChanges];
	for (const width of [47, 30, 20]) {
		for (const line of renderPanel({ session: { project: "p" }, changes: all }, width)) {
			assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}: ${JSON.stringify(plain(line))}`);
		}
	}
});

test("the title says N to commit, muted, counting every changed file (S53)", () => {
	const { title } = changesRaw(manyChanges);
	assert.match(plain(title), /^╭─ changes ─+ 9 to commit ─╮$/);
	assert.ok(title.includes(`${fgCode(palette.muted)}9 to commit`));
});

test("a clean tree shows one ✓ everything committed row and no title right; unknown git draws no section (S53)", () => {
	const { title, rows } = changesRaw([]);
	assert.equal(plain(title), `╭─ changes ${"─".repeat(35)}╮`);
	assert.deepEqual(rows.map(plain), [`│ ✓ everything committed${" ".repeat(22)}│`]);
	assert.ok(rows[0].includes(`${fgCode(palette.green)}✓`) && rows[0].includes(`${fgCode(palette.muted)}everything committed`));
	assert.ok(!renderPanel({ session: { project: "p" } }, 47).some((line) => plain(line).startsWith("╭─ changes")));
});

test("files sort by added+removed, most first, keeping git order on ties; /dock lists all in that order (S53)", () => {
	const changes = [
		{ status: "?" as const, path: "new.ts", added: 0, removed: 0 },
		{ status: "M" as const, path: "a.ts", added: 1, removed: 1 },
		{ status: "M" as const, path: "big.ts", added: 30, removed: 2 },
		{ status: "M" as const, path: "b.ts", added: 2, removed: 0 },
		{ status: "D" as const, path: "gone.ts", added: 0, removed: 5 },
	];
	const rows = changesRaw(changes).rows.map(plain);
	assert.deepEqual(rows.slice(0, 4).map((line) => line.split(" ")[2]), ["big.ts", "gone.ts", "a.ts", "b.ts"]);
	assert.match(rows[4], /^│ {3}\+1 more · \/dock all +│$/);
	const dock = renderDock({ session: { project: "p" }, changes }, 59, 200).lines.map(plain).filter((line) => /\.ts\b/.test(line));
	assert.deepEqual(dock.map((line) => /(\S+\.ts)/.exec(line)![1]), ["big.ts", "gone.ts", "a.ts", "b.ts", "new.ts"]);
	assert.deepEqual(changes.map((change) => change.path), ["new.ts", "a.ts", "big.ts", "b.ts", "gone.ts"], "the model is not reordered");
});

test("at 55 columns the panel opens with the wide braille logo, at 47 with the compact one", () => {
	const wide = renderPanel(samplePanelModel, 55).slice(0, 3).map(plain);
	assert.equal(wide[0].trimEnd(), "  ⣤⠛⠛⠛ ⣿⠛⠛⠛ ⣿⣤ ⣿ ⠛⣿⣿⠛ ⣿   ⣿⠛⠛⠛ ⣤⠛⠛⠛ ⣿  ⣿ ⣿⠛⠛⠛ ⣿   ⣿");
	const compact = renderPanel(samplePanelModel, 47).slice(0, 3).map(plain);
	assert.ok(compact.every((line) => line.length === 46 && /^ [ ⠛⣤⣿]+$/.test(line)), "compact braille logo");
	assert.match(compact[0], /^ [⠛⣤⣿]/, "centered: one blank column each side of 47");
	assert.notEqual(compact[0].trimEnd(), wide[0].trimEnd());
	for (const width of [55, 53, 47]) assert.ok(!renderPanel(samplePanelModel, width).join("").includes("[38;2;95;30;60m"), `no shadow at ${width}`);
});

test("heads-up rows keep their glyph colors: red for git warnings, amber for todo and plans (S14)", () => {
	const model: PanelModel = {
		...clone(samplePanelModel),
		headsUp: [
			{ kind: "unpushed", text: "1 commit not pushed" },
			{ kind: "plan", text: "odd plan fisi-dock" },
		],
	};
	const lines = renderPanel(model, 47);
	assert.ok(lines.find((line) => plain(line).includes("1 commit not pushed"))!.includes(`${fgCode(palette.red)}!`));
	assert.ok(lines.find((line) => plain(line).includes("odd plan fisi-dock"))!.includes(`${fgCode(palette.amber)}!`));
});

// The background each visible cell is drawn on, or undefined when none is set.
function cellBackgrounds(line: string): (string | undefined)[] {
	const cells: (string | undefined)[] = [];
	let background: string | undefined;
	for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
		const sgr = /^\x1b\[([0-9;]*)m$/.exec(part);
		if (!sgr) {
			for (const char of part) for (let cell = 0; cell < visibleWidth(char); cell++) cells.push(background);
			continue;
		}
		const params = sgr[1] === "" ? ["0"] : sgr[1].split(";");
		for (let index = 0; index < params.length; index++) {
			if (params[index] === "0" || params[index] === "49") background = undefined;
			else if (params[index] === "48" && params[index + 1] === "2") {
				background = params.slice(index + 2, index + 5).join(";");
				index += 4;
			}
		}
	}
	return cells;
}

const BLACK_BG = bgCode([0, 0, 0]);

for (const width of [64, 53, 40]) {
	test(`/dock at ${width} columns: the side panel's own rows and colors, edge to edge, no background of its own (S59)`, () => {
		const { lines } = renderDock(longModel, width, 20);
		assert.equal(lines.length, 20, "the whole screen height");
		const panel = renderPanel(longModel, width - 2, { todoExpanded: true, listsExpanded: true, oddExpanded: true });
		// The panel starts DOCK_TOP_ROWS down, as the rail starts under the top row and its gap on the PC (S59).
		assert.deepEqual(lines.slice(0, DOCK_TOP_ROWS), Array(DOCK_TOP_ROWS).fill(" ".repeat(width)), "blank rows above the panel");
		lines.slice(DOCK_TOP_ROWS, -1).forEach((line, index) => {
			assert.equal(visibleWidth(line), width, `the whole screen width: ${JSON.stringify(plain(line))}`);
			// Byte for byte the rail's row (same colors, same highlight), only one plain space of margin each side.
			assert.equal(line, ` ${panel[index]}${" ".repeat(width - 2 - visibleWidth(panel[index]))} `, `row ${index}: ${JSON.stringify(plain(line))}`);
		});
		for (const line of lines) assert.ok(!line.includes(BLACK_BG), `no black background: ${JSON.stringify(plain(line))}`);
		assert.match(plain(lines.at(-1)!), /^ Esc to close +↑↓ scroll $/);
		assert.equal(visibleWidth(lines.at(-1)!), width);
	});
}

test(`/dock on a wide screen: the panel at most ${DOCK_MAX_WIDTH} columns, centered (S59)`, () => {
	const { lines } = renderDock(longModel, 200, 20);
	const panel = renderPanel(longModel, DOCK_MAX_WIDTH).map(plain);
	const left = (200 - DOCK_MAX_WIDTH) / 2;
	for (const line of lines) assert.equal(visibleWidth(line), 200);
	assert.deepEqual(lines.slice(DOCK_TOP_ROWS, -1).map((line) => plain(line).slice(left, left + DOCK_MAX_WIDTH)), panel.slice(0, 19 - DOCK_TOP_ROWS).map((line) => line.padEnd(DOCK_MAX_WIDTH)));
	assert.equal(plain(lines[DOCK_TOP_ROWS]).slice(0, left).trim(), "", "blank margin on the left");
});

test("/dock: a panel that fits still covers the whole screen, with no scroll hint (S59)", () => {
	const { lines, offset } = renderDock(samplePanelModel, 64, 80);
	const panel = renderPanel(samplePanelModel, 62).map(plain);
	assert.equal(offset, 0);
	assert.equal(lines.length, 80);
	const text = lines.map(plain);
	assert.deepEqual(text.slice(0, DOCK_TOP_ROWS), Array(DOCK_TOP_ROWS).fill(" ".repeat(64)), "blank rows above the panel");
	assert.deepEqual(text.slice(DOCK_TOP_ROWS, DOCK_TOP_ROWS + panel.length), panel.map((line) => ` ${line.padEnd(62)} `));
	for (const line of text.slice(DOCK_TOP_ROWS + panel.length, -1)) assert.equal(line, " ".repeat(64), "blank rows under the panel");
	assert.match(text.at(-1)!, /^ Esc to close +$/);
});

test("/dock is 2 rows down, like the rail on the PC (S59)", () => {
	assert.equal(DOCK_TOP_ROWS, 2);
});

test("/dock scrolls on short screens and keeps the close hint (S23, S59)", () => {
	const top = renderDock(longModel, 64, 8, 0);
	const next = renderDock(longModel, 64, 8, 1);
	assert.equal(next.offset, 1);
	assert.equal(plain(next.lines[DOCK_TOP_ROWS]), plain(top.lines[DOCK_TOP_ROWS + 1]));
	const end = renderDock(longModel, 64, 8, 999);
	assert.equal(end.offset, renderPanel(longModel, 62).length - (7 - DOCK_TOP_ROWS));
	assert.equal(plain(end.lines.at(-2)!).slice(1, -1), plain(renderPanel(longModel, 62).at(-1)!).padEnd(62), "the last panel row is reachable");
	for (const view of [top, next, end]) assert.match(plain(view.lines.at(-1)!), /Esc to close/);
});

test("/dock: the selected row wears the side panel's own highlight (S59)", () => {
	const { lines } = renderDock(samplePanelModel, 64, 80);
	const selected = lines.find((line) => plain(line).includes("▎"))!;
	assert.ok(cellBackgrounds(selected).includes(palette.highlight.join(";")), "the rail highlight");
});

// S31: every running spinner moves with the clock: the model carries the frame.
const running = (spinner?: number): PanelModel => ({
	session: { project: "p" },
	todo: {
		done: 1,
		total: 3,
		active: "Running now",
		next: "Later",
		more: 0,
		tasks: [
			{ title: "Finished", state: "done" },
			{ title: "Running now", state: "active" },
			{ title: "Later", state: "pending" },
		],
	},
	agents: [
		{ name: "verify", task: "Check", state: "running" },
		{ name: "explore", task: "Map", state: "done" },
		{ name: "later", task: "Wait", state: "queued" },
		{ name: "broken", task: "Oops", state: "failed" },
	],
	...(spinner !== undefined ? { spinner } : {}),
});

test("the side panel's todo and agent spinners show the model's frame (S31)", () => {
	for (const [frame, glyph] of [[0, "⠋"], [1, "⠙"], [3, "⠸"], [9, "⠏"]] as const) {
		const lines = renderPanel(running(frame), 47);
		assert.match(sectionBody(lines, "todo")[1], new RegExp(`^│▎${glyph} Running now +│$`), `todo frame ${frame}`);
		assert.deepEqual(sectionBody(lines, "agents").map((line) => line.replace(/ +│$/, "")), [`│ ${glyph} verify Check`, "│ ✓ explore Map", "│ ○ later Wait", "│ ✗ broken Oops"], `agents frame ${frame}`);
		for (const line of lines) assert.ok(visibleWidth(line) <= 47);
	}
	const still = renderPanel(running(), 47);
	assert.match(sectionBody(still, "todo")[1], /^│▎⠹ Running now +│$/, "no frame: the still ⠹");
	assert.deepEqual(still, renderPanel(running(2), 47), "frame 2 is the still glyph");
});

test("the phone todo card and /dock's full list show the model's spinner frame (S31)", () => {
	const card = (frame?: number) => renderTodoCard(running(frame).todo, 53, frame).map(plain);
	assert.match(card(0)[2], /^│▎⠋ Running now +│$/);
	assert.match(card(5)[2], /^│▎⠴ Running now +│$/);
	assert.match(card()[2], /^│▎⠹ Running now +│$/, "no frame: still");
	const dock = (frame: number) => renderDock(running(frame), DOCK_WIDTH + 4, 60).lines.map(plain);
	assert.ok(dock(0).some((line) => /│▎⠋ Running now +│/.test(line)), "dock todo frame 0");
	assert.ok(dock(0).some((line) => /│ ⠋ verify Check +│/.test(line)), "dock agent frame 0");
	assert.ok(dock(4).some((line) => /│▎⠼ Running now +│/.test(line)), "dock todo frame 4");
	assert.ok(dock(4).some((line) => /│ ✓ Finished +│/.test(line)), "done rows stay ✓");
});

test("with nothing running the panel ignores the spinner frame: byte-identical output (S31)", () => {
	const idle = clone(samplePanelModel);
	delete idle.todo!.active;
	idle.agents![1].state = "done";
	idle.odd!.steps[3].state = "done";
	idle.rdd!.reviews[1] = { scope: "lib/orbs.ts +2", status: "approved", endedAt: 0 };
	for (const width of [58, 55, 47, 30]) {
		const before = renderPanel(idle, width);
		for (let frame = 0; frame < 10; frame++) assert.deepEqual(renderPanel({ ...idle, spinner: frame }, width), before, `${width} frame ${frame}`);
	}
});

test("the digest changes when the visible spinner frame changes (S31)", () => {
	assert.notEqual(panelDigest(running(1)), panelDigest(running(2)));
	assert.equal(panelDigest(running(1)), panelDigest(running(1)));
});

// --- S34b: short screens ---------------------------------------------------------

const isSpacer = (line: string) => /^│ │ +│$/.test(line);

test("a panel that fits the rows is unchanged; no row limit is the old output (S34)", () => {
	const full = renderPanel(samplePanelModel, 47);
	assert.deepEqual(renderPanel(samplePanelModel, 47, {}), full);
	assert.deepEqual(renderPanel(samplePanelModel, 47, { maxRows: full.length }), full);
	assert.deepEqual(renderPanel(samplePanelModel, 47, { maxRows: 500 }), full);
});

test("short screens keep the logo, session, heads-up, ODD, todo and agents; drop the session's group labels, then odd and rdd spacers, then changes, then rdd with a running ODD cut to its active row (S38, S34, S50, S52)", () => {
	const model: PanelModel = { ...clone(samplePanelModel), headsUp: [{ kind: "unpushed", text: "1 commit not pushed" }] };
	const full = renderPanel(model, 58).map(plain);
	const logo = full.findIndex((line) => line.startsWith("╭─ session"));
	assert.ok(logo > 0, "the full panel starts with the logo");
	const spacers = full.filter(isSpacer).length;
	assert.equal(spacers, 4, "three odd spacers and one rdd spacer");
	const has = (lines: string[], title: string) => lines.some((line) => line.startsWith(`╭─ ${title}`));

	// The session has no group labels to drop (sidebar-chrome 02).
	assert.ok(!full.some((line) => /^│ (where|usage|connections) ──/.test(line)), "no group labels");

	// (1) The odd and rdd spacer rows go first.
	const noSpacers = renderPanel(model, 58, { maxRows: full.length - 1 }).map(plain);
	assert.equal(noSpacers.length, full.length - spacers);
	assert.deepEqual(noSpacers.slice(0, logo), full.slice(0, logo), "logo kept");
	assert.ok(!noSpacers.some(isSpacer), "no spacer rows");
	assert.deepEqual(sectionBody(noSpacers, "ODD").map((line) => line.replace(/^│[ ▎]/, "").replace(/ +│$/, "").replace(/ +/g, " ")), ["✓ exploring 0:31", "✓ implementing 1:12", "✓ exploring 0:20", "⡿ checking 0:42"]);
	assert.equal(sectionBody(noSpacers, "RDD").length, 2, "rdd rows without their spacer");
	assert.ok(has(noSpacers, "changes") && has(noSpacers, "agents"));

	// (2) Then the changes section.
	const noChanges = renderPanel(model, 58, { maxRows: noSpacers.length - 1 }).map(plain);
	assert.ok(!has(noChanges, "changes"), "changes dropped");
	assert.ok(has(noChanges, "ODD") && has(noChanges, "RDD"), "odd and rdd still there");
	assert.equal(noChanges.length, noSpacers.length - 3, "the changes frame: title, one file row, bottom");

	// (3) Then the rdd section, and a running ODD keeps only its active row; nothing else ever drops: the rest scrolls in Gentle Shell's rail.
	const noOdd = renderPanel(model, 58, { maxRows: noChanges.length - 1 }).map(plain);
	assert.ok(has(noOdd, "ODD"), "the ODD title stays");
	assert.ok(!has(noOdd, "RDD") && !has(noOdd, "changes"), "rdd dropped after changes");
	assert.deepEqual(oddText(noOdd), ["⡿ checking 0:42"], "only the active row");
	assert.equal(noOdd.length, noChanges.length - (sectionBody(noChanges, "ODD").length - 1) - sectionBody(noChanges, "RDD").length - 2, "rdd frame and the done odd rows in the same step");
	for (const title of ["session", "heads-up", "todo", "agents"]) assert.ok(has(noOdd, title), title);
	assert.deepEqual(noOdd.slice(0, logo), full.slice(0, logo), "logo kept");

	const tiny = renderPanel(model, 58, { maxRows: 3 }).map(plain);
	assert.deepEqual(tiny, noOdd, "nothing else drops");
	for (const rows of [40, 30, 20, 10, 3, 0]) for (const line of renderPanel(model, 58, { maxRows: rows })) assert.ok(visibleWidth(line) <= 58, `${rows}: ${plain(line)}`);
});

test("short screens keep a settled or idle ODD at its one row (S52)", () => {
	for (const odd of [undefined, settledOdd(4)]) {
		const model: PanelModel = { ...clone(samplePanelModel), headsUp: [{ kind: "unpushed", text: "1 commit not pushed" }] };
		if (odd) model.odd = odd;
		else delete model.odd;
		const tiny = renderPanel(model, 58, { maxRows: 3 }).map(plain);
		assert.equal(sectionBody(tiny, "ODD").length, 1);
		assert.ok(!tiny.some((line) => line.startsWith("╭─ RDD")));
	}
});

test("58 columns and 20 rows: braille logo first, then session, heads-up, ODD, agents and todo; no changes or rdd (S38, S52)", () => {
	const model: PanelModel = { ...clone(samplePanelModel), headsUp: [{ kind: "unpushed", text: "1 commit not pushed" }] };
	const lines = renderPanel(model, 58, { maxRows: 20 }).map(plain);
	const logo = renderPanel(model, 58).map(plain).findIndex((line) => line.startsWith("╭─ session"));
	assert.ok(lines.slice(0, logo).every((line) => /[⠀-⣿]/.test(line) || line.trim() === ""), "braille logo rows first");
	assert.ok(lines.slice(0, logo).some((line) => /[⠁-⣿]/.test(line)));
	const titles = lines.filter((line) => line.startsWith("╭─ ")).map((line) => line.slice(3).split(" ")[0]);
	assert.deepEqual(titles, ["session", "heads-up", "ODD", "agents", "todo"]);
	console.log(`--- panel at 58 columns, 20 rows available\n${lines.join("\n")}`);
});

// --- S35: the phone agents card ---------------------------------------------------

const NOW = 1_000_000;
const runningAgents: PanelModel["agents"] = [
	{ name: "worker", task: "session rows", state: "running", startedAt: NOW - 271_000 },
	{ name: "explore", task: "Map CI", state: "done", startedAt: NOW - 50_000 },
	{ name: "verify", task: "queued prompt", state: "running", startedAt: NOW - 125_000 },
	{ name: "later", task: "Wait", state: "queued" },
	{ name: "broken", task: "Lint", state: "failed" },
];

test("agents card: framed like the panel, running agents only, spinner, name, task and elapsed m:ss (S35, S31)", () => {
	const lines = renderAgentsCard(runningAgents, 53, 1, NOW);
	const card = lines.map(plain);
	assert.match(card[0], /^╭─ agents ─+ 2 ─╮$/, "running count on the top border");
	assert.match(card[1], /^│ ⠙ worker +session rows +4:31 │$/);
	assert.match(card[2], /^│ ⠙ verify +queued prompt +2:05 │$/);
	assert.match(card[3], /^╰─+╯$/);
	assert.equal(card.length, 4, "done, queued and failed agents are not listed");
	assert.equal(card[1].indexOf("session rows"), card[2].indexOf("queued prompt"), "tasks start in one column");
	assert.ok(lines[0].includes(fgCode(palette.frame)) && lines[0].includes(fgCode(panelVivid(palette.lilac))), "gray frame, agents title vivid");
	assert.ok(lines[1].includes(`${fgCode(palette.blue)}⠙`), "spinner in the agents blue");
	console.log(`--- agents card, 53 columns\n${card.join("\n")}`);
});

test("agents card: the spinner shows the model's frame, the still ⠹ without one (S31)", () => {
	assert.match(plain(renderAgentsCard(runningAgents, 53, 0, NOW)[1]), /^│ ⠋ worker/);
	assert.match(plain(renderAgentsCard(runningAgents, 53, 7, NOW)[1]), /^│ ⠧ worker/);
	assert.match(plain(renderAgentsCard(runningAgents, 53, undefined, NOW)[1]), /^│ ⠹ worker/);
});

test("agents card: elapsed from startedAt, omitted when unknown, never negative; hours past 60 minutes", () => {
	assert.equal(formatElapsed(0), "0:00");
	assert.equal(formatElapsed(59_999), "0:59");
	assert.equal(formatElapsed(271_000), "4:31");
	assert.equal(formatElapsed(3_599_000), "59:59");
	assert.equal(formatElapsed(3_600_000), "1:00:00");
	assert.equal(formatElapsed(-5_000), "0:00", "a start in the future counts as now");
	const unknown = renderAgentsCard([{ name: "worker", task: "session rows", state: "running" }], 53, 2, NOW).map(plain);
	assert.match(unknown[1], /^│ ⠹ worker session rows +│$/, "no start time: no time, never invented");
	const later = renderAgentsCard(runningAgents, 53, 2, NOW + 1_000).map(plain);
	assert.match(later[1], / 4:32 │$/, "the time follows now");
});

test("agents card: at most 4 rows, then +N more  /dock all; [] when nothing runs", () => {
	const six = Array.from({ length: 6 }, (_, index) => ({ name: `agent${index}`, task: `task ${index}`, state: "running" as const, startedAt: NOW - index * 1_000 }));
	const card = renderAgentsCard(six, 53, 2, NOW).map(plain);
	assert.match(card[0], / 6 ─╮$/, "the count is every running agent");
	assert.deepEqual(card.slice(1, 5).map((line) => line.split(/ +/)[2]), ["agent0", "agent1", "agent2", "agent3"]);
	assert.match(card[5], /^│ {3}\+2 more +\/dock all │$/);
	assert.equal(card.length, 7);
	assert.deepEqual(renderAgentsCard(undefined, 53, 2, NOW), []);
	assert.deepEqual(renderAgentsCard([], 53, 2, NOW), []);
	assert.deepEqual(renderAgentsCard(runningAgents.filter((agent) => agent.state !== "running"), 53, 2, NOW), [], "finished and queued only");
	assert.deepEqual(renderAgentsCard(runningAgents, 0, 2, NOW), []);
});

test("agents card: width-safe at 64, 53, 40 and 20; long names and tasks are cut, the time stays", () => {
	const long: PanelModel["agents"] = [
		{ name: "an-agent-with-a-very-long-name", task: "A very long task description that goes on past the phone", state: "running", startedAt: NOW - 754_000 },
		{ name: "verify", task: "queued prompt", state: "running", startedAt: NOW - 125_000 },
	];
	for (const width of [64, 53, 40, 20]) {
		const lines = renderAgentsCard(long, width, 2, NOW);
		for (const line of lines) assert.equal(visibleWidth(line), width, `${width}: ${plain(line)}`);
		assert.match(plain(lines[1]), /…/, `${width}: cut with an ellipsis`);
		assert.match(plain(lines[2]), / 2:05 │$/, `${width}: time flush right`);
	}
	assert.match(plain(renderAgentsCard(long, 40, 2, NOW)[1]), / 12:34 │$/);
	console.log(`--- agents card, 40 and 20 columns\n${[...renderAgentsCard(long, 40, 2, NOW), ...renderAgentsCard(long, 20, 2, NOW)].map(plain).join("\n")}`);
});

test("the side panel's agents section is unchanged by start times (S35 keeps its own rules)", () => {
	const model: PanelModel = { session: { project: "app" }, agents: runningAgents };
	const bare: PanelModel = { session: { project: "app" }, agents: runningAgents!.map(({ startedAt: _, ...agent }) => agent) };
	assert.deepEqual(renderPanel(model, 47), renderPanel(bare, 47));
});

test("/dock lists every agent and changed file; the side panel keeps its cap of 4 (S35)", () => {
	const agents = Array.from({ length: 6 }, (_, index) => ({ name: `agent-${index + 1}`, task: `task ${index + 1}`, state: "running" as const }));
	const changes = Array.from({ length: 6 }, (_, index) => ({ status: "M" as const, path: `src/file-${index + 1}.ts`, added: 1, removed: 0 }));
	const model: PanelModel = { session: { project: "p" }, agents, changes };
	const dock = renderDock(model, 59, 200).lines.map(plain).join("\n");
	for (let index = 1; index <= 6; index++) {
		assert.ok(dock.includes(`agent-${index}`), `agent-${index} in /dock`);
		assert.ok(dock.includes(`file-${index}.ts src/`), `file-${index} in /dock`);
	}
	assert.ok(!dock.includes("more"), "no +N more inside /dock");
	const rail = renderPanel(model, 55).map(plain).join("\n");
	assert.ok(!rail.includes("agent-6") && rail.includes("+2 more"), "side panel still capped");
});

// Row entrance (S54, artboard 16): only colors change, so every row keeps its width.
const ENTRANCE_WHITE = "\x1b[38;2;255;255;255m";
const entranceModel = (entrance?: number): PanelModel => ({
	session: { project: "p" },
	agents: [
		{ name: "explore", task: "Map CI", state: "done" },
		{ name: "verify", task: "Check PR", state: "running", ...(entrance === undefined ? {} : { entrance }) },
	],
	todo: { done: 1, total: 3, active: "Run the suite", next: "Commit", more: 0, ...(entrance === undefined ? {} : { entrance }) },
	odd: { steps: [{ phase: "exploring", state: "done", seconds: 3 }, { phase: "planning", state: "active", seconds: 5, frame: 2, scan: 3, ...(entrance === undefined ? {} : { entrance }) }] },
	rdd: { reviews: [{ scope: "a.ts", status: "approved", endedAt: Date.UTC(2026, 9, 29, 22, 5) }, { scope: "b.ts", status: "reviewing", seconds: 4, ...(entrance === undefined ? {} : { entrance }) }] },
	spinner: 2,
});
const rawRow = (lines: string[], title: string, text: string) => {
	const start = lines.findIndex((line) => plain(line).startsWith(`╭─ ${title}`));
	const end = lines.findIndex((line, index) => index > start && plain(line).startsWith("╰"));
	return lines.slice(start + 1, end).find((line) => plain(line).includes(text))!;
};
const ENTRANCE_ROWS = [
	["agents", "verify", palette.lilac, "⠹", "Check PR"],
	["todo", "Run the suite", palette.coral, "⠹", "Run the suite"],
	["ODD", "planning", palette.amber, "⠇⠄⠀", "planning"],
	["RDD", "b.ts", palette.rose, "⠹", "b.ts"],
] as const;

for (const [title, text, color, glyph, last] of ENTRANCE_ROWS) {
	test(`${title}: an entering row flashes bold in the section color, then the white shine crosses it (S54)`, () => {
		const flash = rawRow(renderPanel(entranceModel(0), 47), title, text);
		assert.ok(flash.includes(`${fgCode(color)}${glyph}`), "the glyph wears the section color during the flash");
		assert.ok(flash.includes(`\x1b[1m${fgCode(color)}${text.slice(0, 2)}`), "step 0: the text bold in the section color");
		assert.ok(!flash.includes(ENTRANCE_WHITE), "no shine during the flash");
		const shine = rawRow(renderPanel(entranceModel(5), 47), title, text);
		assert.ok(shine.includes(`${ENTRANCE_WHITE}${text[0]}`), "step 5: the white head on the first char");
		assert.ok(!shine.includes(`${fgCode(color)}${glyph}`), "the glyph is back to its own color after the flash");
		assert.ok(plain(shine).includes(last), "the text is all there");
		assert.equal(plain(flash), plain(rawRow(renderPanel(entranceModel(), 47), title, text)), "same visible row");
	});
}

test("rows without an entrance, or past its end, look exactly as today (S54)", () => {
	const today = renderPanel(entranceModel(), 47);
	assert.deepEqual(renderPanel(entranceModel(200), 47), today);
	const odd = rawRow(today, "ODD", "planning");
	assert.ok(odd.includes(ENTRANCE_WHITE), "the ODD label keeps its gray shimmer after the entrance");
	assert.deepEqual(renderTodoCard(entranceModel(200).todo, 47, 2), renderTodoCard(entranceModel().todo, 47, 2));
});

test("entering rows are width-safe at 47, 30 and 20 at every step (S54)", () => {
	for (const width of [47, 30, 20]) {
		for (let step = 0; step < 30; step++) {
			const lines = renderPanel(entranceModel(step), width);
			const today = renderPanel(entranceModel(), width);
			assert.deepEqual(lines.map(plain), today.map(plain), `${width}/${step}: same visible text`);
			for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}/${step}: ${plain(line)}`);
		}
	}
});

test("the todo card and /dock list show the active task's entrance too (S54)", () => {
	const card = renderTodoCard(entranceModel(0).todo, 47, 2).find((line) => plain(line).includes("Run the suite"))!;
	assert.ok(card.includes(`\x1b[1m${fgCode(palette.coral)}Ru`));
	const todo = { ...entranceModel(0).todo!, tasks: [{ title: "Commit", state: "done" as const }, { title: "Run the suite", state: "active" as const }] };
	const dock = renderDock({ session: { project: "p" }, todo }, 59, 200).lines.find((line) => plain(line).includes("Run the suite"))!;
	assert.ok(dock.includes(`\x1b[1m${fgCode(palette.coral)}Ru`));
});

// --- S69: the model label at the right end of each agent row (replaces S56's line) ---

const PURPLE = [0xb4, 0x8c, 0xff] as const;
const modelAgents: PanelModel["agents"] = [
	{ name: "explore", task: "Map CI workflow", state: "done", model: "claude-haiku-5-5", effort: "medium" },
	{ name: "worker", task: "Write the RDD section", state: "running", model: "claude-bridge/claude-opus-5-5", effort: "high" },
	{ name: "verify", task: "Check PR 265 checks", state: "running", model: "claude-sonnet-5-5" },
	{ name: "plain", task: "No model", state: "queued" },
];

test("agents: each agent stays one row with its model family and effort on the right; no label without a model (S69)", () => {
	const raw = renderPanel({ session: { project: "p" }, agents: modelAgents }, 47, { maxRows: Infinity });
	assert.deepEqual(sectionBody(raw, "agents"), [
		"│ ✓ explore Map CI workflow    haiku · medium │",
		"│ ⠹ worker Write the RDD section  opus · high │",
		"│ ⠹ verify Check PR 265 checks         sonnet │",
		"│ ○ plain No model                            │",
	]);
	const start = raw.findIndex((line) => plain(line).startsWith("╭─ agents"));
	assert.ok(raw[start + 1].includes(`${fgCode(palette.blue)}haiku`), "family in the medium color");
	assert.ok(raw[start + 1].includes(`${fgCode(palette.muted)} · medium`), "effort muted");
	assert.ok(raw[start + 2].includes(`${fgCode(PURPLE)}opus`), "family in the high color");
	assert.ok(raw[start + 2].includes(`${fgCode(palette.muted)} · high`));
	assert.ok(raw[start + 3].includes(`${fgCode(palette.muted)}sonnet`) && !plain(raw[start + 3]).includes("·"), "no effort: muted family only");
	assert.deepEqual(palette.purple, PURPLE);
});

test("agents: the family takes the effort's group color, an unknown effort muted (S69)", () => {
	const colors: [string, readonly number[]][] = [
		["low", palette.amber], ["minimal", palette.amber], ["medium", palette.blue],
		["high", PURPLE], ["xhigh", PURPLE], ["max", PURPLE], ["turbo", palette.muted],
	];
	for (const [effort, color] of colors) {
		const raw = renderPanel({ session: { project: "p" }, agents: [{ name: "a", task: "t", state: "done", model: "claude-opus-5-5", effort }] }, 47);
		const start = raw.findIndex((line) => plain(line).startsWith("╭─ agents"));
		assert.ok(raw[start + 1].includes(`${fgCode(color as [number, number, number])}opus`), effort);
		assert.ok(raw[start + 1].includes(`${fgCode(palette.muted)} · ${effort}`), effort);
	}
	const turbo = renderPanel({ session: { project: "p" }, agents: [{ name: "a", task: "t", state: "done", model: "claude-opus-5-5", effort: "turbo" }] }, 47);
	assert.deepEqual(sectionBody(turbo, "agents"), ["│ ✓ a t                          opus · turbo │"]);
});

test("agents: a model with no family word shows today's short model text (S69)", () => {
	const raw = renderPanel({ session: { project: "p" }, agents: [{ name: "a", task: "t", state: "done", model: "openai/gpt-5-1" }] }, 47);
	assert.deepEqual(sectionBody(raw, "agents"), ["│ ✓ a t                               gpt-5.1 │"]);
});

test("agents: without model fields the section is exactly today's rows (S69)", () => {
	const today = renderPanel({ session: { project: "p" }, agents: manyAgents }, 47);
	const withUndefined = renderPanel({ session: { project: "p" }, agents: manyAgents.map((agent) => ({ ...agent, effort: "high" })) }, 47);
	assert.deepEqual(withUndefined, today, "effort alone draws no label");
	assert.deepEqual(sectionBody(today, "agents").length, 5);
});

test("agents: a long task is cut before the label (S69)", () => {
	const agents = [{ name: "worker", task: "Write the RDD section with every lens and its summary", state: "running" as const, model: "claude-opus-5-5", effort: "high" }];
	assert.deepEqual(sectionBody(renderPanel({ session: { project: "p" }, agents }, 47), "agents"), ["│ ⠹ worker Write the RDD section… opus · high │"]);
});

test("agents: too narrow, the row drops the effort, then the label (S69)", () => {
	const agents = [{ name: "worker", task: "Write the RDD section", state: "running" as const, model: "claude-opus-5-5", effort: "high" }];
	const body = (width: number) => sectionBody(renderPanel({ session: { project: "p" }, agents }, width), "agents");
	assert.deepEqual(body(26), ["│ ⠹ worker … opus · high │"]);
	assert.deepEqual(body(25), ["│ ⠹ worker Write … opus │"]);
	assert.deepEqual(body(14), ["│ ⠹ worker … │"]);
	for (const width of [55, 47, 30, 20, 14]) for (const line of renderPanel({ session: { project: "p" }, agents }, width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
});

test("agents: the cap counts agents; /dock shows every agent's label (S69)", () => {
	const six = manyAgents.slice(0, 6).map((agent) => ({ ...agent, model: "claude-opus-5-5", effort: "high" }));
	const body = sectionBody(renderPanel({ session: { project: "p" }, agents: six }, 47), "agents");
	assert.equal(body.length, 5, "4 agents, then more");
	assert.ok(body[3].includes("job-4") && body[3].endsWith("opus · high │"));
	assert.match(body[4], /^│ {3}\+2 more +│$/);
	const dock = renderDock({ session: { project: "p" }, agents: six }, DOCK_WIDTH + 4, 200).lines.map(plain);
	assert.equal(dock.filter((line) => line.includes("opus · high")).length, 6);
});

test("agents: the entrance plays on the name and task, the label stays in its colors (S69, S54)", () => {
	const agent = { name: "worker", task: "Write", state: "running" as const, model: "claude-opus-5-5", effort: "high" };
	const still = renderPanel({ session: { project: "p" }, agents: [agent] }, 47);
	const entering = renderPanel({ session: { project: "p" }, agents: [{ ...agent, entrance: 0 }] }, 47);
	const start = still.findIndex((line) => plain(line).startsWith("╭─ agents"));
	assert.notEqual(entering[start + 1], still[start + 1], "the agent row enters");
	assert.equal(plain(entering[start + 1]), plain(still[start + 1]));
	assert.ok(entering[start + 1].includes(`${fgCode(PURPLE)}opus`) && entering[start + 1].includes(`${fgCode(palette.muted)} · high`), "the label keeps its colors");
});

test("agents card: the label follows the time on each running agent's row (S69, S35)", () => {
	const agents: PanelModel["agents"] = [
		{ name: "worker", task: "Write the RDD section", state: "running", startedAt: NOW - 42_000, model: "claude-bridge/claude-opus-5-5", effort: "high" },
		{ name: "verify", task: "Check PR 265 checks", state: "running", startedAt: NOW - 8_000 },
	];
	const raw = renderAgentsCard(agents, 53, 2, NOW);
	const card = raw.map(plain);
	assert.deepEqual(card.slice(1, 3), [
		"│ ⠹ worker Write the RDD section   0:42 opus · high │",
		"│ ⠹ verify Check PR 265 checks                 0:08 │",
	]);
	assert.equal(card.length, 4, "one row per agent");
	assert.ok(raw[1].includes(`${fgCode(PURPLE)}opus`) && raw[1].includes(`${fgCode(palette.muted)} · high`));
	const today = renderAgentsCard(agents.map(({ model: _m, effort: _e, ...rest }) => rest), 53, 2, NOW);
	assert.equal(plain(today[1]), "│ ⠹ worker Write the RDD section               0:42 │", "no model: today's row");
	for (const width of [64, 53, 40, 20]) for (const line of renderAgentsCard(agents, width, 2, NOW)) assert.equal(visibleWidth(line), width, `${width}: ${plain(line)}`);
});

test("short screens: labels add no rows to the panel (S69, S38)", () => {
	const model: PanelModel = { ...clone(samplePanelModel), agents: modelAgents };
	const full = renderPanel(model, 47);
	const without = renderPanel({ ...model, agents: modelAgents.map(({ model: _m, effort: _e, ...rest }) => rest) }, 47);
	assert.equal(full.length, without.length, "same height as without models");
	assert.equal(sectionBody(renderPanel(model, 47, { maxRows: without.length }), "agents").length, 4);
});

// S58: "tambien ponle la barrita": the listed rail keeps the progress bar, on the title next to done/total.
test("the listed rail todo shows the progress bar on its title, before done/total (S58)", () => {
	for (const [model, title] of [
		[todoOf(statesAt(12, 5)), /─ ▰▰▰▰▱▱▱▱▱▱ 5\/12 ─╮$/],
		[todoOf(statesAt(4, 1)), /─ ▰▱▱▱ 1\/4 ─╮$/],
	] as const) {
		const lines = renderPanel(model, 47);
		const top = lines.find((line) => plain(line).startsWith("╭─ todo"))!;
		assert.match(plain(top), title);
		assert.equal(visibleWidth(top), 47);
	}
	for (const width of [30, 20]) for (const line of renderPanel(todoOf(statesAt(12, 5)), width)) assert.ok(visibleWidth(line) <= width);
});

// --- what each ODD step did (S60) -----------------------------------------------

/** ODD rows with their leading indent kept and inner runs of spaces collapsed. */
const detailRows = (lines: string[]) => sectionBody(lines, "ODD").map((line) => line.slice(2).replace(/ +│$/, "").replace(/(\S) {2,}(\S)/g, "$1 $2"));
const detailOdd = (): NonNullable<PanelModel["odd"]> => ({
	steps: [
		{ phase: "exploring", state: "done", seconds: 31, detail: { text: "read 3 files · 1 search" } },
		{ phase: "implementing", state: "done", seconds: 72, detail: { text: "edited lib/tables/", keepEnd: true, tail: " · 2 files" } },
		{ ...samplePanelModel.odd!.steps[3], detail: { text: "running node --test tests/tables.test.ts" } },
	],
});

test("each ODD step shows a muted line with what it did, under its label (S60)", () => {
	const raw = renderPanel({ session: { project: "p" }, odd: detailOdd() }, 47);
	const lines = raw.map(plain);
	assert.deepEqual(detailRows(lines), ["✓ exploring 0:31", "  read 3 files · 1 search", "│", "✓ implementing 1:12", "  edited lib/tables/ · 2 files", "│", "⡿ checking 0:42", "  running node --test tests/tables.test.ts"]);
	const rowOf = (text: string) => raw[lines.findIndex((line) => line.includes(text))];
	for (const text of ["read 3 files · 1 search", "edited lib/tables/ · 2 files", "running node --test tests/tables.test.ts"]) {
		assert.ok(rowOf(text).includes(`${fgCode(palette.muted)}${text}`), `muted: ${text}`);
		assert.ok(!rowOf(text).includes(bgCode(palette.highlight)), `not highlighted: ${text}`);
	}
	const noDetail = renderPanel({ session: { project: "p" }, odd: { steps: detailOdd().steps.map(({ detail: _, ...step }) => step) } }, 47).map(plain);
	assert.deepEqual(detailRows(noDetail), ["✓ exploring 0:31", "│", "✓ implementing 1:12", "│", "⡿ checking 0:42"], "a step without a detail draws today's rows");
	for (const width of [47, 30, 20, 12]) for (const line of renderPanel({ session: { project: "p" }, odd: detailOdd() }, width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
});

test("a long path keeps its end; other details are cut at the end (S60)", () => {
	const odd = detailOdd();
	odd.steps[2] = { ...odd.steps[2], detail: { text: "editing lib/some/very/long/folder/structure/tables/table-row.ts", keepEnd: true } };
	odd.steps[0] = { ...odd.steps[0], detail: { text: "ran node --test tests/odd-timeline.test.ts tests/panel.test.ts" } };
	const body = sectionBody(renderPanel({ session: { project: "p" }, odd }, 47).map(plain), "ODD");
	assert.equal(body[1], `│   ran node --test tests/odd-timeline.test.… │`);
	assert.equal(body.at(-1), `│   editing …/structure/tables/table-row.ts   │`);
	odd.steps[1] = { ...odd.steps[1], detail: { text: "edited lib/some/very/long/folder/structure/tables/", keepEnd: true, tail: " · 12 files" } };
	const cut = sectionBody(renderPanel({ session: { project: "p" }, odd }, 47).map(plain), "ODD");
	assert.equal(cut[4], `│   edited …/structure/tables/ · 12 files     │`, "the count stays whole (S61)");
});

test("short screens drop the done steps' lines with the spacers; the shortest keep only the active row (S60, S52)", () => {
	const model: PanelModel = { session: { project: "p" }, odd: detailOdd() };
	const full = renderPanel(model, 47);
	const noSpacers = renderPanel(model, 47, { maxRows: full.length - 1 }).map(plain);
	assert.deepEqual(detailRows(noSpacers), ["✓ exploring 0:31", "✓ implementing 1:12", "⡿ checking 0:42", "  running node --test tests/tables.test.ts"]);
	const shortest = renderPanel(model, 47, { maxRows: 3 }).map(plain);
	assert.deepEqual(detailRows(shortest), ["⡿ checking 0:42"]);
});

test("a settled request stays one row in the rail; /dock lists the steps with their lines (S60, S52)", () => {
	const odd = { steps: detailOdd().steps.map((step) => ({ ...step, state: "done" as const, frame: undefined, scan: undefined })), settled: true, totalSeconds: 145 };
	odd.steps[2].detail = { text: "ran node --test tests/tables.test.ts" };
	assert.deepEqual(oddText(renderPanel({ session: { project: "p" }, odd }, 47).map(plain)), ["✓ last request 2:25 · 3 phases"]);
	const lines = renderDock({ session: { project: "p" }, odd }, DOCK_WIDTH + 2, 200).lines.map((line) => plain(line).slice(1, -1));
	assert.deepEqual(oddText(lines).filter((line) => line !== "│"), ["✓ exploring 0:31", " read 3 files · 1 search", "✓ implementing 1:12", " edited lib/tables/ · 2 files", "✓ checking 0:42", " ran node --test tests/tables.test.ts"], "details indented under the label");
});

// --- what each RDD review is doing (S62) -------------------------------------------

/** RDD rows with their leading indent kept and inner runs of spaces collapsed. */
const rddRows = (lines: string[]) => sectionBody(lines, "RDD").map((line) => line.slice(2).replace(/ +│$/, "").replace(/(\S) {2,}(\S)/g, "$1 $2"));
const detailRdd = (): NonNullable<PanelModel["rdd"]> => ({
	reviews: [
		{ scope: "panel.ts +3", status: "approved", endedAt: ENDED, detail: "2 findings · none blocking · 1 lens" },
		{ scope: "odd-detail.ts +8", status: "reviewing", seconds: 151, detail: "closing · 7 findings, none blocking" },
	],
});

test("each review shows a muted line under it: the running step, a finished review's summary (S62)", () => {
	const raw = renderPanel({ session: { project: "p" }, spinner: 0, rdd: detailRdd() }, 47);
	const lines = raw.map(plain);
	assert.deepEqual(rddRows(lines), [`✓ panel.ts +3 approved ${hhmm(ENDED)}`, "  2 findings · none blocking · 1 lens", "│", "⠋ odd-detail.ts +8 reviewing… 2:31", "  closing · 7 findings, none blocking"]);
	const rowOf = (text: string) => raw[lines.findIndex((line) => line.includes(text))];
	for (const text of ["2 findings · none blocking · 1 lens", "closing · 7 findings, none blocking"]) {
		assert.ok(rowOf(text).includes(`${fgCode(palette.muted)}${text}`), `muted: ${text}`);
		assert.ok(!rowOf(text).includes(bgCode(palette.highlight)), `not highlighted: ${text}`);
	}
	const noDetail = renderPanel({ session: { project: "p" }, spinner: 0, rdd: { reviews: detailRdd().reviews.map(({ detail: _, ...review }) => review) } }, 47).map(plain);
	assert.deepEqual(rddRows(noDetail), [`✓ panel.ts +3 approved ${hhmm(ENDED)}`, "│", "⠋ odd-detail.ts +8 reviewing… 2:31"], "a review without a detail draws today's rows");
	const cut = rddRows(renderPanel({ session: { project: "p" }, rdd: { reviews: [{ scope: "a.ts", status: "reviewing", seconds: 1, detail: "starting · readability, reliability, resilience, risk" }] } }, 30).map(plain));
	assert.equal(cut.at(-1), "  starting · readability,…", "cut at the end");
	for (const width of [47, 30, 20, 12]) for (const line of renderPanel({ session: { project: "p" }, rdd: detailRdd() }, width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
});

test("short screens drop the finished reviews' lines with the spacers; the running step stays while RDD shows (S62)", () => {
	const model: PanelModel = { session: { project: "p" }, spinner: 0, rdd: detailRdd() };
	const full = renderPanel(model, 47);
	const noSpacers = renderPanel(model, 47, { maxRows: full.length - 1 }).map(plain);
	assert.deepEqual(rddRows(noSpacers), [`✓ panel.ts +3 approved ${hhmm(ENDED)}`, "⠋ odd-detail.ts +8 reviewing… 2:31", "  closing · 7 findings, none blocking"]);
});

// --- CI checks of the last pushed commit (S64) ---------------------------------------

/** CI rows with their leading indent kept and inner runs of spaces collapsed. */
const ciRows = (lines: string[]) => sectionBody(lines, "CI").map((line) => line.slice(2).replace(/ +│$/, "").replace(/(\S) {2,}(\S)/g, "$1 $2"));
const ciLine = (lines: string[], text: string) => lines.find((line) => plain(line).includes(text))!;
const CI_ENDED = Date.UTC(2026, 9, 31, 14, 2, 0);
const runningCi = (): NonNullable<PanelModel["ci"]> => ({
	sha: "e6f1ffd",
	endedAt: CI_ENDED,
	checks: [
		{ name: "build", state: "queued" },
		{ name: "lint", state: "passed", seconds: 34 },
		{ name: "tests", state: "running", seconds: 72 },
	],
});
const failedCi = (): NonNullable<PanelModel["ci"]> => ({
	sha: "e6f1ffd",
	endedAt: CI_ENDED,
	checks: [
		{ name: "build", state: "passed", seconds: 48 },
		{ name: "lint", state: "passed", seconds: 34 },
		{ name: "tests", state: "failed", seconds: 143, failedJob: "node-22 · Run npm test" },
	],
});
const passedCi = (): NonNullable<PanelModel["ci"]> => ({
	sha: "e6f1ffd",
	endedAt: CI_ENDED,
	checks: [
		{ name: "build", state: "passed", seconds: 48 },
		{ name: "lint", state: "passed", seconds: 34 },
		{ name: "tests", state: "passed", seconds: 161 },
	],
});

test("CI section: vivid blue title with the short sha muted on its right, after RDD and before agents; none without runs (S64)", () => {
	const lines = renderPanel({ session: { project: "p" }, footer: { cost: 0, rdd: "on" }, agents: samplePanelModel.agents, ci: passedCi() }, 47);
	const titles = lines.map(plain).filter((line) => line.startsWith("╭─ ")).map((line) => line.slice(3).split(" ")[0]);
	assert.deepEqual(titles, ["session", "ODD", "RDD", "CI", "agents", "todo"]);
	const title = lines.find((line) => plain(line).startsWith("╭─ CI"))!;
	assert.match(plain(title), /^╭─ CI ─+ e6f1ffd ─╮$/);
	assert.ok(title.includes(`${fgCode(panelVivid(palette.blue))}CI`), "title in vivid blue");
	assert.ok(title.includes(`${fgCode(palette.muted)}e6f1ffd`), "sha muted");
	assert.ok(!renderPanel({ session: { project: "p" } }, 47).some((line) => plain(line).startsWith("╭─ CI")), "no CI: no section");
});

test("CI all passed: one `✓ N checks passed` row with the end HH:MM, then a muted line with the names and the longest run (S64)", () => {
	const lines = renderPanel({ session: { project: "p" }, ci: passedCi() }, 47);
	assert.deepEqual(ciRows(lines.map(plain)), [`✓ 3 checks passed ${hhmm(CI_ENDED)}`, "  build, lint, tests · longest 2:41"]);
	assert.match(plain(ciLine(lines, "checks passed")), new RegExp(`^│ ✓ 3 checks passed +${hhmm(CI_ENDED)} │$`));
	const row = ciLine(lines, "checks passed");
	assert.ok(row.includes(`${fgCode(palette.green)}✓`), "green check");
	assert.ok(row.includes(`${fgCode(palette.text)}3 checks passed`), "words in the text color");
	assert.ok(row.includes(`${fgCode(palette.muted)}${hhmm(CI_ENDED)}`), "muted time");
	assert.ok(ciLine(lines, "longest").includes(`${fgCode(palette.muted)}build, lint, tests · longest 2:41`), "muted line");
	const one = renderPanel({ session: { project: "p" }, ci: { sha: "e6f1ffd", endedAt: CI_ENDED, checks: [{ name: "tests", state: "passed", seconds: 9 }] } }, 47).map(plain);
	assert.deepEqual(ciRows(one), [`✓ 1 check passed ${hhmm(CI_ENDED)}`, "  tests · longest 0:09"], "singular");
});

test("CI running: one row per workflow; running highlighted with the blue spinner, bold name, muted `running…` and m:ss; queued faint ○ (S64)", () => {
	const lines = renderPanel({ session: { project: "p" }, spinner: 4, ci: runningCi() }, 47);
	assert.deepEqual(ciRows(lines.map(plain)), ["○ build queued", "✓ lint passed 0:34", "⠼ tests running… 1:12"]);
	const running = ciLine(lines, "tests");
	assert.match(plain(running), /^│▎⠼ tests running… +1:12 │$/);
	assert.ok(running.includes(HIGHLIGHT_BG), "highlighted");
	assert.ok(running.includes(`${fgCode(palette.blue)}⠼`), "blue spinner");
	assert.ok(running.includes(`\x1b[1m${fgCode(palette.text)}tests`), "bold name");
	assert.ok(running.includes(`${fgCode(palette.muted)}running…`), "muted state");
	assert.ok(running.includes(`${fgCode(palette.text)}1:12`), "time");
	const queued = ciLine(lines, "build");
	assert.match(plain(queued), /^│ ○ build +queued │$/);
	assert.ok(queued.includes(`${fgCode(palette.faint)}○`), "faint circle");
	assert.ok(queued.includes(`${fgCode(palette.muted)}build`), "muted name");
	assert.ok(queued.includes(`${fgCode(palette.muted)}queued`), "muted queued");
	assert.ok(!queued.includes(HIGHLIGHT_BG), "only the running row is highlighted");
	const passed = ciLine(lines, "lint");
	assert.match(plain(passed), /^│ ✓ lint passed +0:34 │$/);
	assert.ok(passed.includes(`${fgCode(palette.green)}✓`) && passed.includes(`${fgCode(palette.text)}lint`), "green check, name");
	assert.ok(passed.includes(`${fgCode(palette.muted)}passed`) && passed.includes(`${fgCode(palette.muted)}0:34`), "muted passed and duration");
	const still = renderPanel({ session: { project: "p" }, ci: runningCi() }, 47).map(plain);
	assert.equal(ciRows(still)[2], "⠹ tests running… 1:12", "still frame without a spinner");
});

test("CI failed and cancelled: red ✗ with red `failed` and a muted line naming the job; cancelled faint and muted (S64)", () => {
	const ci = failedCi();
	ci.checks.splice(1, 0, { name: "deploy", state: "cancelled", seconds: 10 });
	const lines = renderPanel({ session: { project: "p" }, ci }, 47);
	assert.deepEqual(ciRows(lines.map(plain)), ["✓ build passed 0:48", "- deploy cancelled 0:10", "✓ lint passed 0:34", "✗ tests failed 2:23", "  node-22 · Run npm test"]);
	const failed = ciLine(lines, "tests");
	assert.ok(failed.includes(`${fgCode(palette.red)}✗`), "red cross");
	assert.ok(failed.includes(`${fgCode(palette.text)}tests`), "name");
	assert.ok(failed.includes(`${fgCode(palette.red)}failed`), "red failed");
	assert.ok(failed.includes(`${fgCode(palette.muted)}2:23`), "muted duration");
	assert.ok(ciLine(lines, "node-22").includes(`${fgCode(palette.muted)}node-22 · Run npm test`), "muted job line");
	const cancelled = ciLine(lines, "deploy");
	assert.ok(cancelled.includes(`${fgCode(palette.faint)}-`), "faint dash");
	assert.ok(cancelled.includes(`${fgCode(palette.muted)}deploy cancelled`), "muted name and word");
	assert.ok(cancelled.includes(`${fgCode(palette.muted)}0:10`), "muted duration");
	const noJob = renderPanel({ session: { project: "p" }, ci: { sha: "e6f1ffd", checks: [{ name: "tests", state: "failed", seconds: 1 }] } }, 47).map(plain);
	assert.deepEqual(ciRows(noJob), ["✗ tests failed 0:01"], "no job known: no line");
});

test("CI lists at most 6 workflows, then `+N more` (S64)", () => {
	const checks = Array.from({ length: 8 }, (_, index) => ({ name: `w${index}`, state: "queued" as const }));
	assert.deepEqual(ciRows(renderPanel({ session: { project: "p" }, ci: { sha: "e6f1ffd", checks } }, 47).map(plain)), [...checks.slice(0, 6).map((check) => `○ ${check.name} queued`), "  +2 more"]);
	const six = checks.slice(0, 6);
	assert.equal(ciRows(renderPanel({ session: { project: "p" }, ci: { sha: "e6f1ffd", checks: six } }, 47).map(plain)).length, 6, "six fit without a more row");
});

test("CI rows fit 47, 30 and 20 columns (S64)", () => {
	const long = failedCi();
	long.checks[0] = { name: "a-really-long-workflow-name-that-never-ends", state: "failed", seconds: 3_700, failedJob: "a-very-long-job-name · a step name that goes on and on" };
	for (const ci of [runningCi(), failedCi(), passedCi(), long]) {
		for (const width of [47, 30, 20]) {
			const lines = renderPanel({ session: { project: "p" }, spinner: 0, ci }, width);
			assert.ok(lines.some((line) => plain(line).startsWith("╭─ CI")), `${width}: CI shown`);
			for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
		}
	}
	assert.deepEqual(ciRows(renderPanel({ session: { project: "p" }, ci: long }, 30).map(plain)).slice(0, 2), ["✗ a-really-long-wor… 61:40", "  a-very-long-job-name · …"], "name and job line cut at the end");
});

test("short screens drop the muted CI lines with the spacers, then changes, then the CI section (S64, S77)", () => {
	const changes: PanelModel["changes"] = [{ status: "M", path: "lib/ci.ts", added: 1, removed: 0 }];
	const has = (lines: string[], title: string) => lines.some((line) => plain(line).startsWith(`╭─ ${title}`));
	const cases: [NonNullable<PanelModel["ci"]>, string[]][] = [
		[failedCi(), ["✓ build passed 0:48", "✓ lint passed 0:34", "✗ tests failed 2:23"]],
		[passedCi(), [`✓ 3 checks passed ${hhmm(CI_ENDED)}`]],
	];
	for (const [ci, short] of cases) {
		const model: PanelModel = { session: { project: "p" }, ci, changes };
		const full = renderPanel(model, 47);
		const noLines = renderPanel(model, 47, { maxRows: full.length - 1 });
		assert.deepEqual(ciRows(noLines.map(plain)), short, "the muted lines drop first");
		assert.equal(noLines.length, full.length - 1);
		assert.ok(has(noLines, "changes"), "changes still there");
		const noChanges = renderPanel(model, 47, { maxRows: noLines.length - 1 });
		assert.ok(has(noChanges, "CI") && !has(noChanges, "changes"), "changes drops before CI");
		const noCi = renderPanel(model, 47, { maxRows: noChanges.length - 1 });
		assert.ok(!has(noCi, "CI"), "then CI");
	}
});

test("/dock draws the CI section like the rail (S64)", () => {
	const lines = renderDock({ session: { project: "p" }, ci: failedCi() }, DOCK_WIDTH + 2, 200).lines.map((line) => plain(line).slice(1, -1));
	assert.deepEqual(ciRows(lines), ["✓ build passed 0:48", "✓ lint passed 0:34", "✗ tests failed 2:23", "  node-22 · Run npm test"]);
});


// --- S66: CI review findings ------------------------------------------------------

test("CI all passed without any known duration: the muted line is only the workflow names, without ` · longest` (S66)", () => {
	const ci: NonNullable<PanelModel["ci"]> = { sha: "e6f1ffd", endedAt: CI_ENDED, checks: [{ name: "build", state: "passed" }, { name: "lint", state: "passed" }] };
	assert.deepEqual(ciRows(renderPanel({ session: { project: "p" }, ci }, 47).map(plain)), [`✓ 2 checks passed ${hhmm(CI_ENDED)}`, "  build, lint"]);
	ci.checks[1] = { name: "lint", state: "passed", seconds: 0 };
	assert.deepEqual(ciRows(renderPanel({ session: { project: "p" }, ci }, 47).map(plain)), [`✓ 2 checks passed ${hhmm(CI_ENDED)}`, "  build, lint · longest 0:00"], "a known 0:00 still shows");
});

test("CI held past 90 s without a successful read: a running check keeps the still frame while another spinner turns (S66)", () => {
	const lines = renderPanel({ session: { project: "p" }, spinner: 4, agents: samplePanelModel.agents, ci: { ...runningCi(), stale: true } }, 47).map(plain);
	assert.deepEqual(ciRows(lines), ["○ build queued", "✓ lint passed 0:34", "⠹ tests running… 1:12"]);
	assert.equal(ciRows(renderPanel({ session: { project: "p" }, spinner: 4, ci: runningCi() }, 47).map(plain))[2], "⠼ tests running… 1:12", "a fresh read still spins");
});

// The profile row the fork bridge fed went with S86; S99 brings it back from
// Gentle Shell's own registries (tests above), so only lens is pinned out here.
test("the panel knows no lens section: such data in the model changes nothing (S86)", () => {
	const lens = { files: [{ path: "src/user.ts", problems: [{ severity: "error", line: 4, rule: "typescript:2551", message: "nope" }] }] };
	const model: PanelModel = { session: { project: "p" }, changes: [], ...({ lens } as object) };
	const lines = renderPanel(model, 47).map(plain);
	assert.deepEqual(lines.filter((line) => line.startsWith("╭─ ")).map((line) => line.slice(3).split(" ")[0]), ["session", "ODD", "todo", "changes"]);
	assert.deepEqual(renderDock(model, 57, 200).lines.map(plain).filter((line) => line.includes("lens")), []);
});

// --- S77: changes and CI drop one at a time ------------------------------------------

/** Every row from the session box down: the logo rows never change here. */
const belowLogo = (lines: string[]) => {
	const rows = lines.map(plain);
	return rows.slice(rows.findIndex((line) => line.startsWith("╭─ session")));
};
const S77_TOP = [
	"╭─ session ───────────────────────────────────╮",
	"│ project  p                                  │",
	"╰─────────────────────────────────────────────╯",
	"╭─ ODD ───────────────────────────────────────╮",
	"│ ○ ready · phases show while I work          │",
	"╰─────────────────────────────────────────────╯",
];
/** The todo section with no tasks, after the CI and before changes; it never drops (S94). */
const S77_TODO = [
	"╭─ todo ──────────────────────────────────────╮",
	"│ ○ no tasks · the list shows while I plan    │",
	"╰─────────────────────────────────────────────╯",
];
const s77Model = (ci: NonNullable<PanelModel["ci"]>): PanelModel => ({ session: { project: "p" }, ci, changes: [{ status: "M", path: "lib/ci.ts", added: 1, removed: 0 }] });
const S77_FAILED = [
	"╭─ CI ────────────────────────────── e6f1ffd ─╮",
	"│ ✓ build passed                         0:48 │",
	"│ ✓ lint passed                          0:34 │",
	"│ ✗ tests failed                         2:23 │",
	"╰─────────────────────────────────────────────╯",
];
const S77_RUNNING = [
	"╭─ CI ────────────────────────────── e6f1ffd ─╮",
	"│ ○ build                              queued │",
	"│ ✓ lint passed                          0:34 │",
	"│▎⠹ tests running…                       1:12 │",
	"╰─────────────────────────────────────────────╯",
];

test("short screens, 1-3 rows over: only changes leaves; CI stays (S77)", () => {
	const passedRows = ["╭─ CI ────────────────────────────── e6f1ffd ─╮", `│ ✓ 3 checks passed                     ${hhmm(CI_ENDED)} │`, "╰─────────────────────────────────────────────╯"];
	for (const [ci, rows] of [[passedCi(), passedRows], [failedCi(), S77_FAILED]] as const) {
		const model = s77Model(ci);
		const noLines = renderPanel(model, 47, { maxRows: renderPanel(model, 47).length - 1 });
		for (const over of [1, 2, 3]) {
			const lines = renderPanel(model, 47, { maxRows: noLines.length - over });
			assert.deepEqual(belowLogo(lines), [...S77_TOP, ...rows, ...S77_TODO], `${over} over`);
			assert.equal(lines.length, noLines.length - 3, "only the changes frame left");
		}
	}
});

test("short screens, more rows over: an all-passed CI leaves after changes; a running or failed CI is the last to go (S77)", () => {
	const passedRows = ["╭─ CI ────────────────────────────── e6f1ffd ─╮", `│ ✓ 3 checks passed                     ${hhmm(CI_ENDED)} │`, "╰─────────────────────────────────────────────╯"];
	// Three rows short: the changes frame leaves (a muted CI line alone would not do).
	for (const [ci, rows] of [[passedCi(), passedRows], [failedCi(), S77_FAILED], [runningCi(), S77_RUNNING]] as const) {
		const model = s77Model(ci);
		const noChanges = renderPanel(model, 47, { maxRows: renderPanel(model, 47).length - 3 });
		assert.deepEqual(belowLogo(noChanges), [...S77_TOP, ...rows, ...S77_TODO], "changes gone, the CI stays");
		assert.deepEqual(belowLogo(renderPanel(model, 47, { maxRows: noChanges.length - 1 })), [...S77_TOP, ...S77_TODO], "then the CI, passed or live, is the last to go");
	}
});

// --- S87: 4.6.0 subagent tasks next to the jobs ----------------------------------

test("S87 a subagent task uses the job row shape: a waiting task gets an amber ! on a highlighted row; done, running and model labels as for jobs", () => {
	const model: PanelModel = {
		session: { project: "app" },
		agents: [
			{ name: "job-1", task: "npm test", state: "running", startedAt: 1 },
			{ id: "task:t1", name: "explore", task: "map footer", state: "waiting", startedAt: 2, model: "anthropic/claude-opus-5-5", effort: "high" },
			{ id: "task:t2", name: "verify", task: "check PR", state: "done", model: "anthropic/claude-sonnet-4-5" },
		],
	};
	const lines = renderPanel(model, 47);
	const rows = sectionBody(lines.map(plain), "agents").map((line) => line.replace(/ +│$/, " │").replace(/ {2,}/g, "  "));
	assert.deepEqual(rows, ["│ ⠹ job-1 npm test │", "│▎! explore map footer  opus · high │", "│ ✓ verify check PR  sonnet │"]);
	const waiting = lines.find((line) => plain(line).includes("explore"))!;
	assert.ok(waiting.includes(`${fgCode(palette.amber)}!`), "amber ! like RDD's needs-your-OK row");
	assert.ok(waiting.includes(HIGHLIGHT_BG), "highlighted");
	assert.ok(!lines.find((line) => plain(line).includes("job-1"))!.includes(HIGHLIGHT_BG), "a running job row is not");
});

test("S87 the agents card lists waiting tasks with running ones, with the ! glyph, and counts both", () => {
	const agents: PanelModel["agents"] = [
		{ name: "job-1", task: "npm test", state: "running", startedAt: NOW - 61_000 },
		{ id: "task:t1", name: "explore", task: "map footer", state: "waiting", startedAt: NOW - 5_000, model: "anthropic/claude-opus-5-5", effort: "high" },
		{ id: "task:t2", name: "verify", task: "check PR", state: "done" },
	];
	const card = renderAgentsCard(agents, 53, 1, NOW).map(plain);
	assert.match(card[0], /^╭─ agents ─+ 2 ─╮$/);
	assert.match(card[1], /^│ ⠙ job-1 +npm test +1:01 │$/);
	assert.match(card[2], /^│ ! explore +map footer +0:05 opus · high │$/);
	assert.equal(card.length, 4);
});

// --- Vivid labels S2: section titles and their counters --------------------------

test("section titles and their counters draw vivid on the rail, /dock and the narrow cards; frames stay neutral: faded on the rail and /dock, flat gray on the cards (S2, sidebar-chrome 02)", () => {
	const model: PanelModel = {
		...samplePanelModel,
		headsUp: [{ kind: "unpushed", text: "1 commit not pushed" }],
		ci: { sha: "fb7ca9d", checks: [{ name: "test", state: "running", seconds: 12 }] },
	};
	const titles: [string, (typeof palette)[keyof typeof palette]][] = [
		["session", palette.teal], ["heads-up", palette.red], ["ODD", palette.amber], ["RDD", palette.rose],
		["CI", palette.blue], ["agents", palette.lilac], ["todo", palette.coral], ["changes", palette.green],
	];
	const titleLine = (lines: string[], title: string) => lines.find((line) => plain(line).trim().startsWith(`╭─ ${title} `))!;
	for (const lines of [renderPanel(model, 55), renderDock(model, DOCK_WIDTH + 2, 200).lines]) {
		for (const [title, color] of titles) {
			const line = titleLine(lines, title);
			assert.ok(line.includes(`\x1b[1m${fgCode(panelVivid(color))}${title}`), `${title} bold in its vivid color`);
			assert.ok(!line.includes(fgCode(color)), `${title}: no pastel left on the top rule`);
			assert.match(line, /\x1b\[38;2;(\d+);\1;\1m╭\x1b\[39m\x1b\[38;2;(\d+);\2;\2m─\x1b\[39m /, `${title}: the frame stays a neutral gray, faded`);
			assert.ok(!line.includes(`${fgCode(palette.frame)}╭`), `${title}: no flat frame on the rail`);
		}
		assert.ok(titleLine(lines, "todo").includes(`${fgCode(panelVivid(palette.coral))}3/7`), "the todo counter vivid");
		assert.ok(titleLine(lines, "RDD").includes(`\x1b[1m${fgCode(panelVivid(palette.green))}on`), "the RDD switch vivid");
		// Gray counters have no hue to raise: they stay muted.
		assert.ok(titleLine(lines, "changes").includes(`${fgCode(palette.muted)}1 to commit`), "the changes count stays muted");
		assert.ok(titleLine(lines, "CI").includes(`${fgCode(palette.muted)}fb7ca9d`), "the CI sha stays muted");
	}
	const todoCard = renderTodoCard(model.todo, 64);
	assert.ok(todoCard[0].includes(`\x1b[1m${fgCode(panelVivid(palette.coral))}todo`) && todoCard[0].includes(`${fgCode(panelVivid(palette.coral))}3/7`), "the todo card's title and counter vivid");
	const agentsCard = renderAgentsCard(model.agents, 53, 1, 0);
	assert.ok(agentsCard[0].includes(`\x1b[1m${fgCode(panelVivid(palette.lilac))}agents`) && agentsCard[0].includes(`${fgCode(panelVivid(palette.lilac))}1`), "the agents card's title and counter vivid");
	assert.ok(!agentsCard[0].includes(fgCode(palette.lilac)), "no pastel lilac left on the agents card's top rule");
	for (const card of [todoCard, agentsCard]) assert.ok(card[0].startsWith(`${fgCode(palette.frame)}╭─ `), "the cards' frames stay flat gray");
	// The rows keep their own colors.
	assert.ok(renderTodoCard(model.todo, 64)[2].includes(`\x1b[1m${fgCode(palette.text)}Confirm CI is green`), "the active task keeps the text color");
});

// Rail chrome (design sidebar-chrome/02, faded boxes): boxed sections whose frames fade into the background, no group labels.
const boxed = (model: PanelModel, width = 47) => {
	const lines = renderPanel(model, width).map(plain);
	return lines.slice(lines.findIndex((line) => line.startsWith("╭─ session")));
};

/** The red channel of every `glyphs` cell in `line`, in order. */
const frameLight = (line: string, glyphs: string) =>
	[...line.matchAll(new RegExp(`\\x1b\\[38;2;(\\d+);\\d+;\\d+m([${glyphs}]+)`, "g"))].flatMap((match) => [...match[2]].map(() => Number(match[1])));

test("rail sections are boxes again, edge to edge with no gap rows (sidebar-chrome 02)", () => {
	const row = (text: string) => `│ ${text.padEnd(43)} │`;
	const bottom = `╰${"─".repeat(45)}╯`;
	assert.deepEqual(boxed({ session: { project: "p" }, footer: { cost: 0.012, rdd: "on" } } as PanelModel), [
		`╭─ session ${"─".repeat(35)}╮`,
		row("project  p"),
		row("cost     $0.012"),
		bottom,
		`╭─ ODD ${"─".repeat(39)}╮`,
		row("○ ready · phases show while I work"),
		bottom,
		`╭─ RDD ${"─".repeat(34)} on ─╮`,
		row("● watching · reviews high-risk changes"),
		bottom,
		`╭─ todo ${"─".repeat(38)}╮`,
		row("○ no tasks · the list shows while I plan"),
		bottom,
	]);
});

test("the session section has no where, usage or connections label rows (sidebar-chrome 02)", () => {
	const session = { project: "p", contextPercent: 5, profile: "claude", memory: { state: "connected", saved: 0 }, mcp: [] } as PanelModel["session"];
	const lines = boxed({ session, footer: { cost: 0.012 } } as PanelModel);
	assert.deepEqual(lines.slice(1, 6).map((line) => line.slice(1).trim().split(/ +/)[0]), ["project", "context", "profile", "memory", "mcp"]);
	assert.ok(!lines.some((line) => /(where|usage|connections) ──/.test(line)));
});

test("a highlighted rail row keeps its bar and background inside the box sides (sidebar-chrome 02)", () => {
	const lines = renderPanel({ session: { project: "p" }, todo: { done: 0, total: 2, active: "Draw headers", more: 0 } } as PanelModel, 47);
	const active = lines.find((line) => plain(line).includes("Draw headers"))!;
	assert.ok(plain(active).startsWith("│▎"), plain(active));
	assert.ok(plain(active).endsWith("│"), plain(active));
	assert.ok(active.includes("\x1b[49m"));
	assert.equal(visibleWidth(active), 47);
});

test("the narrow todo card above the prompt stays boxed in the flat frame color (sidebar-chrome 02 changes the rail only)", () => {
	const raw = renderTodoCard({ done: 1, total: 2, active: "Draw headers", more: 0 }, 40);
	const card = raw.map(plain);
	assert.ok(card[0].startsWith("╭─ todo"));
	assert.ok(card.at(-1)!.startsWith("╰"));
	assert.ok(raw[0].startsWith(fgCode(palette.frame)), JSON.stringify(raw[0]));
	assert.ok(raw.at(-1)!.startsWith(fgCode(palette.frame)), JSON.stringify(raw.at(-1)));
});

// The rail's divider (sidebar-chrome): a `│` in the first column, brightest at the middle, fading out at the top and bottom.
const dividerBrightness = (line: string) => {
	const match = /^\x1b\[38;2;(\d+);(\d+);(\d+)m│/.exec(line);
	return match ? Number(match[1]) : plain(line)[0] === " " ? 0 : NaN;
};

test("the rail fills the screen rows with the divider in the first column, a blank, then the panel two columns narrower (sidebar-chrome)", () => {
	const model = { session: { project: "p" } } as PanelModel;
	const rail = renderRail(model, 47, { maxRows: 30 });
	const panel = renderPanel(model, 45, { maxRows: 30 });
	assert.equal(rail.length, 30);
	for (const line of rail) assert.equal(visibleWidth(line), 47, JSON.stringify(plain(line)));
	for (const line of rail) assert.equal(plain(line)[1], " ", JSON.stringify(plain(line)));
	assert.deepEqual(rail.slice(0, panel.length).map((line) => plain(line).slice(2).trimEnd()), panel.map((line) => plain(line).trimEnd()));
	assert.deepEqual(rail.slice(panel.length).map((line) => plain(line).slice(2).trim()), Array(30 - panel.length).fill(""));
});

test("the divider is brightest at the middle and fades into the background at the top and bottom (sidebar-chrome)", () => {
	const rail = renderRail({ session: { project: "p" } } as PanelModel, 47, { maxRows: 30 });
	const light = rail.map(dividerBrightness);
	assert.ok(light.every((value) => !Number.isNaN(value)), "every first cell is a divider or blank");
	assert.equal(light[0], 0);
	assert.equal(light[29], 0);
	assert.deepEqual(light, [...light].reverse());
	assert.equal(Math.max(...light), light[14]);
	for (let index = 1; index <= 14; index++) assert.ok(light[index] >= light[index - 1], `row ${index} dims toward the top`);
});

test("without a known screen height the divider spans the panel alone (sidebar-chrome)", () => {
	const model = { session: { project: "p" } } as PanelModel;
	assert.equal(renderRail(model, 47).length, renderPanel(model, 45).length);
});

test("box borders fade like the divider: brightest at the middle of each edge, corners into the background (sidebar-chrome)", () => {
	const session = { project: "p", contextPercent: 5, profile: "claude", memory: { state: "connected", saved: 0 }, mcp: [] } as PanelModel["session"];
	const lines = renderPanel({ session, footer: { cost: 0 } } as PanelModel, 47);
	const top = lines.findIndex((line) => plain(line).startsWith("╭─ session"));
	const end = lines.findIndex((line, index) => index > top && plain(line).startsWith("╰"));
	const bottom = frameLight(lines[end], "╰─╯");
	assert.equal(bottom.length, 47);
	assert.deepEqual(bottom, [...bottom].reverse(), "the bottom border is symmetric");
	assert.ok(bottom[0] <= 0x18, "the bottom corners start in the background");
	assert.ok(Math.max(...bottom) > 0x50, "the bottom border lights up in the middle");
	for (let index = 1; index <= 23; index++) assert.ok(bottom[index] >= bottom[index - 1], `bottom cell ${index} dims toward the corners`);
	const [topLeft] = frameLight(lines[top], "╭");
	const [topRight] = frameLight(lines[top], "╮");
	assert.ok(topLeft <= 0x18, `top-left corner ${topLeft}`);
	assert.ok(topRight <= 0x18, `top-right corner ${topRight}`);
	const body = lines.slice(top + 1, end);
	const left = body.map((line) => Number(/^\x1b\[38;2;(\d+);\d+;\d+m│/.exec(line)![1]));
	const right = body.map((line) => Number(/\x1b\[38;2;(\d+);\d+;\d+m│\x1b\[39m$/.exec(line)![1]));
	assert.deepEqual(left, [...left].reverse(), "the sides are symmetric top to bottom");
	assert.equal(Math.max(...left), left[Math.floor(left.length / 2)], "the sides are brightest at the middle row");
	assert.deepEqual(right, left, "both sides match on each row");
});

// --- Look settings S3/S6: frame styles (faded, classic, none) ---------------------

const tiny: PanelModel = { session: { project: "p" }, footer: { cost: 0.012, rdd: "on" } } as PanelModel;
/** The rail's lines from the session section on, logo left out. */
const fromSession = (lines: string[]) => lines.slice(lines.findIndex((line) => /^\s*(╭─ )?session /.test(plain(line))));

test("without a frames option the panel, the rail and /dock draw today's faded boxes byte for byte (S6)", () => {
	for (const model of [samplePanelModel, longModel, tiny]) {
		assert.deepEqual(renderPanel(model, 47), renderPanel(model, 47, { frames: "faded" }));
		assert.deepEqual(renderRail(model, 47, { maxRows: 60 }), renderRail(model, 47, { maxRows: 60, frames: "faded" }));
		assert.deepEqual(renderDock(model, 57, 40), renderDock(model, 57, 40, 0, { frames: "faded" }));
	}
});

test("classic frames draw today's box geometry in the flat frame gray (S3)", () => {
	const row = (text: string) => `│ ${text.padEnd(43)} │`;
	const bottom = `╰${"─".repeat(45)}╯`;
	const raw = fromSession(renderPanel(tiny, 47, { frames: "classic" }));
	assert.deepEqual(raw.map(plain), [
		`╭─ session ${"─".repeat(35)}╮`,
		row("project  p"),
		row("cost     $0.012"),
		bottom,
		`╭─ ODD ${"─".repeat(39)}╮`,
		row("○ ready · phases show while I work"),
		bottom,
		`╭─ RDD ${"─".repeat(34)} on ─╮`,
		row("● watching · reviews high-risk changes"),
		bottom,
		`╭─ todo ${"─".repeat(38)}╮`,
		row("○ no tasks · the list shows while I plan"),
		bottom,
	]);
	const flat = fgCode(palette.frame);
	for (const line of raw) {
		assert.ok(line.startsWith(flat), JSON.stringify(line));
		assert.equal(frameLight(line, "╭╮╰╯─│").filter((red) => red !== palette.frame[0]).length, 0, `only flat frame glyphs: ${JSON.stringify(plain(line))}`);
	}
	const title = raw.find((line) => plain(line).startsWith("╭─ RDD"))!;
	assert.ok(title.includes(`\x1b[1m${fgCode(panelVivid(palette.rose))}RDD`), "the title bold in its vivid color");
	assert.ok(title.includes(`\x1b[1m${fgCode(panelVivid(palette.green))}on`), "the right value styled as today");
});

test("no-box frames draw each title on a rule, rows two cells in and one blank row between sections (S3)", () => {
	const row = (text: string) => `  ${text}`.padEnd(47);
	assert.deepEqual(fromSession(renderPanel(tiny, 47, { frames: "none" })).map(plain), [
		` session ${"─".repeat(37)} `,
		row("project  p"),
		row("cost     $0.012"),
		" ".repeat(47),
		` ODD ${"─".repeat(41)} `,
		row("○ ready · phases show while I work"),
		" ".repeat(47),
		` RDD ${"─".repeat(38)} on `,
		row("● watching · reviews high-risk changes"),
		" ".repeat(47),
		` todo ${"─".repeat(40)} `,
		row("○ no tasks · the list shows while I plan"),
	]);
});

test("no-box frames draw no box glyph; the title stays vivid and the rule fades symmetrically (S3)", () => {
	for (const model of [samplePanelModel, longModel, tiny]) {
		for (const line of fromSession(renderPanel(model, 47, { frames: "none" })).map(plain)) {
			assert.ok(!/[╭╮╰╯]/.test(line), line);
			assert.ok(!/^│|│$/.test(line), `no side frame: ${line}`);
		}
	}
	const raw = fromSession(renderPanel(tiny, 47, { frames: "none" }));
	const header = raw.find((line) => plain(line).startsWith(" RDD "))!;
	assert.ok(header.includes(`\x1b[1m${fgCode(panelVivid(palette.rose))}RDD`), "the title bold in its vivid color");
	assert.ok(header.includes(`\x1b[1m${fgCode(panelVivid(palette.green))}on`), "the right value styled as today");
	const rule = frameLight(header, "─");
	assert.equal(rule.length, 38);
	assert.deepEqual(rule, [...rule].reverse(), "the rule is symmetric");
	assert.ok(rule[0] <= 0x18 && rule.at(-1)! <= 0x18, "both ends sink into the background");
	assert.ok(Math.max(...rule) > 0x50, "the rule lights up in the middle");
	for (let index = 1; index < rule.length / 2; index++) assert.ok(rule[index] >= rule[index - 1], `rule cell ${index} dims toward the ends`);
});

test("a no-box highlighted row keeps the boxed column layout: bar, text, then a plain margin (S3)", () => {
	const lines = renderPanel(samplePanelModel, 47, { frames: "none" });
	const active = lines.find((line) => line.includes(HIGHLIGHT_BG) && plain(line).includes("Confirm CI is green"))!;
	assert.ok(active.startsWith(` ${HIGHLIGHT_BG}${fgCode(palette.pink)}▎`), JSON.stringify(active));
	assert.ok(active.endsWith(" \x1b[49m "), JSON.stringify(active));
	assert.equal(visibleWidth(active), 47);
	const boxedActive = renderPanel(samplePanelModel, 47).find((line) => plain(line).includes("Confirm CI is green"))!;
	assert.equal(plain(active), ` ${plain(boxedActive).slice(1, -1)} `, "same columns as the boxed row");
});

test("no-box frames on a short screen drop the blank rows between sections first; the other styles keep today's steps (S3)", () => {
	const full = renderPanel(samplePanelModel, 47, { frames: "none" });
	const blank = " ".repeat(47);
	assert.ok(full.map(plain).includes(blank));
	assert.deepEqual(renderPanel(samplePanelModel, 47, { frames: "none", maxRows: full.length }), full, "it fits: blank rows drawn");
	const short = renderPanel(samplePanelModel, 47, { frames: "none", maxRows: full.length - 1 });
	assert.deepEqual(short, full.filter((line) => plain(line) !== blank), "only the blank rows left, the spacers stay");
	const shorter = renderPanel(samplePanelModel, 47, { frames: "none", maxRows: short.length - 1 }).map(plain);
	assert.ok(!shorter.includes(blank) && shorter.length < short.length - 1, "then today's steps");
	for (const frames of ["faded", "classic"] as const) {
		const boxedFull = renderPanel(samplePanelModel, 47, { frames });
		const boxedShort = renderPanel(samplePanelModel, 47, { frames, maxRows: boxedFull.length - 1 }).map(plain);
		assert.deepEqual(boxedShort, renderPanel(samplePanelModel, 47, { maxRows: boxedFull.length - 1 }).map(plain), `${frames}: today's first step`);
	}
});

test("the rail keeps its fading divider for every frame style, and /dock honors frames (S3)", () => {
	for (const frames of ["faded", "classic", "none"] as const) {
		const rail = renderRail(tiny, 47, { maxRows: 30, frames });
		const panel = renderPanel(tiny, 45, { maxRows: 30, frames });
		assert.equal(rail.length, 30);
		assert.deepEqual(rail.map(dividerBrightness), renderRail(tiny, 47, { maxRows: 30 }).map(dividerBrightness), `${frames}: same divider`);
		assert.deepEqual(rail.slice(0, panel.length).map((line) => plain(line).slice(2)), panel.map((line) => plain(line).padEnd(45)));
		const dock = renderDock(samplePanelModel, 57, 200, 0, { frames }).lines.map((line) => plain(line).slice(1, -1).trimEnd());
		const expected = renderPanel(samplePanelModel, 55, { todoExpanded: true, listsExpanded: true, oddExpanded: true, frames }).map((line) => plain(line).trimEnd());
		assert.deepEqual(dock.slice(DOCK_TOP_ROWS, DOCK_TOP_ROWS + expected.length), expected, `${frames}: /dock draws the panel in that style`);
	}
});

test("the narrow todo and agents cards stay flat boxes whatever the frame style (S3)", () => {
	// The cards take no frame option: they are the same as before for every look.
	assert.ok(renderTodoCard(samplePanelModel.todo, 40)[0].startsWith(`${fgCode(palette.frame)}╭─ `));
	assert.ok(renderAgentsCard(samplePanelModel.agents, 40, 1, 0)[0].startsWith(`${fgCode(palette.frame)}╭─ `));
});

for (const frames of ["faded", "classic", "none"] as const) {
	test(`every ${frames} line fits the width, every section line fills it, sample and long models (S3)`, () => {
		for (const width of [55, 47, 40, 30, 20]) {
			for (const model of [samplePanelModel, longModel, tiny]) {
				const lines = renderPanel(model, width, { frames });
				for (const line of lines) assert.ok(visibleWidth(line) <= width, `${frames} ${width}: ${JSON.stringify(plain(line))}`);
				for (const line of fromSession(lines)) assert.equal(visibleWidth(line), width, `${frames} ${width}: ${JSON.stringify(plain(line))}`);
				for (const line of renderRail(model, width, { frames, maxRows: 80 })) assert.equal(visibleWidth(line), width, `rail ${frames} ${width}`);
			}
		}
	});
}

test("no-box headers fall back like the boxed top border on narrow widths: the right value drops, then the title ellipsizes (S3)", () => {
	const header = (width: number, title: string) => plain(renderPanel(tiny, width, { frames: "none" }).find((line) => plain(line).startsWith(` ${title}`))!);
	assert.equal(header(12, "R"), ` RDD ${"─".repeat(3)} on `);
	assert.equal(header(10, "R"), ` RDD ─ on `, "one rule cell is enough");
	assert.equal(header(9, "R"), ` RDD ${"─".repeat(3)} `, "no room for the value: it drops");
	assert.equal(header(7, "R"), " RDD ─ ");
	assert.equal(header(8, "s"), " ses… ─ ", "the title ellipsizes to keep one rule cell");
});

// --- Look settings S4, S6: soft colors ---------------------------------------------

const lookModel: PanelModel = {
	...samplePanelModel,
	headsUp: [{ kind: "unpushed", text: "1 commit not pushed" }],
	ci: { sha: "fb7ca9d", checks: [{ name: "test", state: "running", seconds: 12 }] },
};

test("S4 soft colors: section titles and counters in their own pastel on the rail, /dock and the narrow cards, in every frame style", () => {
	const titles: [string, (typeof palette)[keyof typeof palette]][] = [
		["session", palette.teal], ["heads-up", palette.red], ["ODD", palette.amber], ["RDD", palette.rose],
		["CI", palette.blue], ["agents", palette.lilac], ["todo", palette.coral], ["changes", palette.green],
	];
	const titleLine = (lines: string[], title: string) => lines.find((line) => plain(line).replace(/^[│ ]+/, "").replace(/^╭─ /, "").startsWith(`${title} `))!;
	for (const frames of ["faded", "classic", "none"] as const) {
		const views = [renderPanel(lookModel, 55, { frames, colors: "soft" }), renderRail(lookModel, 57, { frames, colors: "soft" }), renderDock(lookModel, DOCK_WIDTH + 2, 200, 0, { frames, colors: "soft" }).lines];
		for (const lines of views) {
			for (const [title, color] of titles) {
				const line = titleLine(lines, title);
				assert.ok(line.includes(`\x1b[1m${fgCode(color)}${title}`), `${frames}: ${title} bold in its pastel`);
				assert.ok(!line.includes(fgCode(panelVivid(color))), `${frames}: ${title} no vivid tone`);
			}
			assert.ok(titleLine(lines, "todo").includes(`${fgCode(palette.coral)}3/7`), "the todo counter pastel");
			assert.ok(titleLine(lines, "RDD").includes(`\x1b[1m${fgCode(palette.green)}on`), "the RDD switch pastel");
		}
		assert.deepEqual(renderPanel(lookModel, 55, { frames, colors: "soft" }).map(plain), renderPanel(lookModel, 55, { frames }).map(plain), `${frames}: same words and layout`);
	}
	const todoCard = renderTodoCard(lookModel.todo, 64, undefined, "soft");
	assert.ok(todoCard[0].includes(`\x1b[1m${fgCode(palette.coral)}todo`) && todoCard[0].includes(`${fgCode(palette.coral)}3/7`), "the todo card pastel");
	const agentsCard = renderAgentsCard(lookModel.agents, 53, 1, 0, "soft");
	assert.ok(agentsCard[0].includes(`\x1b[1m${fgCode(palette.lilac)}agents`) && agentsCard[0].includes(`${fgCode(palette.lilac)}1`), "the agents card pastel");
	assert.ok(!agentsCard[0].includes(fgCode(panelVivid(palette.lilac))), "no vivid lilac on the agents card");
});

test("S6 omitting the colors draws vivid, byte for byte, on the rail, /dock and the narrow cards", () => {
	for (const frames of ["faded", "classic", "none"] as const) {
		for (const width of [55, 47, 30]) {
			assert.deepEqual(renderPanel(lookModel, width, { frames }), renderPanel(lookModel, width, { frames, colors: "vivid" }), `panel ${frames} ${width}`);
			assert.deepEqual(renderRail(lookModel, width, { frames, maxRows: 40 }), renderRail(lookModel, width, { frames, maxRows: 40, colors: "vivid" }), `rail ${frames} ${width}`);
		}
		assert.deepEqual(renderDock(lookModel, 60, 50, 0, { frames }), renderDock(lookModel, 60, 50, 0, { frames, colors: "vivid" }), `dock ${frames}`);
	}
	assert.deepEqual(renderTodoCard(lookModel.todo, 64, 1), renderTodoCard(lookModel.todo, 64, 1, "vivid"));
	assert.deepEqual(renderAgentsCard(lookModel.agents, 53, 1, 0), renderAgentsCard(lookModel.agents, 53, 1, 0, "vivid"));
	assert.ok(renderPanel(lookModel, 55).some((line) => line.includes(`\x1b[1m${fgCode(panelVivid(palette.coral))}todo`)), "vivid is today's panelVivid");
});

// Look settings S2: the rail logo options. The logo rows sit above the session section.
const LOGO_STYLES = ["braille", "text", "none"] as const;
const FRAME_STYLES = ["faded", "classic", "none"] as const;
const LOGO_PANEL_ROWS: Record<number, Record<(typeof LOGO_STYLES)[number], string[]>> = {
	55: {
		braille: ["  ⣤⠛⠛⠛ ⣿⠛⠛⠛ ⣿⣤ ⣿ ⠛⣿⣿⠛ ⣿   ⣿⠛⠛⠛ ⣤⠛⠛⠛ ⣿  ⣿ ⣿⠛⠛⠛ ⣿   ⣿", "  ⣿ ⠛⣿ ⣿⠛⠛  ⣿ ⠛⣿  ⣿⣿  ⣿   ⣿⠛⠛   ⠛⠛⣤ ⣿⠛⠛⣿ ⣿⠛⠛  ⣿   ⣿", "   ⠛⠛⠛ ⠛⠛⠛⠛ ⠛  ⠛  ⠛⠛  ⠛⠛⠛ ⠛⠛⠛⠛ ⠛⠛⠛  ⠛  ⠛ ⠛⠛⠛⠛ ⠛⠛⠛ ⠛⠛⠛"],
		text: ["  GENTLESHELL"],
		none: [],
	},
	47: {
		braille: [" ⣤⠛⠛⠛ ⣿⠛⠛ ⣿⣤ ⣿ ⠛⣿⠛ ⣿   ⣿⠛⠛ ⣤⠛⠛ ⣿ ⣿ ⣿⠛⠛ ⣿   ⣿", " ⣿ ⠛⣿ ⣿⠛  ⣿ ⠛⣿  ⣿  ⣿   ⣿⠛   ⠛⣤ ⣿⠛⣿ ⣿⠛  ⣿   ⣿", "  ⠛⠛⠛ ⠛⠛⠛ ⠛  ⠛  ⠛  ⠛⠛⠛ ⠛⠛⠛ ⠛⠛  ⠛ ⠛ ⠛⠛⠛ ⠛⠛⠛ ⠛⠛⠛"],
		text: ["  GENTLESHELL"],
		none: [],
	},
	45: {
		braille: ["⣤⠛⠛⠛ ⣿⠛⠛ ⣿⣤ ⣿ ⠛⣿⠛ ⣿   ⣿⠛⠛ ⣤⠛⠛ ⣿ ⣿ ⣿⠛⠛ ⣿   ⣿", "⣿ ⠛⣿ ⣿⠛  ⣿ ⠛⣿  ⣿  ⣿   ⣿⠛   ⠛⣤ ⣿⠛⣿ ⣿⠛  ⣿   ⣿", " ⠛⠛⠛ ⠛⠛⠛ ⠛  ⠛  ⠛  ⠛⠛⠛ ⠛⠛⠛ ⠛⠛  ⠛ ⠛ ⠛⠛⠛ ⠛⠛⠛ ⠛⠛⠛"],
		text: ["  GENTLESHELL"],
		none: [],
	},
	30: { braille: ["  G E N T L E S H E L L"], text: ["  GENTLESHELL"], none: [] },
	11: { braille: ["GENTLESHELL"], text: ["GENTLESHELL"], none: [] },
	5: { braille: [], text: [], none: [] },
};

test("S2 renderPanel opens with each logo style's exact rows, centered at most two columns in, then the session section", () => {
	for (const frames of FRAME_STYLES) {
		for (const [width, styles] of Object.entries(LOGO_PANEL_ROWS)) {
			const columns = Number(width);
			const bare = renderPanel(samplePanelModel, columns, { frames, logo: "none" });
			for (const [logo, rows] of Object.entries(styles)) {
				const lines = renderPanel(samplePanelModel, columns, { frames, logo: logo as (typeof LOGO_STYLES)[number] });
				assert.deepEqual(lines.slice(0, rows.length).map((line) => plain(line).trimEnd()), rows, `${logo} logo, ${frames} frames, width ${width}`);
				assert.deepEqual(lines.slice(rows.length), bare, `${logo} logo, ${frames} frames, width ${width}: the sections follow unchanged`);
			}
		}
	}
});

test("S2 with no logo the panel's first line is the session section header in each frame style", () => {
	const header = { faded: /^╭─ session ─+╮$/, classic: /^╭─ session ─+╮$/, none: /^ session ─+ $/ };
	for (const frames of FRAME_STYLES) {
		for (const width of [55, 47, 45, 30]) {
			const first = plain(renderPanel(samplePanelModel, width, { frames, logo: "none" })[0]);
			assert.match(first, header[frames], `${frames} at ${width}`);
			assert.equal(first.length, width, `${frames} at ${width}`);
		}
		assert.match(plain(renderRail(samplePanelModel, 47, { frames, logo: "none" })[0]), frames === "none" ? /^.  session ─+ $/ : /^. ╭─ session ─+╮$/, `rail, ${frames}`);
	}
});

test("S6 omitting logo is the braille logo, byte for byte, in renderPanel, renderRail and renderDock", () => {
	for (const model of [samplePanelModel, longModel]) {
		for (const frames of FRAME_STYLES) {
			for (const width of [58, 55, 47, 45, 30, 11, 5]) {
				assert.deepEqual(renderPanel(model, width, { frames }), renderPanel(model, width, { frames, logo: "braille" }), `panel ${frames} ${width}`);
				assert.deepEqual(renderPanel(model, width, { frames, maxRows: 12 }), renderPanel(model, width, { frames, maxRows: 12, logo: "braille" }), `short panel ${frames} ${width}`);
				assert.deepEqual(renderRail(model, width, { frames }), renderRail(model, width, { frames, logo: "braille" }), `rail ${frames} ${width}`);
			}
			for (const width of [100, 57, 49, 13]) assert.deepEqual(renderDock(model, width, 40, 0, { frames }), renderDock(model, width, 40, 0, { frames, logo: "braille" }), `dock ${frames} ${width}`);
		}
	}
	assert.deepEqual(renderDock(samplePanelModel, 57, 40), renderDock(samplePanelModel, 57, 40, 0, { logo: "braille" }), "dock without options");
});

test("S2 renderDock and renderRail draw the logo style they are given", () => {
	const dock = (logo: (typeof LOGO_STYLES)[number]) => renderDock(samplePanelModel, 57, 80, 0, { logo }).lines.map(plain);
	assert.equal(dock("text")[DOCK_TOP_ROWS].trimEnd(), "   GENTLESHELL");
	assert.match(dock("none")[DOCK_TOP_ROWS], /^ ╭─ session ─+╮ $/);
	assert.equal(dock("braille")[DOCK_TOP_ROWS], renderDock(samplePanelModel, 57, 80).lines.map(plain)[DOCK_TOP_ROWS]);
	assert.equal(plain(renderRail(samplePanelModel, 47, { logo: "text" })[0]).slice(1).trimEnd(), "   GENTLESHELL");
});

test("S2 a short screen keeps the braille and text logos and drops the other parts first", () => {
	for (const frames of FRAME_STYLES) {
		const text = renderPanel(longModel, 47, { frames, logo: "text", maxRows: 10 }).map(plain);
		assert.equal(text[0].trimEnd(), "  GENTLESHELL", `text logo kept, ${frames}`);
		const braille = renderPanel(longModel, 47, { frames, logo: "braille", maxRows: 10 }).map(plain);
		assert.match(braille[0], /^ [⠛⣤⣿]/, `braille logo kept, ${frames}`);
		const none = renderPanel(longModel, 47, { frames, logo: "none", maxRows: 10 }).map(plain);
		assert.match(none[0], /session/, `no logo, ${frames}`);
		assert.ok(none.length <= text.length, `no logo never takes more rows, ${frames}`);
	}
});

test("S2 every line fits the width for each logo and frame style, sample and long models", () => {
	for (const [name, model] of [["sample", samplePanelModel], ["long", longModel]] as const) {
		for (const logo of LOGO_STYLES) {
			for (const frames of FRAME_STYLES) {
				for (const width of [58, 55, 47, 45, 30, 21, 11, 5, 1]) {
					for (const line of renderPanel(model, width, { logo, frames })) assert.ok(visibleWidth(line) <= width, `panel ${name} ${logo} ${frames} ${width}`);
					for (const line of renderRail(model, width, { logo, frames })) assert.ok(visibleWidth(line) <= width, `rail ${name} ${logo} ${frames} ${width}`);
				}
				for (const width of [100, 57, 49, 13, 3]) for (const line of renderDock(model, width, 40, 0, { logo, frames }).lines) assert.equal(visibleWidth(line), width, `dock ${name} ${logo} ${frames} ${width}`);
			}
		}
	}
});

// --- look-more S1: the divider's intensity ------------------------------------------

/** A rail line without its divider cell: the blank and the panel, colors included. */
const afterDivider = (line: string) => line.replace(/^(?:\x1b\[[0-9;]*m)*[│ ](?:\x1b\[[0-9;]*m)*/, "");

test("look-more S1 medium is today's divider byte for byte, the default; every level keeps the panel and the width", async () => {
	const { DIVIDER_PEAKS } = await import("../lib/panel.ts");
	assert.deepEqual(DIVIDER_PEAKS, { off: 0, subtle: 0.2, medium: 0.35, strong: 0.55 });
	for (const model of [samplePanelModel, longModel, { session: { project: "p" } } as PanelModel]) {
		for (const rows of [undefined, 30, 60]) {
			const today = renderRail(model, 47, { maxRows: rows });
			assert.deepEqual(renderRail(model, 47, { maxRows: rows, divider: "medium" }), today, `medium ${rows}`);
			for (const divider of ["off", "subtle", "strong"] as const) {
				const rail = renderRail(model, 47, { maxRows: rows, divider });
				assert.equal(rail.length, today.length, `${divider}: same rows`);
				rail.forEach((line, index) => {
					assert.equal(visibleWidth(line), visibleWidth(today[index]), `${divider}: same width`);
					assert.equal(afterDivider(line), afterDivider(today[index]), `${divider}: the panel and its box fades are untouched`);
				});
			}
		}
	}
});

test("look-more S1 off draws no divider glyph but keeps the blank first column; strong is brighter than medium, medium than subtle", () => {
	const model = { session: { project: "p" } } as PanelModel;
	const off = renderRail(model, 47, { maxRows: 30, divider: "off" });
	for (const line of off) {
		assert.equal(plain(line).slice(0, 2), "  ", "the divider column and the gap stay blank");
		assert.equal(visibleWidth(line), 47);
	}
	assert.deepEqual(off.map((line) => plain(line).slice(2)), renderRail(model, 47, { maxRows: 30 }).map((line) => plain(line).slice(2)), "the panel does not move");
	const light = (divider: "subtle" | "medium" | "strong") => renderRail(model, 47, { maxRows: 30, divider }).map(dividerBrightness);
	const [subtle, medium, strong] = [light("subtle"), light("medium"), light("strong")];
	for (const levels of [subtle, medium, strong]) {
		assert.ok(levels.every((value) => !Number.isNaN(value)));
		assert.equal(levels[0], 0, "fades out at the top");
		assert.equal(levels[29], 0, "and at the bottom");
		assert.deepEqual(levels, [...levels].reverse(), "symmetric");
		assert.equal(Math.max(...levels), levels[14], "brightest at the middle");
	}
	assert.ok(strong[14] > medium[14] && medium[14] > subtle[14], `peaks ${subtle[14]} < ${medium[14]} < ${strong[14]}`);
	for (let index = 0; index < 30; index++) assert.ok(strong[index] >= medium[index] && medium[index] >= subtle[index], `row ${index}`);
});

// --- look-more S2: motion off -------------------------------------------------------

/** entranceModel at `entrance` with every animated input set from `seed`: the spinner, the ODD orb frame and its shine step. */
const movingModel = (seed: number, entrance?: number): PanelModel => {
	const model = entranceModel(entrance);
	model.spinner = seed;
	model.odd!.steps[1] = { ...model.odd!.steps[1], frame: seed, scan: seed * 3 };
	model.ci = { checks: [{ name: "tests", state: "running", seconds: 12 }] } as PanelModel["ci"];
	return model;
};

test("look-more S2 motion off: the rail, the panel and /dock show one fixed frame whatever the spinner, orb, shine and entrance", () => {
	const still = (render: (model: PanelModel) => string[]) => {
		const first = render(movingModel(0));
		for (const [seed, entrance] of [[1, undefined], [5, 0], [7, 2], [9, 6], [13, 40]] as const) assert.deepEqual(render(movingModel(seed, entrance)), first, `seed ${seed} entrance ${entrance}`);
		return first;
	};
	const panel = still((model) => renderPanel(model, 47, { motion: "off" }));
	still((model) => renderRail(model, 49, { motion: "off", maxRows: 60 }));
	still((model) => renderDock(model, 64, 60, 0, { motion: "off" }).lines);
	// The fixed frame is the still one: no spinner frame, the middle orb frame, the label muted, no entrance colors.
	const reference = movingModel(0);
	delete reference.spinner;
	delete reference.odd!.steps[1].frame;
	delete reference.odd!.steps[1].scan;
	assert.deepEqual(panel, renderPanel(reference, 47), "the frames motion on shows without animated inputs");
	assert.ok(!panel.some((line) => line.includes(ENTRANCE_WHITE)), "no entrance shine, no label shine");
	const text = panel.map(plain).join("\n");
	assert.match(text, /⠹ verify/, "the running agent keeps its (still) spinner glyph");
	assert.match(text, /✓ explore/, "done keeps ✓");
});

test("look-more S2 motion on (the default) still animates exactly as today", () => {
	assert.deepEqual(renderPanel(movingModel(3, 1), 47, { motion: "on" }), renderPanel(movingModel(3, 1), 47));
	assert.notDeepEqual(renderPanel(movingModel(3), 47), renderPanel(movingModel(4), 47), "the frames move");
});

test("look-more S2 motion off: the narrow todo and agents cards hold the still frame and play no entrance", () => {
	const todo = (seed: number, entrance?: number) => renderTodoCard(movingModel(seed, entrance).todo, 47, seed, undefined, "off");
	const agents = (seed: number, entrance?: number) => renderAgentsCard(movingModel(seed, entrance).agents, 47, seed, 10_000, undefined, "off");
	for (const [seed, entrance] of [[1, 0], [6, 4], [8, undefined]] as const) {
		assert.deepEqual(todo(seed, entrance), todo(0), `todo ${seed}`);
		assert.deepEqual(agents(seed, entrance), agents(0), `agents ${seed}`);
	}
	assert.deepEqual(todo(4, 0), renderTodoCard(entranceModel().todo, 47, undefined), "the still todo card");
	assert.deepEqual(agents(4, 0), renderAgentsCard(entranceModel().agents, 47, undefined, 10_000), "the still agents card");
	assert.deepEqual(renderTodoCard(movingModel(4, 0).todo, 47, 4, undefined, "on"), renderTodoCard(movingModel(4, 0).todo, 47, 4), "on is today");
});
