import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import fisiDock from "../extensions/fisi-dock.ts";
import { DEFAULT_SECTIONS } from "../lib/look.ts";
import { fgCode, palette } from "../lib/palette.ts";
import { renderPromptLine } from "../lib/prompt-line.ts";
import { SIDEBAR_CACHE, SIDEBAR_STATE } from "../lib/slot.ts";
import { visibleWidth } from "../lib/text.ts";
import { frameUserLines, USER_FRAME_HOOK } from "../lib/user-frame.ts";

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
/** The wide rail's first two columns (sidebar-chrome): the divider, a neutral gray `│` or a blank where it fades out, then a blank. */
const RAIL_PREFIX = /^(?:\x1b\[38;2;(\d+);\1;\1m│\x1b\[39m| ) /;
/** The panel inside a wide rail line, styles kept: the line less the divider column and the blank after it. */
function railPanelLine(line: string): string {
	assert.match(line, RAIL_PREFIX, `the divider column and a blank: ${JSON.stringify(plain(line))}`);
	return line.replace(RAIL_PREFIX, "");
}

/** Each row matches its pattern, in order, and there are exactly as many rows. */
function assertRows(rows: string[], patterns: RegExp[], message?: string): void {
	assert.equal(rows.length, patterns.length, `${message ?? "rows"}: ${JSON.stringify(rows)}`);
	rows.forEach((row, index) => assert.match(row, patterns[index], message));
}

// Spinners move with the wall clock unless motion is potato (S31); the still ⠹
// keeps these tests independent of the time they run at. The animated tests
// below lift it and fake the clock.
process.env.FISI_DOCK_ORBS = "off";
// No MCP config unless a test writes one (S32): Pi's agent dir is a fresh temp
// folder holding only Fisi Dock's state, its first-start theme step already done
// (T9), so a session_start writes nothing and sets no theme.
const NO_AGENT_DIR = fileURLToPath(new URL("./fixtures/missing-config-home/agent", import.meta.url));
const AGENT_DIR = mkdtempSync(join(tmpdir(), "fisi-dock-agent-default-"));
mkdirSync(join(AGENT_DIR, "fisi-dock"));
writeFileSync(join(AGENT_DIR, "fisi-dock", "state.json"), JSON.stringify({ enabled: true, themeApplied: true }));
after(() => rmSync(AGENT_DIR, { recursive: true, force: true }));
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
// The tests are a parent session even when a delegated child runs them (T9).
delete process.env.GENTLE_PI_AGENTS_CHILD;

type Handler = (event: unknown, ctx: unknown) => void;
type Factory = (tui: unknown) => { render(width: number): string[]; dispose?(): void };

type Exec = (command: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
type Command = { description?: string; handler(args: string, ctx: unknown): Promise<void> | void };
type Shortcut = { description?: string; handler(ctx: unknown): Promise<void> | void };
type Overlay = { render(width: number): string[]; handleInput?(data: string): void; dispose?(): void };
type Keys = { matches(data: string, id: string): boolean };
/** One ctx.ui.custom() call: the factory gets (tui, theme, keybindings, done). */
type Custom = {
	factory: (tui: unknown, theme: unknown, keybindings: Keys, done: (result: unknown) => void) => Overlay;
	options?: { overlay?: boolean; overlayOptions?: { width?: number | string; maxHeight?: number | string } };
	closed: (result: unknown) => void;
};

// In-memory Pi, session and terminal with Gentle Shell's rail parts registered.
function simulate(
	cwd: string,
	options: { ownsHost?: () => boolean; exec?: Exec; branch?: () => unknown[]; tools?: () => unknown[]; commands?: () => unknown[]; shortcuts?: boolean; editor?: unknown; theme?: string; knownThemes?: string[]; throwingThemes?: string[]; failingThemes?: string[] } = {},
) {
	const { ownsHost } = options;
	// Pi's editor factory slot (setEditorComponent / getEditorComponent): Gentle Shell's marked factory when a test seeds one (S88).
	let editorFactory: unknown = options.editor;
	const editorSets: unknown[] = [];
	const handlers = new Map<string, Handler[]>();
	const channels = new Map<string, ((data: unknown) => void)[]>();
	const commands = new Map<string, Command>();
	const shortcuts = new Map<string, Shortcut>();
	const pi = {
		registerCommand: (name: string, command: Command) => commands.set(name, command),
		// Pi's pi.registerShortcut, recorded by key; `shortcuts: false` leaves it out, like older hosts.
		...(options.shortcuts === false ? {} : { registerShortcut: (key: string, shortcut: Shortcut) => void shortcuts.set(key, shortcut) }),
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		events: {
			on: (channel: string, handler: (data: unknown) => void) => {
				channels.set(channel, [...(channels.get(channel) ?? []), handler]);
				return () => channels.set(channel, (channels.get(channel) ?? []).filter((other) => other !== handler));
			},
		},
		exec: options.exec ?? (async () => ({ code: 1, stdout: "", stderr: "" })),
		getThinkingLevel: () => "high",
		getAllTools: options.tools ?? (() => []),
		// Pi's command list (pi.getCommands); left out unless a test seeds it, like older hosts.
		...(options.commands ? { getCommands: options.commands } : {}),
	};
	const widgets = new Map<string, Factory | undefined>();
	const placements = new Map<string, string | undefined>();
	const customs: Custom[] = [];
	const notices: string[] = [];
	// Pi's theme setter (ctx.ui.setTheme), recorded by name (S95); the theme in use (ctx.ui.theme.name) follows
	// each success. With knownThemes, any other name fails as Pi's does for a missing theme (S7);
	// failingThemes are known to the lookup but their setter reports { success: false } (T9).
	const themes: string[] = [];
	let currentTheme = options.theme;
	// Pi's picker (ctx.ui.select), recorded; it answers from `picks` in order, undefined (Esc) when empty (S98).
	const selects: { title: string; options: string[] }[] = [];
	const picks: (string | undefined)[] = [];
	// Pi's startup header slot (ctx.ui.setHeader): a call before Pi built its own header is dropped;
	// each call disposes the custom header it replaces; undefined restores Pi's built-in one.
	const startHeader: { ready: boolean; current?: { render(width: number): string[]; dispose?(): void } } = { ready: true };
	const ctx = {
		hasUI: true,
		cwd,
		model: { id: "claude-opus-5-5", reasoning: true },
		ui: {
			setWidget: (key: string, factory?: Factory, options?: { placement?: string }) => {
				widgets.set(key, factory);
				placements.set(key, factory ? options?.placement : undefined);
			},
			custom: (factory: Custom["factory"], options?: Custom["options"]) =>
				new Promise((resolve) => customs.push({ factory, options, closed: resolve })),
			notify: (message: string) => void notices.push(message),
			get theme() {
				return { name: currentTheme };
			},
			// Pi's lookup by name (ctx.ui.getTheme): undefined for a theme it does not know.
			getTheme: (name: string) => (!options.knownThemes || options.knownThemes.includes(name) ? { name } : undefined),
			setTheme: (name: string) => {
				themes.push(name);
				if (options.throwingThemes?.includes(name)) throw new Error(`theme ${name} broke`);
				if (options.knownThemes && !options.knownThemes.includes(name)) return { success: false, error: `Theme not found: ${name}` };
				if (options.failingThemes?.includes(name)) return { success: false, error: `Theme ${name} failed` };
				currentTheme = name;
				return { success: true };
			},
			select: async (title: string, options: string[]) => {
				selects.push({ title, options });
				return picks.shift();
			},
			getEditorComponent: () => editorFactory,
			setEditorComponent: (factory: unknown) => {
				editorFactory = factory;
				editorSets.push(factory);
			},
			setHeader: (factory?: (tui: unknown, theme: unknown) => { render(width: number): string[]; dispose?(): void }) => {
				if (!startHeader.ready) return;
				const previous = startHeader.current;
				startHeader.current = undefined;
				previous?.dispose?.();
				startHeader.current = factory?.(tui, {});
			},
		},
		sessionManager: { getSessionId: () => "s1", getCwd: () => cwd, getEntries: () => [], getBranch: options.branch ?? (() => []) },
		getContextUsage: () => undefined,
	};
	const gentleHeader = { render: () => ["✿ Gentle Shell ◇ path ◇ model"], invalidate() {}, digest: () => "gs" };
	const gentleFooter = { render: () => ["status"], invalidate() {} };
	// 4.6.0's other rail parts (lib/shell-sidebar-layout.ts) and its status bar (lib/shell-sidebar.ts sidebarStatusBar).
	const gentleParts = Object.fromEntries(["todo", "jobs", "agents", "statusbar"].map((key) => [key, { render: () => [`gentle ${key}`], invalidate() {} }]));
	const parts = new Map<string, unknown>([["header", gentleHeader], ["footer", gentleFooter], ...Object.entries(gentleParts)]);
	const terminal = { [SIDEBAR_STATE]: { active: true, parts, ...(ownsHost ? { ownsHost } : {}) }, [SIDEBAR_CACHE]: { revision: 0 } };
	const tui = { terminal, requestRender() {} };
	const emit = (name: string) => {
		for (const handler of handlers.get(name) ?? []) handler({}, ctx);
	};
	const emitEvent = (channel: string, data: unknown) => {
		for (const handler of channels.get(channel) ?? []) handler(data);
	};
	// Fisi Dock asks Gentle Shell for its permission-mode adapter over pi.events (S84).
	(pi.events as { emit?: (channel: string, data: unknown) => void }).emit = emitEvent;
	fisiDock(pi as never);
	const setEditor = (factory: unknown) => void (editorFactory = factory);
	return { startHeader, parts, gentleHeader, gentleFooter, gentleParts, widgets, placements, commands, shortcuts, customs, notices, themes, selects, picks, ctx, tui, emit, emitEvent, handlers, channels, editorSets, setEditor };
}

test("the extension takes over the header and Status slots and restores both on shutdown", () => {
	const sim = simulate("E:\\DEV\\projects\\my-app");
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);

	const header = sim.parts.get("header") as { render(width: number): string[]; digest(): string; handleMouse(event: unknown): unknown };
	assert.notEqual(header, sim.gentleHeader);
	assert.notEqual(sim.parts.get("footer"), sim.gentleFooter);
	const lines = header.render(118);
	assert.equal(lines.length, 1);
	assert.equal(plain(lines[0]), " E:\\DEV\\projects\\my-app");
	console.log(`header line: ${JSON.stringify(plain(lines[0]))}`);
	for (const width of [140, 47, 12, 1, 0]) for (const line of header.render(width)) assert.ok(visibleWidth(line) <= width);
	assert.equal(typeof header.digest(), "string");
	assert.equal(header.handleMouse({ type: "click", button: "left", x: 2, y: 0, width: 118 }), undefined);

	sim.emit("session_shutdown");
	assert.equal(sim.parts.get("header"), sim.gentleHeader);
	assert.equal(sim.parts.get("footer"), sim.gentleFooter);
});

test("the rail parts todo, jobs, agents and statusbar are taken over with parts that paint nothing, and given back on shutdown (S83, S84)", () => {
	const sim = simulate("E:\\DEV\\app");
	sim.emit("session_start");
	const widget = sim.widgets.get("fisi-dock")!(sim.tui);
	for (const key of ["todo", "jobs", "agents", "statusbar"]) {
		const part = sim.parts.get(key) as { render(width: number): string[]; digest?(): string };
		assert.notEqual(part, sim.gentleParts[key], `${key} taken over`);
		assert.deepEqual(part.render(47), [], `${key} paints nothing`);
		assert.equal(typeof part.digest?.(), "string", `${key} declares a digest for the rail memo`);
	}
	// Gentle Shell re-registering one (a /reload, a late Agents card) is taken over again on the next frame.
	const newer = { render: () => ["new agents"], invalidate() {} };
	sim.parts.set("agents", newer);
	widget.render(80);
	assert.notEqual(sim.parts.get("agents"), newer);
	assert.deepEqual((sim.parts.get("agents") as { render(width: number): string[] }).render(47), []);
	sim.emit("session_shutdown");
	assert.equal(sim.parts.get("agents"), newer, "the newest original comes back");
	for (const key of ["todo", "jobs", "statusbar"]) assert.equal(sim.parts.get(key), sim.gentleParts[key], `${key} restored`);
	assert.equal(sim.parts.get("header"), sim.gentleHeader);
	assert.equal(sim.parts.get("footer"), sim.gentleFooter);
});

test("the prompt line reads the permission mode from Gentle Shell's host-ui adapter and follows its changes; NORMAL shows nothing (S84)", async () => {
	let mode = "super-yolo";
	const observers = new Set<() => void>();
	let disposed = 0;
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true });
	// Gentle Shell's lib/yolo-session-policy.ts answers `gentle:yolo:host-ui` with its adapter.
	sim.channels.set("gentle:yolo:host-ui", [(payload) => {
		const request = payload as { context: unknown; respond(adapter: unknown): void };
		assert.equal(request.context, sim.ctx, "the session context goes with the request");
		request.respond({
			read: async () => "ON",
			readSnapshot: async () => ({ yolo: "ON", mode, defaultMode: "normal" }),
			readMode: async () => mode,
			toggle: async () => {},
			observe: (refresh: () => void) => {
				observers.add(refresh);
				return () => observers.delete(refresh);
			},
			dispose: () => void disposed++,
		});
	}]);
	sim.emit("session_start");
	const promptLine = sim.widgets.get("fisi-dock-prompt-line")!(sim.tui);
	await waitFor(() => plain(promptLine.render(100)[0] ?? "").includes("SUPER-YOLO"));
	assert.ok(plain(promptLine.render(100)[0]).endsWith("SUPER-YOLO · opus-5.5 · high "));
	assert.equal(observers.size, 1, "watches the adapter for changes");
	mode = "normal";
	for (const refresh of observers) refresh();
	await waitFor(() => !plain(promptLine.render(100)[0] ?? "").includes("YOLO"));
	assert.ok(plain(promptLine.render(100)[0]).endsWith("opus-5.5 · high "), "NORMAL: model and effort only");
	mode = "yolo";
	for (const refresh of observers) refresh();
	await waitFor(() => plain(promptLine.render(100)[0] ?? "").includes("YOLO"));
	assert.ok(plain(promptLine.render(100)[0]).endsWith("YOLO · opus-5.5 · high "));
	sim.emit("session_shutdown");
	assert.equal(observers.size, 0, "unobserved on shutdown");
	assert.equal(disposed, 1, "the adapter is disposed on shutdown");
});

test("without a host-ui answer (no Gentle Shell, an older one) the prompt line shows model and effort as before (S84)", () => {
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true });
	sim.emit("session_start");
	const promptLine = sim.widgets.get("fisi-dock-prompt-line")!(sim.tui);
	assert.ok(plain(promptLine.render(100)[0]).endsWith("opus-5.5 · high "));
	assert.ok(!plain(promptLine.render(100)[0]).includes("NORMAL"));
	sim.emit("session_shutdown");
});

// Gentle Shell's editor as Pi sees it (S88): panel-chrome rows at a width, `topRowCount` after render.
const PROMPT_OWNER = Symbol.for("gentle-pi.prompt-owner");
const padTo = (text: string, width: number) => text + " ".repeat(Math.max(0, width - visibleWidth(text)));
function gentleEditorFactory(text = "hola") {
	const factory = Object.assign((_tui: unknown, _theme: unknown, _keys: unknown) => ({
		topRowCount: 0,
		render(width: number): string[] {
			const fill = width - (2 + 1 + 1 + "waiting for input".length + 1) - 1;
			// Nothing fits: Gentle Shell paints dashes only.
			return [fill < 1 ? "─".repeat(width) : `─ ✿ waiting for input ${"─".repeat(fill)}─`, padTo(`› ${text}`, width), " ".repeat(width)];
		},
		handleMouse: () => undefined,
		setText() {},
	}), { [PROMPT_OWNER]: true });
	return factory;
}
type EditorFactory = (tui: unknown, theme: unknown, keys: unknown) => { render(width: number): string[] };

test("with Gentle Shell's marked editor, session_start wraps it: the editor paints the closed box with the labels, the prompt line paints nothing while it does, and shutdown gives Gentle Shell's factory back (S88)", () => {
	const gentle = gentleEditorFactory();
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, editor: gentle });
	sim.emit("session_start");
	const wrapper = sim.ctx.ui.getEditorComponent() as EditorFactory & Record<symbol, unknown>;
	assert.notEqual(wrapper, gentle, "Fisi Dock's wrapper is the editor factory");
	assert.equal(wrapper[PROMPT_OWNER], true, "marked like Gentle Shell's, so its shutdown and reinstall keep working");
	const editor = wrapper(sim.tui, {}, {});
	const rows = editor.render(60).map(plain);
	assert.deepEqual(rows, [
		`╭─ ✿ waiting for input ${"─".repeat(18)} opus-5.5 · high ─╮`,
		`│ › hola${" ".repeat(50)} │`,
		`╰${"─".repeat(58)}╯`,
	]);
	const promptLine = sim.widgets.get("fisi-dock-prompt-line")!(sim.tui);
	assert.deepEqual(promptLine.render(100), [], "the box carries the labels: no line under it");
	editor.render(12);
	assert.ok(plain(promptLine.render(100)[0] ?? "").endsWith("opus-5.5 · high "), "the box did not fit: the line is the fallback");
	editor.render(60);
	assert.deepEqual(promptLine.render(100), []);
	sim.emit("session_shutdown");
	assert.equal(sim.ctx.ui.getEditorComponent(), gentle, "Gentle Shell's factory restored");
});

test("Gentle Shell's editor arriving after session_start is wrapped on the microtask retry, or else on the next turn_end; an unmarked editor never is (S88)", async () => {
	const early = simulate("E:\\DEV\\app", { ownsHost: () => true });
	early.emit("session_start");
	assert.equal(early.ctx.ui.getEditorComponent(), undefined, "nothing to wrap yet, nothing installed");
	const gentle = gentleEditorFactory();
	early.setEditor(gentle);
	await Promise.resolve();
	await Promise.resolve();
	assert.notEqual(early.ctx.ui.getEditorComponent(), gentle, "wrapped by the microtask retry");
	assert.equal((early.ctx.ui.getEditorComponent() as Record<symbol, unknown>)[PROMPT_OWNER], true);
	early.emit("session_shutdown");
	assert.equal(early.ctx.ui.getEditorComponent(), gentle);

	const late = simulate("E:\\DEV\\app", { ownsHost: () => true });
	late.emit("session_start");
	await new Promise((resolve) => setTimeout(resolve, 0));
	late.setEditor(gentle);
	assert.equal(late.ctx.ui.getEditorComponent(), gentle, "no busy wait: nothing happens until an event");
	late.emit("turn_end");
	assert.notEqual(late.ctx.ui.getEditorComponent(), gentle, "wrapped on turn_end");
	late.emit("session_shutdown");
	assert.equal(late.ctx.ui.getEditorComponent(), gentle);

	const foreign = () => ({ render: () => [], handleMouse: () => undefined });
	const other = simulate("E:\\DEV\\app", { ownsHost: () => true, editor: foreign });
	other.emit("session_start");
	other.emit("turn_end");
	assert.equal(other.ctx.ui.getEditorComponent(), foreign, "someone else's editor stays");
	assert.deepEqual(other.editorSets, []);
	other.emit("session_shutdown");
	assert.equal(other.ctx.ui.getEditorComponent(), foreign);
});

test("nothing of pi-lens or the fork is read: no pilens:* channel, no lens hand-off at settle, no fork registry (S86)", async () => {
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	assert.deepEqual([...sim.channels.keys()].filter((channel) => channel.startsWith("pilens:")), [], "no pi-lens channels");
	assert.equal(sim.handlers.get("agent_before_settle"), undefined, "no settle hook: nothing is handed to the agent");
	assert.equal(sim.handlers.get("input"), undefined);
	assert.equal((globalThis as Record<symbol, unknown>)[Symbol.for("gentle-pi.fisi-bridge")], undefined, "Fisi Dock never creates the fork's registry");
	sim.emit("session_shutdown");
});

test("without the wide rail (narrow fullscreen) the top row is Fisi Dock's own and the model line shows (S33, S8)", async () => {
	let wide = false;
	const git: Record<string, string> = { "rev-parse --abbrev-ref HEAD": "main\n", "status --porcelain=v1 -z": "", "diff --numstat -z HEAD": "" };
	const exec: Exec = async (_command, args) => (git[args.join(" ")] === undefined ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: git[args.join(" ")], stderr: "" });
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => wide, exec });
	sim.ctx.getContextUsage = (() => ({ tokens: 400_000, contextWindow: 1_000_000, percent: 40 })) as never;
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const header = sim.parts.get("header") as { render(width: number): string[]; digest(): string; handleMouse(event: unknown): unknown };
	const promptLine = sim.widgets.get("fisi-dock-prompt-line")!(sim.tui);
	await waitFor(() => plain(header.render(64)[0] ?? "").includes("main"));

	// Narrow: our row in Fisi Dock style, never Gentle Shell's, never the model.
	assert.deepEqual(header.render(64).map(plain), [" app · main  ▰▰▱▱ 40%  $0.000", "─".repeat(64)]);
	for (const width of [64, 53, 40, 20]) for (const line of header.render(width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
	assert.ok(!header.render(200).some((line) => /Gentle Shell|opus|model/.test(plain(line))));
	assert.equal(header.handleMouse({ type: "click", button: "left", x: 2, y: 0, width: 64 }), undefined, "no click action");
	console.log(`--- simulated narrow header, 64 and 40 columns\n${[...header.render(64), ...header.render(40)].map(plain).join("\n")}`);
	// Our top row has no model: the model line under the prompt shows it (S8; hidden when the prompt frame has it).
	assert.ok(plain(promptLine.render(100)[0]).endsWith("opus-5.5 · high "));
	const narrowDigest = header.digest();

	// Wide: Fisi Dock's path-only row and model line.
	wide = true;
	assert.equal(plain(header.render(100)[0]), " E:\\DEV\\app");
	assert.ok(plain(promptLine.render(100)[0]).endsWith("opus-5.5 · high "));
	assert.notEqual(header.digest(), narrowDigest);
	sim.emit("session_shutdown");
});

test("a header re-registered by Gentle Shell is taken over again on the next frame", () => {
	const sim = simulate("E:\\DEV\\app");
	sim.emit("session_start");
	const widget = sim.widgets.get("fisi-dock")!(sim.tui);
	const newer = { render: () => ["new"], invalidate() {} };
	sim.parts.set("header", newer);
	widget.render(80);
	assert.notEqual(sim.parts.get("header"), newer);
	widget.dispose?.();
	assert.equal(sim.parts.get("header"), newer);
	assert.equal(sim.parts.get("footer"), sim.gentleFooter);
	sim.emit("session_shutdown");
});

const FIXTURE = fileURLToPath(new URL("./fixtures/heads-up-project", import.meta.url));

async function waitFor(check: () => boolean): Promise<void> {
	for (let tries = 0; tries < 400 && !check(); tries++) await new Promise((resolve) => setTimeout(resolve, 5));
}

function headsUpRows(lines: string[]): string[] {
	const shown = lines.map(plain);
	const start = shown.findIndex((line) => line.startsWith("╭─ heads-up"));
	if (start < 0) return [];
	return shown.slice(start, shown.findIndex((line, index) => index > start && line.startsWith("╰")) + 1);
}

test("heads-up from fake git output, a fake todo and fixture ODD plans (S14, S8)", async () => {
	const root = FIXTURE.replaceAll("\\", "/");
	const git: Record<string, string> = {
		"rev-parse --abbrev-ref HEAD": "feat/fisi-dock\n",
		"rev-list --count @{upstream}..HEAD": "4\n",
		"status --porcelain=v1 -z": "",
		"diff --numstat -z HEAD": "",
		"worktree list --porcelain": [
			`worktree ${root}\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/feat/fisi-dock\n`,
			`worktree ${root}-feat-x\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/feat-x\n`,
			`worktree ${root}-gone\nHEAD 3333333333333333333333333333333333333333\ndetached\nprunable gitdir file points to non-existent location\n`,
		].join("\n"),
		"symbolic-ref --quiet refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
		"branch --format=%(refname:short) --no-merged main": "feat-x\nfeat/fisi-dock\nfix/a-very-long-branch-name-that-does-not-fit\n",
	};
	const exec: Exec = async (command, args) => {
		const stdout = command === "git" ? git[args.join(" ")] : undefined;
		return stdout === undefined ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout, stderr: "" };
	};
	const tasks = [
		{ id: 1, title: "a", status: "done" },
		{ id: 2, title: "b", status: "in_progress" },
		{ id: 3, title: "c", status: "pending" },
		{ id: 4, title: "d", status: "pending" },
		{ id: 5, title: "e", status: "dropped" },
	];
	const branch = () => [{ type: "message", message: { role: "toolResult", toolName: "todo", details: { gentleTodo: { tasks } } } }];
	const sim = simulate(FIXTURE, { exec, branch });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const footer = sim.parts.get("footer") as { render(width: number): string[] };
	// The panel inside the wide rail (sidebar-chrome); the width checks below read the rail as drawn.
	const rail = () => ({ render: (width: number) => footer.render(width).map(railPanelLine) });

	await waitFor(() => headsUpRows(rail().render(47)).some((line) => line.includes("ODD plan")) && headsUpRows(rail().render(47)).some((line) => line.includes("branches")));
	const first = headsUpRows(rail().render(47));
	assert.deepEqual(first.slice(1, -1).map((line) => line.slice(2).trimEnd().replace(/ *│$/, "")), [
		"! worktree open: heads-up-project-feat-x",
		"! 4 commits not pushed",
		"! 2 branches not merged",
		"! ODD plan fisi-dock: 2 open",
	]);
	const project = rail().render(47).map(plain).find((line) => line.includes("project"))!;
	assert.match(project, /project +heads-up-project  feat\/fisi-dock +│$/, "no ↑4 in the session row");
	console.log(`--- simulated heads-up, session start\n${first.join("\n")}`);

	// The run ends with todo tasks still open; a new request clears the warning.
	sim.emit("agent_start");
	assert.ok(!headsUpRows(rail().render(47)).some((line) => line.includes("todo")), "a running request has open tasks by design");
	sim.emit("agent_settled");
	await waitFor(() => headsUpRows(rail().render(47)).some((line) => line.includes("todo")));
	const settled = headsUpRows(rail().render(47));
	assert.ok(settled.some((line) => line.includes("! 3 todo tasks left")));
	for (const width of [47, 30, 20]) {
		const lines = rail().render(width);
		for (const line of footer.render(width)) assert.ok(visibleWidth(line) <= width);
		console.log(`--- simulated heads-up after the run settled, ${width} columns\n${headsUpRows(lines).join("\n")}`);
	}
	sim.emit("agent_start");
	assert.ok(!headsUpRows(rail().render(47)).some((line) => line.includes("todo")), "cleared when a new request starts");
	sim.emit("session_shutdown");
});

/** The panel the wide rail draws at `width`, plain: two columns narrower, after the divider and a blank (sidebar-chrome). */
const railOf = (sim: ReturnType<typeof simulate>) => (width: number) => (sim.parts.get("footer") as { render(width: number): string[] }).render(width).map((line) => plain(railPanelLine(line)));

const rddRows = (lines: string[]) => {
	const start = lines.findIndex((line) => line.startsWith("╭─ RDD"));
	if (start < 0) return undefined;
	return lines.slice(start + 1, lines.findIndex((line, index) => index > start && line.startsWith("╰"))).map((line) => line.replace(/ +/g, " "));
};

// --- RDD mode from `gentle-ai review mode status` (S85) ---------------------------------

/** gentle-ai's --json answer for `review mode status`, as the real binary prints it (tests/rdd-mode.test.ts has the captures). */
const reviewModeJson = (effective: "on" | "off") => JSON.stringify({ schema: "gentle-ai.review-mode/v1", operation: "status", scope: "both", status: { schema: "gentle-ai.rdd-mode-status/v1", global: effective, clone_local: "", effective, source: "global" } }, null, 2);
/** A fake gentle-pi package with a bundled binary (never run: exec is faked), injected the way the launcher tells children which package to load. */
const FAKE_PACKAGE = fileURLToPath(new URL("./fixtures/gentle-pi-package", import.meta.url));
const isGentleAi = (command: string) => /[\\/]gentle-ai(\.exe)?$/.test(command);
function injectPackage(t: TestContext): void {
	const previous = { injection: process.env.GENTLE_SHELL_CHILD_PACKAGE_INJECTION, path: process.env.PATH, Path: process.env.Path, appdata: process.env.APPDATA };
	process.env.GENTLE_SHELL_CHILD_PACKAGE_INJECTION = JSON.stringify({ version: 1, noExtensions: true, extensionPaths: [FAKE_PACKAGE] });
	// No gentle-ai on PATH and no global package: the injected one is the only candidate.
	process.env.PATH = "";
	delete process.env.Path;
	process.env.APPDATA = NO_AGENT_DIR;
	t.after(() => {
		for (const [key, value] of [["GENTLE_SHELL_CHILD_PACKAGE_INJECTION", previous.injection], ["PATH", previous.path], ["Path", previous.Path], ["APPDATA", previous.appdata]] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
}

test("the RDD switch comes from `gentle-ai review mode status --json` at session start and after each turn: on draws the watching row, off the off row, a failed read keeps the last (S85)", async (t) => {
	injectPackage(t);
	let answer: { code: number; stdout: string } | Error = { code: 0, stdout: reviewModeJson("on") };
	const commands: string[][] = [];
	const exec: Exec = async (command, args) => {
		if (!isGentleAi(command)) return { code: 1, stdout: "", stderr: "" };
		commands.push([command, ...args]);
		if (answer instanceof Error) throw answer;
		return { ...answer, stderr: "" };
	};
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, exec });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const title = () => railOf(sim)(47).find((line) => line.startsWith("╭─ RDD"));
	await waitFor(() => title() !== undefined);
	assert.match(title()!, /^╭─ RDD ─+ on ─╮$/);
	assert.deepEqual(rddRows(railOf(sim)(47)), ["│ ● watching · reviews high-risk changes │"]);
	assert.equal(commands.length, 1, "one read at session start");
	assert.ok(isGentleAi(commands[0][0]) && commands[0][0].startsWith(FAKE_PACKAGE), `the bundled binary: ${commands[0][0]}`);
	assert.deepEqual(commands[0].slice(1), ["review", "mode", "status", "--cwd", "E:\\DEV\\app", "--json"], "read-only, for the session folder");
	answer = { code: 0, stdout: reviewModeJson("off") };
	sim.emit("turn_end");
	await waitFor(() => /off ─╮$/.test(title() ?? ""));
	assert.deepEqual(rddRows(railOf(sim)(47)), ["│ ○ off · changes are not reviewed │"]);
	assert.equal(commands.length, 2, "one read per turn end");
	for (const failure of [{ code: 1, stdout: "" }, { code: 0, stdout: "not json at all" }, new Error("timed out")]) {
		answer = failure;
		const before = commands.length;
		sim.emit("turn_end");
		await waitFor(() => commands.length === before + 1);
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.match(title()!, /off ─╮$/, `kept after ${failure instanceof Error ? failure.message : JSON.stringify(failure)}`);
		assert.deepEqual(rddRows(railOf(sim)(47)), ["│ ○ off · changes are not reviewed │"]);
	}
	assert.equal(commands.length, 5);
	sim.emit("session_shutdown");
});

test("without a gentle-ai binary (none on PATH, no package) nothing runs and no RDD section shows until a review event (S85)", async (t) => {
	injectPackage(t);
	process.env.GENTLE_SHELL_CHILD_PACKAGE_INJECTION = JSON.stringify({ version: 1, noExtensions: true, extensionPaths: [NO_AGENT_DIR] });
	const commands: string[] = [];
	const exec: Exec = async (command) => {
		commands.push(command);
		return { code: 0, stdout: reviewModeJson("on"), stderr: "" };
	};
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, exec });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	sim.emit("turn_end");
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.ok(!commands.some(isGentleAi), "gentle-ai never run");
	assert.equal(rddRows(railOf(sim)(47)), undefined, "unknown mode: no section");
	sim.emit("session_shutdown");
});

test("review events become RDD rows: active with spinner and time, waiting, then approved at HH:MM; the session shows no review (S50)", (t) => {
	animated(t);
	let renders = 0;
	const sim = simulate("E:\\DEV\\app");
	const tui = { terminal: sim.tui.terminal, requestRender: () => void renders++ };
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(tui);
	const rows = () => rddRows(railOf(sim)(47));
	sim.emitEvent("gentle-ai:review-sidebar", { sessionId: "s2", snapshot: { state: "reviewing", scope: "other.ts" } });
	sim.emitEvent("gentle-ai:review-sidebar", { sessionId: "s1", snapshot: { state: "ready", scope: "orbs.ts" } });
	assert.equal(rows(), undefined, "other sessions and ready add no row; no switch read yet: no section");
	sim.emitEvent("gentle-ai:review-sidebar", { sessionId: "s1", snapshot: { state: "reviewing", scope: "orbs.ts +2 files" } });
	assert.deepEqual(rows(), ["│▎⠋ orbs.ts +2 reviewing… 0:00 │"]);
	let before = renders;
	t.mock.timers.tick(80);
	assert.ok(renders > before, "the spinner clock runs while a row is active");
	assert.deepEqual(rows(), ["│▎⠙ orbs.ts +2 reviewing… 0:00 │"]);
	t.mock.timers.tick(18_000);
	assert.match(rows()![0], /^│▎. orbs\.ts \+2 reviewing… 0:18 │$/, "m:ss ticks with the spinner clock");
	sim.emitEvent("gentle-ai:review-sidebar", { sessionId: "s1", snapshot: { state: "consent", scope: "orbs.ts +2 files" } });
	assert.deepEqual(rows(), ["│▎! orbs.ts +2 needs your OK 0:18 │"], "same review, same start");
	before = renders;
	t.mock.timers.tick(1_000);
	assert.ok(renders > before, "the clock keeps running while waiting");
	assert.deepEqual(rows(), ["│▎! orbs.ts +2 needs your OK 0:19 │"]);
	sim.emitEvent("gentle-ai:review-sidebar", { sessionId: "s1", snapshot: { state: "closed", scope: "orbs.ts +2 files" } });
	const end = new Date(Date.now());
	const hhmm = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
	assert.deepEqual(rows(), [`│ ✓ orbs.ts +2 approved ${hhmm} │`]);
	const lines = railOf(sim)(47);
	const session = lines.slice(0, lines.findIndex((line) => line.startsWith("╭─ RDD"))).join("\n");
	assert.ok(!/review|Approved|RDD/.test(session), "the session section has no review text");
	before = renders;
	t.mock.timers.tick(800);
	assert.equal(renders, before, "finished rows stop the spinner clock");
	console.log(`--- simulated RDD section after one approved review, 47 columns\n${lines.filter((line) => line.includes("RDD") || line.includes("orbs.ts")).join("\n")}`);
	sim.emit("session_shutdown");
});

test("review tool calls add a muted line under the review: its step while it runs, its summary once approved; the next review starts clean (S62)", (t) => {
	animated(t);
	const sim = simulate("E:\\DEV\\app");
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const rows = () => rddRows(railOf(sim)(47))!.map((line) => line.replace(/^│▎. /, "").replace(/ \d+(?::\d\d)+ │$/, "").replace(/ │$/, ""));
	const tool = (name: string, event: Record<string, unknown>) => {
		for (const handler of sim.handlers.get(name) ?? []) handler(event, sim.ctx);
	};
	const review = (state: string) => sim.emitEvent("gentle-ai:review-sidebar", { sessionId: "s1", snapshot: { state, scope: "orbs.ts +2 files" } });
	tool("tool_execution_start", { toolName: "gentle_review", args: { operation: "start", input: { mode: "ordinary", lenses: ["readability", "reliability"] } } });
	review("in_review");
	assert.deepEqual(rows(), ["orbs.ts +2 reviewing…", "│ starting · readability, reliability"]);
	tool("tool_execution_start", { toolName: "gentle_review_capture_group", args: { lineageId: "l1", collectBindings: ["a", "b"], reviewerRunAcknowledged: true } });
	assert.deepEqual(rows(), ["orbs.ts +2 reviewing…", "│ running 2 reviewers"], "the step moves with the tool start");
	review("approved");
	const findings = Array.from({ length: 7 }, (_, index) => ({ id: `F${index}`, severity: "minor", disposition: "advisory" }));
	tool("tool_execution_end", { toolName: "gentle_review_capture_group", isError: false, result: { content: [], details: { outcome: "native-last-event-closure", closure: { state: "approved", advisory_findings: { statement: "s", findings } } } } });
	assert.deepEqual(rows(), ["orbs.ts +2 reviewing…", "│ closing · 7 findings, none blocking"]);
	tool("tool_execution_start", { toolName: "gentle_review", args: { operation: "acknowledge-approved", lineageId: "l1" } });
	review("closed");
	assert.deepEqual(rows(), ["│ ✓ orbs.ts +2 approved", "│ 7 findings · none blocking · 2 lenses"]);
	sim.emitEvent("gentle-ai:review-sidebar", { sessionId: "s1", snapshot: { state: "in_review", scope: "panel.ts" } });
	assert.deepEqual(rows(), ["│ ✓ orbs.ts +2 approved", "│ 7 findings · none blocking · 2 lenses", "│ │", "panel.ts reviewing…"], "the finished review keeps its summary; the next one has no stale line");
	sim.emit("session_shutdown");
});

test("the panel shows Gentle Shell's background jobs from gentle-ai:jobs-sidebar (official Gentle Shell)", () => {
	const sim = simulate("E:\\DEV\\app");
	sim.emit("session_start");
	const widget = sim.widgets.get("fisi-dock")!(sim.tui);
	widget.render(80);
	sim.emitEvent("gentle-ai:jobs-sidebar", { sessionId: "s1", snapshot: { jobs: [{ id: "job-1", label: "npm test", startedAt: 1 }] } });
	const lines = railOf(sim)(47);
	assert.ok(!lines.some((line) => line.includes("profile")));
	assert.ok(lines.some((line) => /^│ ⠹ job-1 npm test +\d+(?::\d\d)+ │$/.test(line)), "the job with its time (S35)");
	sim.emit("session_shutdown");
});

const JOB = { sessionId: "s1", snapshot: { jobs: [{ id: "job-1", label: "npm test", startedAt: 1 }] } };

/**
 * Narrow screens show JOB as the phone agents card (S35), not as a strip
 * segment. JOB started at epoch 1 ms, so its time depends on the clock and is
 * left out here; frame dashes collapse to one.
 */
function assertJobCard(lines: string[], glyph = "⠹", message?: string): void {
	const shown = lines.map((line) => plain(line).replace(/ (\d+:)+\d\d │$/, " │").replace(/ +│$/, " │").replace(/─+/g, "─"));
	assert.deepEqual(shown, ["╭─ agents ─ 1 ─╮", `│ ${glyph} job-1 npm test │`, "╰─╯"], message);
}

test("narrow strip: above the editor while the rail does not own the host, empty while it does (S23, S8)", () => {
	let wide = false;
	let renders = 0;
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => wide });
	const tui = { terminal: sim.tui.terminal, requestRender: () => void renders++ };
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(tui);
	assert.equal(sim.placements.get("fisi-dock-strip"), "aboveEditor");
	const strip = sim.widgets.get("fisi-dock-strip")!(tui);
	assert.deepEqual(strip.render(64), [], "nothing to show yet: no empty line");

	const before = renders;
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	assert.ok(renders > before, "a live change repaints");
	assertJobCard(strip.render(64));
	for (const width of [64, 30, 5, 0]) for (const line of strip.render(width)) assert.ok(visibleWidth(line) <= width);
	console.log(`--- simulated narrow strip, 64 columns\n${strip.render(64).map(plain).join("\n")}`);

	wide = true;
	assert.deepEqual(strip.render(64), [], "the rail shows the panel: no strip");
	wide = false;
	assertJobCard(strip.render(64), "⠹", "back when the rail goes away");

	sim.emit("session_shutdown");
	assert.equal(sim.widgets.get("fisi-dock-strip"), undefined, "removed on shutdown");
});

/** A Gentle Todo result on the session branch: `done` done tasks, then one in progress and the rest pending. */
function todoBranch(done: number, total: number): unknown[] {
	const tasks = Array.from({ length: total }, (_, index) => ({
		id: index + 1,
		title: index < done ? `Done task ${index + 1}` : index === done ? "Wire the todo card" : `Pending task ${index + 1}`,
		status: index < done ? "done" : index === done ? "in_progress" : "pending",
	}));
	return [{ type: "message", message: { role: "toolResult", toolName: "todo", details: { gentleTodo: { tasks } } } }];
}

test("narrow: the strip without its todo segment, then Fisi Dock's framed todo card (S28, S8)", () => {
	let wide = false;
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => wide, branch: () => todoBranch(8, 10) });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const strip = sim.widgets.get("fisi-dock-strip")!(sim.tui);
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	const lines = strip.render(53).map(plain);
	assertJobCard(lines.slice(0, 3), "⠹", "nothing left in the strip: the agents card first (S35)");
	assert.ok(!lines.some((line) => /todo \d+\/\d+/.test(line)), "d/t only on the card header");
	const card = lines.slice(3);
	assert.match(card[0], /^╭─ todo ─+ 8\/10 ─╮$/);
	assert.match(card[1], /^│ ✓ 8 done +▰+▱+ │$/);
	assert.match(card[2], /^│▎⠹ Wire the todo card +│$/);
	assert.match(card[3], /^│ ○ Pending task 10 +│$/);
	assert.match(card[4], /^╰─+╯$/);
	assert.equal(card.length, 5);
	for (const width of [64, 53, 40]) {
		const shown = strip.render(width);
		assert.ok(shown.some((line) => plain(line).startsWith("╭─ todo")), `${width}: card shown`);
		for (const line of shown) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
	}
	console.log(`--- simulated narrow strip + todo card, 53 columns\n${lines.join("\n")}`);

	wide = true;
	assert.deepEqual(strip.render(53), [], "the rail shows the panel: no strip, no card");
	sim.emit("session_shutdown");
});

test("narrow: a todo alone draws only the card; no todo keeps the strip and draws no card (S28)", () => {
	const alone = simulate("E:\\DEV\\app", { ownsHost: () => false, branch: () => todoBranch(8, 10) });
	alone.emit("session_start");
	const card = alone.widgets.get("fisi-dock-strip")!(alone.tui).render(64).map(plain);
	assert.match(card[0], /^╭─ todo ─+ 8\/10 ─╮$/, "no empty strip line above the card");
	alone.emit("session_shutdown");

	const none = simulate("E:\\DEV\\app", { ownsHost: () => false });
	none.emit("session_start");
	const strip = none.widgets.get("fisi-dock-strip")!(none.tui);
	none.emitEvent("gentle-ai:jobs-sidebar", JOB);
	assertJobCard(strip.render(64));
	none.emit("session_shutdown");
});

test("no tasks: the rail draws the muted todo row; the narrow strip draws no todo card and no todo segment (S94, S28, S8)", () => {
	// The rail at 47 draws the panel at 45, after the divider and a blank (sidebar-chrome).
	const row = "│ ○ no tasks · the list shows while I plan  │";
	let wide = true;
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => wide });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const strip = sim.widgets.get("fisi-dock-strip")!(sim.tui);
	const rail = () => railOf(sim)(47);
	const todoRows = (lines: string[]) => lines.slice(lines.findIndex((line) => line.startsWith("╭─ todo")) + 1).slice(0, 2);
	assert.deepEqual(todoRows(rail()), [row, `╰${"─".repeat(43)}╯`], "no todo list at all");
	// Gentle Shell's progress event for a cleared list (lib/shell-todo.ts todoProgress: total 0).
	sim.emitEvent("gentle-pi:todo:progress", { sessionId: "s1", done: 0, total: 0, current: null });
	assert.deepEqual(todoRows(rail()), [row, `╰${"─".repeat(43)}╯`], "0 tasks");
	wide = false;
	for (const width of [64, 53]) {
		const lines = strip.render(width).map(plain);
		assert.ok(!lines.some((line) => line.includes("todo") || line.includes("no tasks")), `${width}: ${JSON.stringify(lines)}`);
	}
	sim.emit("session_shutdown");
});

// Gentle Shell main wraps each rail part in its own card when the chrome surface is
// transparent (lib/shell-sidebar-layout.ts): it takes row 0 as the card title and clips
// body rows two columns short of the width it rendered at, so our right border became "…".
// Rows a part's cardGroups() lists as loose skip that card and are only clipped to the rail.
test("the rail marks every row loose so a carding Gentle Shell draws the panel as is, at the width it rendered", () => {
	const sim = simulate("E:\\DEV\\app");
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const rail = sim.parts.get("footer") as { render(width: number): string[]; cardGroups?(width: number): { groups: unknown[]; loose?: number[] } | undefined };
	for (const width of [48, 46]) {
		const lines = rail.render(width);
		assert.deepEqual(rail.cardGroups?.(width), { groups: [], loose: lines.map((_, index) => index) }, `${width}`);
		assert.ok(lines.every((line) => visibleWidth(line) <= width), `${width}: every row fits`);
	}
	sim.emit("session_shutdown");
});

test("the todo card repaints from the live store: a progress event moves it on (S28)", () => {
	let renders = 0;
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false, branch: () => todoBranch(8, 10) });
	const tui = { terminal: sim.tui.terminal, requestRender: () => void renders++ };
	sim.emit("session_start");
	const strip = sim.widgets.get("fisi-dock-strip")!(tui);
	assert.match(plain(strip.render(53)[0]), / 8\/10 ─╮$/);
	const before = renders;
	sim.emitEvent("gentle-pi:todo:progress", { sessionId: "s1", done: 9, total: 10, current: "Pending task 10" });
	assert.ok(renders > before, "a live change repaints");
	const lines = strip.render(53).map(plain);
	assert.match(lines[0], / 9\/10 ─╮$/);
	assert.ok(lines.some((line) => /^│▎⠹ Pending task 10 +│$/.test(line)));
	sim.emit("session_shutdown");
});

test("a header asked to paint once Gentle Shell's sidebar state is gone still gives Gentle Shell's row, as before (S33)", () => {
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const header = sim.parts.get("header") as { render(width: number): string[] };
	delete (sim.tui.terminal as Record<symbol, unknown>)[SIDEBAR_STATE];
	assert.deepEqual(header.render(64), ["✿ Gentle Shell ◇ path ◇ model"]);
	sim.emit("session_shutdown");
});

test("without Gentle Shell's sidebar state the strip paints nothing", () => {
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false, branch: () => todoBranch(8, 10) });
	sim.emit("session_start");
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	const strip = sim.widgets.get("fisi-dock-strip")!({ terminal: {}, requestRender() {} });
	assert.deepEqual(strip.render(64), [], "no strip and no todo card");
	sim.emit("session_shutdown");
});

// pi-tui's default bindings for the keys the overlay reads.
const KEYS: Keys = {
	matches: (data, id) => ({ "tui.select.cancel": "\x1b", "tui.select.up": "\x1b[A", "tui.select.down": "\x1b[B" } as Record<string, string>)[id] === data,
};

/** Overlay width as pi-tui resolves it: columns or a percentage of the screen, never past the screen. */
const overlayWidth = (custom: Custom, columns: number) => {
	const width = custom.options?.overlayOptions?.width ?? 80;
	const percent = typeof width === "string" ? /^(\d+)%$/.exec(width) : null;
	return Math.min(percent ? Math.floor((columns * Number(percent[1])) / 100) : Number(width), columns);
};

test("/dock is registered with a description and opens the live panel as an overlay (S23)", async () => {
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false });
	const dock = sim.commands.get("dock");
	assert.ok(dock, "/dock registered");
	assert.match(dock.description ?? "", /panel/i);
	assert.match(dock.description ?? "", /Esc/);
	sim.emit("session_start");
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);

	let closed = false;
	const pending = Promise.resolve(dock.handler("", sim.ctx)).then(() => (closed = true));
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(sim.customs.length, 1, "one overlay opened");
	const custom = sim.customs[0];
	assert.equal(custom.options?.overlay, true);

	// The phone pane: 64 columns x 36 rows.
	let renders = 0;
	const tui = { terminal: { ...sim.tui.terminal, columns: 64, rows: 36 }, requestRender: () => void renders++ };
	const view = custom.factory(tui, {}, KEYS, custom.closed);
	assert.equal(custom.options?.overlayOptions?.maxHeight, "100%");
	const width = overlayWidth(custom, 64);
	assert.equal(width, 64, "the whole phone width (S59)");
	const lines = view.render(width).map(plain);
	assert.equal(lines.length, 36, "the whole phone height (S59)");
	assert.ok(lines.some((line) => line.startsWith(" ╭─ session")), "the full side panel, not the strip");
	assert.ok(lines.some((line) => /^ │ ⠹ job-1 npm test +\d+(?::\d\d)+ │ $/.test(line)), "live data");
	assert.ok(!lines.some((line) => line.includes("fisi dock")), "no titled frame (S59)");
	assert.match(lines.at(-1)!, /^ Esc to close/);
	for (const line of view.render(width)) assert.equal(visibleWidth(line), width, "opaque: every row the full overlay width");
	console.log(`--- simulated /dock overlay, phone pane 64x36 (overlay ${width} columns)\n${lines.join("\n")}`);

	// Live while open: a new job shows on the next frame and repaints.
	const before = renders;
	sim.emitEvent("gentle-ai:jobs-sidebar", { sessionId: "s1", snapshot: { jobs: [{ id: "job-2", label: "npm run build", startedAt: 2 }] } });
	assert.ok(renders > before, "a live change repaints the overlay");
	assert.ok(view.render(width).map(plain).some((line) => line.includes("job-2 npm run build")));

	// Desktop and narrower screens: never wider than the screen.
	for (const columns of [200, 64, 40, 20]) {
		const at = overlayWidth(custom, columns);
		assert.ok(at <= columns);
		for (const line of view.render(at)) assert.ok(visibleWidth(line) <= at, `${columns}: ${plain(line)}`);
	}

	// Esc closes it; the command returns and focus goes back to the prompt.
	view.handleInput?.("\x1b");
	await pending;
	assert.ok(closed);
	sim.emit("session_shutdown");
});

test("/dock on a short screen keeps every row on screen, scrolls with the arrows and keeps Esc to close", async () => {
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false });
	sim.emit("session_start");
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	const pending = Promise.resolve(sim.commands.get("dock")!.handler("", sim.ctx));
	await new Promise((resolve) => setTimeout(resolve, 0));
	const custom = sim.customs[0];
	const tui = { terminal: { columns: 64, rows: 8 }, requestRender() {} };
	const view = custom.factory(tui, {}, KEYS, custom.closed);
	const top = view.render(64).map(plain);
	assert.equal(top.length, 8, "exactly the screen height");
	assert.match(top.at(-1)!, /^ Esc to close +↑↓ scroll $/);
	view.handleInput?.("\x1b[B");
	const scrolled = view.render(64).map(plain);
	assert.equal(scrolled.length, 8);
	assert.equal(scrolled[2], top[3], "down moves the panel one row (2 blank rows above it)");
	for (let index = 0; index < 100; index++) view.handleInput?.("\x1b[B");
	const bottom = view.render(64).map(plain);
	assert.ok(bottom.some((line) => line.includes("job-1 npm test")), "the last panel row is reachable");
	for (let index = 0; index < 200; index++) view.handleInput?.("\x1b[A");
	assert.deepEqual(view.render(64).map(plain), top, "up returns to the top");
	view.handleInput?.("\x1b");
	await pending;
	sim.emit("session_shutdown");
});

test("/dock scrolls with the mouse wheel or a finger swipe; taps do nothing (S59)", async () => {
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false });
	sim.emit("session_start");
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	const pending = Promise.resolve(sim.commands.get("dock")!.handler("", sim.ctx));
	await new Promise((resolve) => setTimeout(resolve, 0));
	const custom = sim.customs[0];
	let renders = 0;
	const tui = { terminal: { columns: 64, rows: 8 }, requestRender: () => void renders++ };
	const view = custom.factory(tui, {}, KEYS, custom.closed) as { render(width: number): string[]; handleInput?(data: string): void; handleMouse?(event: unknown): unknown };
	const mouse = (type: string, wheelDelta?: number) => ({ type, button: "none", x: 10, y: 3, screenX: 10, screenY: 3, width: 64, height: 8, shift: false, alt: false, ctrl: false, wheelDelta });
	const top = view.render(64).map(plain);
	assert.deepEqual(view.handleMouse?.(mouse("wheel", 3)), { handled: true, render: true }, "the wheel is ours and repaints");
	assert.equal(view.render(64).map(plain)[2], top[5], "a swipe of 3 lines moves the panel 3 rows");
	view.handleMouse?.(mouse("wheel", 999));
	assert.ok(view.render(64).map(plain).some((line) => line.includes("job-1 npm test")), "the last panel row is reachable");
	view.handleMouse?.(mouse("wheel", -999));
	assert.deepEqual(view.render(64).map(plain), top, "back up to the top, never past it");
	const before = renders;
	assert.deepEqual(view.handleMouse?.(mouse("click")), { handled: true, render: false }, "a tap does not reach the conversation behind");
	assert.deepEqual(view.render(64).map(plain), top, "a tap does not scroll");
	assert.equal(renders, before);
	view.handleInput?.("\x1b");
	await pending;
	sim.emit("session_shutdown");
});

test("/dock without a live session only says so", async () => {
	const sim = simulate("E:\\DEV\\app");
	await sim.commands.get("dock")!.handler("", sim.ctx);
	assert.equal(sim.customs.length, 0);
	assert.equal(sim.notices.length, 1);
});

// --- skills-view S1-S4: the skills row and /skills ----------------------------------

/** Pi's pi.getCommands() entries for one skill (SlashCommandInfo). */
const skillCommand = (name: string, origin: string, scope = "user", description = `${name} does things`) => ({ name: `skill:${name}`, description, source: "skill", sourceInfo: { path: `/s/${name}/SKILL.md`, source: "local", scope, origin } });
const SKILL_COMMANDS = [
	{ name: "gentle:banner", source: "extension", sourceInfo: { path: "/e", source: "local", scope: "user", origin: "package" } },
	skillCommand("gentle-design", "package"),
	skillCommand("btw", "package"),
	skillCommand("go-testing", "top-level"),
	skillCommand("local-skill", "top-level", "project"),
];

test("the session section ends with the skills Pi loaded, read from getCommands; /skills unfolds the names in the rail and folds them again, repainting each time (skills-view S1, S2, S4)", async () => {
	const sim = simulate("E:\\DEV\\app", { commands: () => SKILL_COMMANDS });
	const command = sim.commands.get("skills");
	assert.ok(command, "/skills registered");
	assert.match(command.description ?? "", /skills/i);
	assert.match(command.description ?? "", /side panel/i);
	assert.match(command.description ?? "", /fold/i);
	sim.emit("session_start");
	let renders = 0;
	sim.widgets.get("fisi-dock")!({ ...sim.tui, requestRender: () => void renders++ });
	const skillRowsOf = () => sessionRows(railOf(sim)(58)).map((line) => line.replace(/ +│$/, "")).filter((line, index, rows) => index >= rows.findIndex((row) => row.startsWith("│ skills")));
	assert.deepEqual(skillRowsOf(), ["│ skills   ▸ 4 loaded · 2 package · 1 user · 1 project", "│          ctrl+alt+s or /skills to unfold"], "folded by default");

	const before = renders;
	await command.handler("", sim.ctx);
	assert.ok(renders > before, "unfolding repaints");
	assert.deepEqual(skillRowsOf(), [
		"│ skills   ▾ 4 loaded · 2 package · 1 user · 1 project",
		"│          ctrl+alt+s or /skills to fold",
		"│          package gentle-design, btw",
		"│          user    go-testing",
		"│          project local-skill",
	]);
	const unfolded = renders;
	await command.handler("", sim.ctx);
	assert.ok(renders > unfolded, "folding repaints");
	assert.deepEqual(skillRowsOf(), ["│ skills   ▸ 4 loaded · 2 package · 1 user · 1 project", "│          ctrl+alt+s or /skills to unfold"], "/skills again folds it");
	assert.deepEqual(sim.notices, [], "no notice");
	sim.emit("session_shutdown");
});

test("the skills row follows Pi's list on the next cheap read (turn end), so /reload and new skills show; no getCommands keeps the session rows as before (skills-view S4, S1)", async () => {
	let commands: unknown[] = [skillCommand("btw", "package")];
	const sim = simulate("E:\\DEV\\app", { commands: () => commands });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const row = () => sessionRows(railOf(sim)(58)).find((line) => line.startsWith("│ skills"))?.replace(/ +│$/, "");
	assert.equal(row(), "│ skills   ▸ 1 loaded · 1 package");
	commands = [];
	sim.emit("turn_end");
	assert.equal(row(), "│ skills   none loaded", "Pi loaded none");
	commands = [skillCommand("btw", "package"), skillCommand("go-testing", "top-level", "temporary")];
	sim.emit("model_select");
	assert.equal(row(), "│ skills   ▸ 2 loaded · 1 package · 1 user", "a temporary skill counts as user");
	sim.emit("session_shutdown");

	// Pi without getCommands: no skills row; the no-MCP test above pins the other session rows.
	const bare = simulate("E:\\DEV\\app");
	bare.emit("session_start");
	bare.widgets.get("fisi-dock")!(bare.tui);
	assert.ok(!railOf(bare)(58).some((line) => line.includes("skills")), "no row");
	await bare.commands.get("skills")!.handler("", bare.ctx);
	assert.ok(!railOf(bare)(58).some((line) => line.includes("skills")), "/skills with nothing to unfold changes nothing");
	bare.emit("session_shutdown");
});

test("/skills with Fisi Dock off or no live session only says so (skills-view S2)", async (t) => {
	stateDir(t, true);
	const sim = simulate("E:\\DEV\\app", { commands: () => SKILL_COMMANDS });
	await sim.commands.get("skills")!.handler("", sim.ctx);
	assert.deepEqual(sim.notices, ["Fisi Dock: no live session to show yet"]);

	stateDir(t, false);
	const off = simulate("E:\\DEV\\app", { commands: () => SKILL_COMMANDS });
	off.emit("session_start");
	await off.commands.get("skills")!.handler("", off.ctx);
	assert.deepEqual(off.notices, ["Fisi Dock is off · /fisi-dock on turns it back on"]);
	off.emit("session_shutdown");
});

test("ctrl+alt+s unfolds and folds the skills row like /skills, repainting each time (skills-view S6)", async () => {
	const sim = simulate("E:\DEV\app", { commands: () => SKILL_COMMANDS });
	const shortcut = sim.shortcuts.get("ctrl+alt+s");
	assert.ok(shortcut, "ctrl+alt+s registered");
	assert.match(shortcut.description ?? "", /skills/i);
	assert.match(sim.commands.get("skills")!.description ?? "", /ctrl\+alt\+s/, "/skills names its shortcut");
	sim.emit("session_start");
	let renders = 0;
	sim.widgets.get("fisi-dock")!({ ...sim.tui, requestRender: () => void renders++ });
	const skillRowsOf = () => sessionRows(railOf(sim)(58)).map((line) => line.replace(/ +│$/, "")).filter((line, index, rows) => index >= rows.findIndex((row) => row.startsWith("│ skills")));
	const folded = ["│ skills   ▸ 4 loaded · 2 package · 1 user · 1 project", "│          ctrl+alt+s or /skills to unfold"];
	assert.deepEqual(skillRowsOf(), folded, "folded by default");
	const noticesBefore = [...sim.notices];

	const before = renders;
	await shortcut.handler(sim.ctx);
	assert.ok(renders > before, "unfolding repaints");
	assert.deepEqual(skillRowsOf(), [
		"│ skills   ▾ 4 loaded · 2 package · 1 user · 1 project",
		"│          ctrl+alt+s or /skills to fold",
		"│          package gentle-design, btw",
		"│          user    go-testing",
		"│          project local-skill",
	]);
	const unfolded = renders;
	await shortcut.handler(sim.ctx);
	assert.ok(renders > unfolded, "folding repaints");
	assert.deepEqual(skillRowsOf(), folded, "ctrl+alt+s again folds it");
	// The command and the shortcut share one toggle.
	await shortcut.handler(sim.ctx);
	await sim.commands.get("skills")!.handler("", sim.ctx);
	assert.deepEqual(skillRowsOf(), folded, "/skills folds what ctrl+alt+s unfolded");
	assert.deepEqual(sim.notices, noticesBefore, "the toggle adds no notice");
	sim.emit("session_shutdown");
});

test("no Fisi Dock shortcut is a Pi built-in key, so Pi reports no shortcut conflict at startup (skills-view S6)", async () => {
	// Pi warns about any extension key that equals a built-in default key, even one
	// bound only inside a picker (ctrl+s is app.models.save). Read Pi's own table.
	const { KEYBINDINGS } = await import(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js", import.meta.url).href) as { KEYBINDINGS: Record<string, { defaultKeys?: string | string[] }> };
	const builtIn = new Set(Object.values(KEYBINDINGS).flatMap((binding) => [binding.defaultKeys ?? []].flat()));
	assert.ok(builtIn.has("ctrl+s"), "the table is Pi's: ctrl+s saves the model selection");
	const sim = simulate("E:\\DEV\\app", { commands: () => SKILL_COMMANDS });
	assert.deepEqual([...sim.shortcuts.keys()], ["ctrl+alt+s"]);
	for (const key of sim.shortcuts.keys()) assert.ok(!builtIn.has(key), `${key} is not a Pi built-in key`);
});

test("ctrl+alt+s with Fisi Dock off or no live session says what /skills says (skills-view S6)", async (t) => {
	stateDir(t, true);
	const sim = simulate("E:\DEV\app", { commands: () => SKILL_COMMANDS });
	await sim.shortcuts.get("ctrl+alt+s")!.handler(sim.ctx);
	assert.deepEqual(sim.notices, ["Fisi Dock: no live session to show yet"]);

	stateDir(t, false);
	const off = simulate("E:\DEV\app", { commands: () => SKILL_COMMANDS });
	off.emit("session_start");
	await off.shortcuts.get("ctrl+alt+s")!.handler(off.ctx);
	assert.deepEqual(off.notices, ["Fisi Dock is off · /fisi-dock on turns it back on"]);
	off.emit("session_shutdown");
});

test("a Pi without registerShortcut still loads Fisi Dock, and /skills still unfolds the row (skills-view S6)", async () => {
	const sim = simulate("E:\DEV\app", { commands: () => SKILL_COMMANDS, shortcuts: false });
	assert.equal(sim.shortcuts.size, 0);
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	await sim.commands.get("skills")!.handler("", sim.ctx);
	assert.ok(sessionRows(railOf(sim)(58)).some((line) => line.startsWith("│ skills   ▾")), "unfolded");
	sim.emit("session_shutdown");
});

test("under the skills row a muted line names how to unfold it, and how to fold it when open, at every width; no shortcut or no skills, no line (skills-view S7)", async () => {
	const sim = simulate("E:\DEV\app", { commands: () => SKILL_COMMANDS });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const rowsAt = (width: number) => {
		const rows = sessionRows(railOf(sim)(width)).map((line) => line.replace(/ +│$/, ""));
		const at = rows.findIndex((line) => line.startsWith("│ skills"));
		return rows.slice(at, at + 2);
	};
	assert.deepEqual(rowsAt(58), ["│ skills   ▸ 4 loaded · 2 package · 1 user · 1 project", "│          ctrl+alt+s or /skills to unfold"], "the rail's width");
	assert.deepEqual(rowsAt(52), ["│ skills   ▸ 4 loaded · 2 package · 1 user", "│          ctrl+alt+s or /skills to unfold"], "narrower: counts drop, the line stays");
	assert.deepEqual(rowsAt(70), ["│ skills   ▸ 4 loaded · 2 package · 1 user · 1 project", "│          ctrl+alt+s or /skills to unfold"], "wide: still on its own line");
	assert.equal(rowsAt(30)[1], "│          ctrl+alt+s or …", "too narrow: cut");
	const raw = (sim.parts.get("footer") as { render(width: number): string[] }).render(58).find((line) => line.includes("to unfold"))!;
	assert.ok(raw.includes(`${fgCode(palette.muted)}ctrl+alt+s or /skills to unfold`), "the line is muted");
	await sim.shortcuts.get("ctrl+alt+s")!.handler(sim.ctx);
	assert.deepEqual(rowsAt(58), ["│ skills   ▾ 4 loaded · 2 package · 1 user · 1 project", "│          ctrl+alt+s or /skills to fold"], "unfolded: how to fold it, above the names");
	sim.emit("session_shutdown");

	const none = simulate("E:\DEV\app", { commands: () => [] });
	none.emit("session_start");
	none.widgets.get("fisi-dock")!(none.tui);
	assert.ok(!sessionRows(railOf(none)(70)).some((line) => line.includes("to unfold")), "nothing to unfold, no line");
	none.emit("session_shutdown");

	const old = simulate("E:\DEV\app", { commands: () => SKILL_COMMANDS, shortcuts: false });
	old.emit("session_start");
	old.widgets.get("fisi-dock")!(old.tui);
	assert.ok(!sessionRows(railOf(old)(70)).some((line) => line.includes("to unfold")), "a Pi without registerShortcut gets no line");
	old.emit("session_shutdown");
});

test("the fisi-dock marker is set at load and session_start, and cleared on session_shutdown (S24)", () => {
	const marker = Symbol.for("fisi-dock");
	const global = globalThis as Record<symbol, unknown>;
	delete global[marker];
	const sim = simulate("E:\\DEV\\app");
	assert.equal(global[marker], true, "set at load (the welcome card reads it)");
	sim.emit("session_shutdown");
	assert.equal(global[marker], false, "a removed Fisi Dock never leaves Gentle Shell's cards hidden after /reload");
	sim.emit("session_start");
	assert.equal(global[marker], true);
	sim.emit("session_shutdown");
	assert.equal(global[marker], false);
});

test("with Gentle Shell, the user's messages render boxed from session_start until session_shutdown (S45)", () => {
	// Stands in for Pi's class: only the constructor name and the zone marks matter.
	class UserMessageComponent {
		children: unknown[] = [];
		render(width: number): string[] {
			const row = (text: string) => text + " ".repeat(Math.max(0, width - text.length));
			return [`\x1b]133;A\x07${row("")}`, row(" hola"), `\x1b]133;B\x07\x1b]133;C\x07${row("")}`];
		}
	}
	const message = new UserMessageComponent();
	const original = message.render(20);
	const sim = simulate("E:\\DEV\\app");
	Object.assign(sim.tui, { children: [{ children: [message] }] });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	assert.deepEqual(message.render(20).map(plain).map((line) => line.replace(/\x1b\]133;[ABC]\x07/g, "")), [
		"╭─ you ────────────╮",
		"│ hola             │",
		"╰──────────────────╯",
	]);
	sim.emit("session_shutdown");
	assert.deepEqual(message.render(20), original, "Pi's own lines once Fisi Dock is gone");
});

test("session_shutdown leaves a user frame hook that a newer Fisi Dock set (S45, reload order)", () => {
	const HOOK = Symbol.for("fisi-dock.user-frame");
	const scope = globalThis as Record<symbol, unknown>;
	const sim = simulate("E:\\DEV\\app");
	sim.emit("session_start");
	assert.equal(typeof scope[HOOK], "function", "ours while the session runs");
	const newer = () => ["newer"];
	scope[HOOK] = newer;
	try {
		sim.emit("session_shutdown");
		assert.equal(scope[HOOK], newer, "another instance's hook stays");
	} finally {
		delete scope[HOOK];
	}
});

test("/dock and the rail list every todo task from the session (S26, S58)", async () => {
	const titles = [...Array.from({ length: 7 }, (_, index) => `Finished step ${index + 1}`), "Write the release notes"];
	const tasks = titles.map((title, index) => ({ id: index + 1, title, status: index < 7 ? "done" : "in_progress" }));
	const branch = () => [{ type: "message", message: { role: "toolResult", toolName: "todo", details: { gentleTodo: { tasks } } } }];
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false, branch });
	sim.emit("session_start");
	const rail = sim.widgets.get("fisi-dock")!(sim.tui);
	rail.render(47);
	const footer = sim.parts.get("footer") as { render(width: number): string[] };
	const side = footer.render(55).map(plain);
	const railShown = titles.map((title) => side.findIndex((line) => line.includes(title)));
	assert.ok(railShown.every((index) => index > 0), "8 tasks: every title in the rail");
	assert.deepEqual(railShown, railShown.toSorted((a, b) => a - b), "in list order");
	assert.ok(!side.some((line) => /✓ 7 done/.test(line)), "no done summary row");

	const pending = Promise.resolve(sim.commands.get("dock")!.handler("", sim.ctx));
	await new Promise((resolve) => setTimeout(resolve, 0));
	const custom = sim.customs[0];
	const view = custom.factory({ terminal: { columns: 64, rows: 80 }, requestRender() {} }, {}, KEYS, custom.closed);
	const lines = view.render(59).map(plain);
	const shown = titles.map((title) => lines.findIndex((line) => line.includes(title)));
	assert.ok(shown.every((index) => index > 0), "every task title in /dock");
	assert.deepEqual(shown, shown.toSorted((a, b) => a - b), "in list order");
	assert.match(lines[shown[0]], /│ ✓ Finished step 1/);
	assert.match(lines[shown[7]], /│▎⠹ Write the release notes/);
	console.log(`--- simulated /dock todo, 8 tasks\n${lines.filter((_line, index) => index >= shown[0] - 1 && index <= shown[7] + 1).join("\n")}`);
	view.handleInput?.("\x1b");
	await pending;
	sim.emit("session_shutdown");
});

/** Quality motion (no animations.json in a missing config home) and a fake clock at 0 for one test. */
function animated(t: TestContext): void {
	const saved = { orbs: process.env.FISI_DOCK_ORBS, home: process.env.GENTLE_PI_CONFIG_HOME, prefix: process.env.GENTLE_SHELL_PREFIX };
	delete process.env.FISI_DOCK_ORBS;
	delete process.env.GENTLE_SHELL_PREFIX;
	process.env.GENTLE_PI_CONFIG_HOME = fileURLToPath(new URL("./fixtures/missing-config-home", import.meta.url));
	t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
	t.after(() => {
		for (const [key, value] of [["FISI_DOCK_ORBS", saved.orbs], ["GENTLE_PI_CONFIG_HOME", saved.home], ["GENTLE_SHELL_PREFIX", saved.prefix]] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
}

test("running spinners move with the wall clock in the strip and the rail, and stop with the work (S31)", (t) => {
	animated(t);
	let renders = 0;
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false });
	const tui = { terminal: sim.tui.terminal, requestRender: () => void renders++ };
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(tui);
	const strip = sim.widgets.get("fisi-dock-strip")!(tui);
	const rail = sim.parts.get("footer") as { render(width: number): string[]; digest(): string };
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	assertJobCard(strip.render(64), "⠋", "frame at 0 ms");
	const digest = rail.digest();
	let before = renders;
	t.mock.timers.tick(80);
	assert.ok(renders > before, "the next frame repaints");
	assert.notEqual(rail.digest(), digest, "the rail memo key follows the frame");
	assertJobCard(strip.render(64), "⠙");
	assert.ok(rail.render(47).some((line) => /^│ ⠙ job-1 npm test +0:00 │$/.test(plain(railPanelLine(line)))), "rail agent row with its time");
	t.mock.timers.tick(80);
	assertJobCard(strip.render(64));
	t.mock.timers.tick(920);
	assert.ok(rail.render(47).some((line) => /^│ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] job-1 npm test +0:01 │$/.test(plain(railPanelLine(line)))), "the rail's time ticks each second");

	sim.emitEvent("gentle-ai:jobs-sidebar", { sessionId: "s1", snapshot: { jobs: [{ id: "job-1", label: "npm test", startedAt: 1, status: "exited" }] } });
	const idle = rail.digest();
	before = renders;
	t.mock.timers.tick(800);
	assert.equal(renders, before, "nothing runs: no repaints");
	assert.equal(rail.digest(), idle);
	assert.ok(rail.render(47).some((line) => /^│ ✓ job-1 npm test +│$/.test(plain(railPanelLine(line)))));
	sim.emit("session_shutdown");
});

test("the phone todo card's active row spins with the clock (S31, S28)", (t) => {
	animated(t);
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false, branch: () => todoBranch(8, 10) });
	sim.emit("session_start");
	sim.emit("agent_start");
	const strip = sim.widgets.get("fisi-dock-strip")!(sim.tui);
	assert.match(plain(strip.render(53)[2]), /^│▎⠋ Wire the todo card +│$/);
	t.mock.timers.tick(240);
	assert.match(plain(strip.render(53)[2]), /^│▎⠸ Wire the todo card +│$/);
	sim.emit("session_shutdown");
	const after = plain(strip.render(53)[2] ?? "");
	t.mock.timers.tick(80);
	assert.equal(plain(strip.render(53)[2] ?? ""), after, "no ticks after shutdown");
});

test("potato motion: running spinners hold the still ⠹ and start no timer (S31)", (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
	let renders = 0;
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false });
	const tui = { terminal: sim.tui.terminal, requestRender: () => void renders++ };
	sim.emit("session_start");
	const strip = sim.widgets.get("fisi-dock-strip")!(tui);
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	assertJobCard(strip.render(64));
	const before = renders;
	t.mock.timers.tick(800);
	assert.equal(renders, before, "no fast timer");
	assertJobCard(strip.render(64));
	sim.emit("session_shutdown");
});

test("an in_progress todo spins only while a run is active: still ⠹ and no timer before and after (L61, S31)", (t) => {
	animated(t);
	let renders = 0;
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false, branch: () => todoBranch(8, 10) });
	const tui = { terminal: sim.tui.terminal, requestRender: () => void renders++ };
	sim.emit("session_start");
	const strip = sim.widgets.get("fisi-dock-strip")!(tui);
	// After the run settles a heads-up line joins the strip, so the row is found by its title.
	const row = () => strip.render(53).map(plain).find((line) => line.includes("Wire the todo card"))!;
	assert.match(row(), /^│▎⠹ Wire the todo card +│$/, "replayed list, no run: the still frame");
	let before = renders;
	t.mock.timers.tick(800);
	assert.equal(renders, before, "no fast timer while no run is active");

	sim.emit("agent_start");
	t.mock.timers.tick(80);
	assert.match(row(), /^│▎⠙ Wire the todo card +│$/, "spins while the run is active (frame at 880 ms)");
	assert.ok(renders > before);

	sim.emit("agent_settled");
	assert.match(row(), /^│▎⠹ Wire the todo card +│$/, "settled with the task still in progress: the still frame");
	before = renders;
	t.mock.timers.tick(800);
	assert.equal(renders, before, "no fast timer after the run settled");

	// A running agent still spins with no run active.
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	before = renders;
	t.mock.timers.tick(80);
	assert.ok(renders > before, "a running job keeps the spinner going");
	sim.emit("session_shutdown");
});

// --- S34b: short screens ---------------------------------------------------------

test("short terminal: the rail panel keeps the logo and agents; the digest follows the rows; /dock keeps everything (S38, S34)", async () => {
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true });
	const terminal = sim.tui.terminal as Record<string | symbol, unknown>;
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	const rail = sim.parts.get("footer") as { render(width: number): string[]; digest(): string };
	// The panel inside the rail, after the divider and a blank (sidebar-chrome).
	const panel = () => rail.render(58).map((line) => plain(railPanelLine(line)));
	const full = panel();
	assert.ok(!full[0].startsWith("╭"), "no rows known: the logo shows");
	const tall = rail.digest();

	// The rail sits under the top row: two rows of the screen are not the panel's.
	terminal.rows = full.length + 2;
	assert.deepEqual(panel(), full, "it fits: unchanged");
	terminal.rows = full.length + 1;
	assert.ok(!full.some((line) => /^│ (where|usage|connections) ──/.test(line)), "no session group labels to drop (sidebar-chrome 02)");
	assert.deepEqual(panel(), full, "no labels, odd or changes to drop: logo and agents stay, the rail scrolls");
	assert.notEqual(rail.digest(), tall, "the rail memo key follows the rows");
	// A tall screen: the rail fills its rows so the divider spans them; the panel stays as is.
	terminal.rows = full.length + 12;
	const padded = panel();
	assert.equal(padded.length, full.length + 10, "the rail fills the rows under the top row");
	assert.deepEqual(padded.slice(0, full.length).map((line) => line.trimEnd()), full.map((line) => line.trimEnd()), "the panel on top, unchanged");
	assert.deepEqual(padded.slice(full.length).map((line) => line.trim()), Array(10).fill(""), "blank rows under it");
	terminal.rows = 6;
	const tiny = panel();
	assert.ok(!tiny[0].startsWith("╭") && tiny.some((line) => line.startsWith("╭─ session")) && tiny.some((line) => line.startsWith("╭─ agents")), "logo, session and agents kept");
	for (const line of rail.render(58)) assert.ok(visibleWidth(line) <= 58);

	// /dock is not limited: it scrolls and shows everything.
	const pending = Promise.resolve(sim.commands.get("dock")!.handler("", sim.ctx));
	await new Promise((resolve) => setTimeout(resolve, 0));
	const custom = sim.customs[0];
	const view = custom.factory({ terminal: { columns: 64, rows: 80 }, requestRender() {} }, {}, KEYS, custom.closed);
	const dock = view.render(59).map(plain);
	assert.ok(dock.some((line) => line.includes("╭─ agents")) && !dock[1].includes("╭─ session"), "logo and agents in /dock");
	view.handleInput?.("\x1b");
	await pending;
	sim.emit("session_shutdown");
});

// --- S34a: idle refresh ----------------------------------------------------------

test("idle refresh: git, heads-up git, plans and MCP state re-read every ~10 s while idle and visible, never during a run (S34, L61)", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
	const calls: string[] = [];
	let status = "";
	const exec: Exec = async (_command, args) => {
		calls.push(args.join(" "));
		if (args[0] === "status") return { code: 0, stdout: status, stderr: "" };
		if (args[0] === "rev-parse") return { code: 0, stdout: "main\n", stderr: "" };
		if (args[0] === "diff") return { code: 0, stdout: "", stderr: "" };
		return { code: 1, stdout: "", stderr: "" };
	};
	const { cwd } = mcpFolders(t, { mcpServers: { rea: {} } });
	const tools: unknown[] = [];
	const sim = simulate(cwd, { ownsHost: () => true, exec, tools: () => tools });
	const terminal = sim.tui.terminal as Record<symbol, unknown>;
	const state = terminal[SIDEBAR_STATE];
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const rail = () => railOf(sim)(58);
	await waitFor(() => rail().some((line) => line.startsWith("│ mcp")));
	await waitFor(() => calls.filter((call) => call.startsWith("worktree")).length > 0);
	await new Promise((resolve) => setTimeout(resolve, 30));
	const count = (prefix: string) => calls.filter((call) => call.startsWith(prefix)).length;
	const start = { status: count("status"), worktree: count("worktree") };

	// Idle and visible: one tick re-reads git changes and heads-up git data.
	status = " M lib/panel.ts\0";
	tools.push({ name: "mcp__rea__decompile", exposure: "deferred" });
	t.mock.timers.tick(10_000);
	await waitFor(() => rail().some((line) => line.includes("lib/panel.ts")));
	assert.equal(count("status"), start.status + 1, "git changes re-read once");
	await waitFor(() => count("worktree") > start.worktree);
	assert.equal(count("worktree"), start.worktree + 1, "heads-up git re-read once");
	assert.ok(rail().some((line) => /^│ mcp +● rea/.test(line)));
	const raw = (sim.parts.get("footer") as { render(width: number): string[] }).render(58).map(railPanelLine).find((line) => plain(line).startsWith("│ mcp"))!;
	assert.ok(raw.includes(dotBefore([0x8f, 0xc9, 0x8f], "rea")), "MCP state refreshed without any event");

	// A run is active: no idle reads (the run's own triggers refresh).
	sim.emit("agent_start");
	const during = calls.length;
	t.mock.timers.tick(30_000);
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(calls.length, during, "nothing read by the idle timer during a run");
	sim.emit("agent_settled");
	await new Promise((resolve) => setTimeout(resolve, 30));

	// Not on screen (no Gentle Shell sidebar state): no reads.
	delete terminal[SIDEBAR_STATE];
	const hidden = calls.length;
	t.mock.timers.tick(30_000);
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(calls.length, hidden, "nothing read while nothing of ours is visible");
	terminal[SIDEBAR_STATE] = state;

	// Disposed: the timer is gone.
	sim.emit("session_shutdown");
	const after = calls.length;
	t.mock.timers.tick(30_000);
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(calls.length, after, "no reads after shutdown");
});

// --- S32: session review, cost and MCP rows ------------------------------------

const sessionRows = (lines: string[]) => {
	const start = lines.findIndex((line) => line.startsWith("╭─ session"));
	return lines.slice(start + 1, lines.findIndex((line, index) => index > start && line.startsWith("╰")));
};

test("no MCP config: a muted `mcp none configured` row, cost in session and no footer under the panel (S32, S8, artboard 02)", async () => {
	const sim = simulate("E:\\DEV\\app");
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	await waitFor(() => railOf(sim)(58).some((line) => line.startsWith("│ mcp")));
	const lines = railOf(sim)(58);
	assert.deepEqual(sessionRows(lines).map((line) => line.replace(/ +│$/, "")), [
		"│ project  app",
		"│ cost     $0.000",
		"│ memory   ○ engram  not installed",
		"│ mcp      none configured",
	]);
	const raw = (sim.parts.get("footer") as { render(width: number): string[] }).render(58).map(railPanelLine).find((line) => plain(line).startsWith("│ mcp"))!;
	assert.ok(raw.includes("\x1b[38;2;108;108;108mnone configured"), "muted");
	assert.match(lines.at(-1)!, /^╰─+╯$/, "the panel ends with the last section");
	assert.ok(!lines.some((line) => /^─+$/.test(line)), "no footer separator");
	sim.emit("session_shutdown");
});

// --- memory (Engram) in the session's connections group (artboard 02) -------------

test("engram memory row from gentle-engram's mem_* tools: not installed, connected · N saved from tool ends, unreachable after a failed call, connected again after a success; nothing spawned", async () => {
	const calls: string[] = [];
	const exec: Exec = async (command, args) => {
		calls.push([command, ...args].join(" "));
		return { code: 1, stdout: "", stderr: "" };
	};
	const tools: { name: string }[] = [{ name: "read" }];
	const sim = simulate("E:\\DEV\\app", { exec, tools: () => tools });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const row = () => sessionRows(railOf(sim)(47)).find((line) => line.startsWith("│ memory"));
	const raw = () => (sim.parts.get("footer") as { render(width: number): string[] }).render(47).map(railPanelLine).find((line) => plain(line).startsWith("│ memory"))!;
	const toolEnd = (toolName: string, isError = false) => {
		for (const handler of sim.handlers.get("tool_execution_end") ?? []) handler({ type: "tool_execution_end", toolCallId: `c-${toolName}`, toolName, result: { content: [] }, isError }, sim.ctx);
	};
	assert.match(row()!, /^│ memory   ○ engram  not installed +│$/, "no mem_save tool: not installed");
	assert.ok(raw().includes("\x1b[38;2;74;74;74m○"), "faint ○");
	toolEnd("mem_save");
	assert.match(row()!, /not installed/, "a call without the tool loaded changes nothing drawn");

	// gentle-engram loaded: its tools show on the next Pi read.
	tools.push({ name: "mem_save" }, { name: "mem_search" }, { name: "mem_context" });
	sim.emit("turn_end");
	assert.match(row()!, /^│ memory   ● engram  connected · 1 saved +│$/, "the earlier successful save counts");
	assert.ok(raw().includes("\x1b[38;2;143;201;143m●"), "green ●");
	toolEnd("mem_save");
	toolEnd("mem_search");
	toolEnd("bash", true);
	assert.match(row()!, /connected · 2 saved/, "each mem_save that ended without error, at its tool end");

	toolEnd("mem_save", true);
	assert.match(row()!, /^│ memory   ✗ engram  unreachable +│$/, "the last mem_* call failed");
	assert.ok(raw().includes("\x1b[38;2;255;107;107munreachable"), "red");
	sim.emit("turn_end");
	assert.match(row()!, /unreachable/, "stays until a mem_* call succeeds");
	toolEnd("mem_context");
	assert.match(row()!, /^│ memory   ● engram  connected · 2 saved +│$/, "a later success: connected again");

	assert.ok(!calls.some((call) => /engram|mem_/.test(call)), `no process asked about Engram: ${calls.join(", ")}`);
	sim.emit("session_shutdown");
});

// --- S99: the model profile Gentle Shell's own Status and top row show ----------

test("the session section shows Gentle Shell's profile and follows a switch on the idle refresh (S99)", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const BINDINGS = Symbol.for("gentle-pi:session-profile-bindings");
	const FREEZE = Symbol.for("gentle-pi:session-profile-freeze");
	const holder = globalThis as Record<symbol, unknown>;
	const saved = [holder[BINDINGS], holder[FREEZE]];
	t.after(() => {
		holder[BINDINGS] = saved[0];
		holder[FREEZE] = saved[1];
	});
	const bindings = new Map<string, unknown>();
	holder[BINDINGS] = bindings;
	holder[FREEZE] = { frozen: new Map([["s1", { profile: { name: "claude", origin: "global", modelProfiles: {} } }]]) };
	const sim = simulate("E:\\DEV\\app");
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const profileRow = () => sessionRows(railOf(sim)(58)).find((line) => line.startsWith("│ profile"));
	await waitFor(() => profileRow() !== undefined);
	assert.match(profileRow()!, /^│ profile +claude +\$0\.000 │$/, "the cost flush right on the profile row");

	// Use in this session (/gentle:profiles): the next idle tick reads it.
	bindings.set("s1", { name: "fast", origin: "user", modelProfiles: {} });
	t.mock.timers.tick(10_000);
	await waitFor(() => profileRow()?.includes("fast (session)") ?? false);

	// /gentle:profiles clear on a session that started with no profile: the row goes.
	bindings.delete("s1");
	holder[FREEZE] = { frozen: new Map([["s1", { profile: undefined }]]) };
	t.mock.timers.tick(10_000);
	await waitFor(() => profileRow() === undefined);
	sim.emit("session_shutdown");
});

/** A Pi agent dir and a project with mcp.json files in a fresh temp folder, removed after the test. */
function mcpFolders(t: TestContext, global: unknown, project?: unknown): { cwd: string } {
	const root = mkdtempSync(join(tmpdir(), "fisi-dock-mcp-"));
	t.after(() => {
		rmSync(root, { recursive: true, force: true });
		process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
	});
	mkdirSync(join(root, "agent"));
	writeFileSync(join(root, "agent", "mcp.json"), JSON.stringify(global));
	const cwd = join(root, "app");
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	if (project !== undefined) writeFileSync(join(cwd, ".pi", "mcp.json"), JSON.stringify(project));
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	return { cwd };
}

const mcpTool = (name: string, extra: Record<string, unknown> = {}) => ({ name, description: "", parameters: {}, exposure: "deferred", sourceInfo: {}, ...extra });
const dotBefore = (color: readonly number[], name: string) => `\x1b[38;2;${color.join(";")}m●\x1b[39m \x1b[38;2;225;225;225m${name}`;

test("MCP servers from Pi's mcp.json and the project's: one row each, green with tools, amber while connecting, red after ~10 s (S32, artboard 02)", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
	const { cwd } = mcpFolders(
		t,
		{ mcpServers: { engram: { command: "engram", env: { API_TOKEN: "s3cr3t-token" } }, context7: { url: "https://example.invalid" }, rea: { command: "rea" }, off: { enabled: false } } },
		{ mcpServers: { local: { command: "local" } } },
	);
	const tools = [mcpTool("read", { exposure: "direct" }), mcpTool("mcp__engram__mem_save"), mcpTool("resolve", { namespace: { name: "mcp__context7" } })];
	const sim = simulate(cwd, { tools: () => tools });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const connections = () => {
		const rows = sessionRows(railOf(sim)(58));
		return rows.slice(rows.findIndex((line) => line.startsWith("│ memory"))).map((line) => line.replace(/ +│$/, ""));
	};
	await waitFor(() => connections().some((line) => line.startsWith("│ mcp")));
	assert.deepEqual(connections(), [
		"│ memory   ○ engram    not installed",
		"│ mcp      ● engram    connected",
		"│          ● context7  connected",
		"│          ◌ rea       connecting",
		"│          ◌ local     connecting",
	], "an MCP server named engram is not gentle-engram's mem_save tool");
	const raw = (name: string) => (sim.parts.get("footer") as { render(width: number): string[] }).render(58).map(railPanelLine).find((line) => /^│ (mcp| ) +[●◌✗] /.test(plain(line)) && plain(line).includes(` ${name} `))!;
	const glyphBefore = (color: readonly number[], glyph: string, name: string) => `\x1b[38;2;${color.join(";")}m${glyph}\x1b[39m \x1b[38;2;225;225;225m${name}`;
	assert.ok(raw("engram").includes(glyphBefore([0x8f, 0xc9, 0x8f], "●", "engram")), "engram green");
	assert.ok(raw("context7").includes(glyphBefore([0x8f, 0xc9, 0x8f], "●", "context7")), "context7 green (namespace)");
	assert.ok(raw("rea").includes(glyphBefore([0xe0, 0xaf, 0x68], "◌", "rea")), "rea amber while connecting");
	assert.ok(raw("local").includes(glyphBefore([0xe0, 0xaf, 0x68], "◌", "local")), "local amber while connecting");
	const rows = sessionRows(railOf(sim)(58));
	assert.ok(rows.findIndex((line) => line.startsWith("│ mcp")) > rows.findIndex((line) => /^│ cost +\$0\.000 +│$/.test(line)), "mcp after the cost row");

	// A server that connects late turns green on the next refresh; one that never does turns red.
	t.mock.timers.tick(10_000);
	tools.push(mcpTool("mcp__local__ping"));
	sim.emit("turn_end");
	assert.ok(raw("rea").includes(glyphBefore([0xff, 0x6b, 0x6b], "✗", "rea")) && plain(raw("rea")).includes("failed"), "rea red after the grace period");
	assert.ok(raw("local").includes(glyphBefore([0x8f, 0xc9, 0x8f], "●", "local")), "local green once its tools exist");
	const all = railOf(sim)(58).join("\n");
	assert.ok(!all.includes("s3cr3t") && !all.includes("example.invalid") && !/\boff\b/.test(all), "only enabled server names are drawn");
	for (const width of [58, 55, 47, 30, 20]) for (const line of (sim.parts.get("footer") as { render(width: number): string[] }).render(width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
	const shown = railOf(sim)(58);
	console.log(`--- simulated session section with MCP, 58 columns\n${[shown.find((line) => line.startsWith("╭─ session"))!, ...sessionRows(shown)].join("\n")}`);
	sim.emit("session_shutdown");
});

test("Fisi Dock never handles mcp_servers_change: Pi stays the MCP connector (S32, L60)", () => {
	const sim = simulate("E:\\DEV\\app");
	assert.equal(sim.handlers.has("mcp_servers_change"), false);
});

// --- S35: the phone agents card ----------------------------------------------------

test("narrow: strip, then the agents card with each running agent's spinner, name, task and ticking time, then the todo card (S35, S8, S28)", async (t) => {
	animated(t);
	let wide = false;
	let renders = 0;
	const exec: Exec = async (command, args) =>
		command === "git" && args.join(" ") === "status --porcelain=v1 -z" ? { code: 0, stdout: " M lib/panel.ts\0", stderr: "" } : { code: 1, stdout: "", stderr: "" };
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => wide, exec, branch: () => todoBranch(8, 10) });
	const tui = { terminal: sim.tui.terminal, requestRender: () => void renders++ };
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(tui);
	const strip = sim.widgets.get("fisi-dock-strip")!(tui);
	// A job that reports no start counts from when Fisi Dock first saw it running: the clock's 0.
	sim.emitEvent("gentle-ai:jobs-sidebar", { sessionId: "s1", snapshot: { jobs: [{ id: "worker", label: "session rows" }] } });
	await waitFor(() => plain(strip.render(53)[0] ?? "").includes("±1 file"));
	t.mock.timers.tick(5_000);
	// Gentle Shell's other job started 40 s before the clock's 0.
	sim.emitEvent("gentle-ai:jobs-sidebar", { sessionId: "s1", snapshot: { jobs: [{ id: "worker", label: "session rows" }, { id: "job-1", label: "npm test", startedAt: -40_000 }] } });
	const lines = strip.render(53).map(plain);
	assert.equal(lines[0], "  ±1 file", "the strip first, without its agents and todo segments");
	assert.match(lines[1], /^╭─ agents ─+ 2 ─╮$/);
	assert.match(lines[2], /^│ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] worker +session rows +0:05 │$/, "no start reported: time since first seen");
	assert.match(lines[3], /^│ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] job-1 +npm test +0:45 │$/, "job: time since its startedAt");
	assert.match(lines[4], /^╰─+╯$/);
	assert.match(lines[5], /^╭─ todo ─+ 8\/10 ─╮$/, "the todo card under the agents card");
	assert.ok(!lines.some((line) => /\d+ agents?/.test(line)), "no agent count in the strip while the card shows (S8)");
	for (const width of [64, 53, 40, 20]) for (const line of strip.render(width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
	console.log(`--- simulated narrow strip + agents card + todo card, 53 columns\n${lines.join("\n")}`);

	const before = renders;
	t.mock.timers.tick(1_000);
	assert.ok(renders > before, "repaints while agents run");
	const next = strip.render(53).map(plain);
	assert.match(next[2], / 0:06 │$/, "the time ticks each second");
	assert.match(next[3], / 0:46 │$/);
	t.mock.timers.tick(80);
	assert.notEqual(strip.render(53).map(plain)[2][2], next[2][2], "the spinner turns");

	wide = true;
	assert.deepEqual(strip.render(53), [], "the rail shows the panel: no strip, no cards");
	wide = false;

	sim.emitEvent("gentle-ai:jobs-sidebar", { sessionId: "s1", snapshot: { jobs: [{ id: "worker", label: "session rows", status: "exited" }, { id: "job-1", label: "npm test", startedAt: -40_000, status: "exited" }] } });
	const done = strip.render(53).map(plain);
	assert.ok(!done.some((line) => line.startsWith("╭─ agents")), "finished agents: no agents card");
	const idle = renders;
	t.mock.timers.tick(2_000);
	assert.equal(renders, idle, "nothing runs: no ticking");
	sim.emit("session_shutdown");
});

// --- S37: subscription tokens and the API-price estimate ---------------------

/** Two claude-bridge (subscription) replies: tokens recorded, cost 0. */
const BRIDGE_ENTRIES = [1, 2].map(() => ({
	type: "message",
	message: {
		role: "assistant",
		provider: "claude-bridge",
		model: "claude-opus-5-5",
		usage: { input: 100_000, output: 200_000, cacheRead: 5_700_000, cacheWrite: 200_000, totalTokens: 6_200_000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	},
}));

/** Pi's model registry as the bridge leaves it: its own copy at cost 0, Anthropic's priced. */
const fakeRegistry = (asked: string[] = []) => ({
	find: (provider: string, id: string) => {
		asked.push(`${provider}/${id}`);
		if (id !== "claude-opus-5-5") return undefined;
		return { id, provider, cost: provider === "anthropic" ? { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
	},
});

test("claude-bridge replies at cost 0: session row and narrow header show tokens and the ≈ estimate (S37, S8)", async () => {
	let wide = true;
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => wide });
	const asked: string[] = [];
	sim.ctx.sessionManager.getEntries = (() => BRIDGE_ENTRIES) as never;
	(sim.ctx as Record<string, unknown>).modelRegistry = fakeRegistry(asked);
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const rows = sessionRows(railOf(sim)(58));
	// 2 × (0.4 + 4 + 1.14 + 1) = $13.08 at Anthropic's catalog price.
	const costRow = rows.find((row) => row.startsWith("│ cost"));
	assert.equal(costRow, `│ cost     12.4M tok · ≈$13${" ".repeat(27)} │`, "the panel at 56 inside the rail at 58");
	assert.ok(!rows.some((row) => row.includes("$0.000")), "no $0.000 while tokens are known");
	assert.ok(asked.includes("claude-bridge/claude-opus-5-5") && asked.includes("anthropic/claude-opus-5-5"), "own provider first, then anthropic");
	for (const width of [58, 47, 30, 20]) for (const line of (sim.parts.get("footer") as { render(width: number): string[] }).render(width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
	wide = false;
	const header = sim.parts.get("header") as { render(width: number): string[] };
	assert.ok(plain(header.render(64)[0]).includes("  12.4M tok · ≈$13"), plain(header.render(64)[0]));
	for (const width of [64, 53, 40, 20]) for (const line of header.render(width)) assert.ok(visibleWidth(line) <= width, `${width}: ${plain(line)}`);
	console.log(`--- S37 session row at 58 and narrow header at 64\n${costRow}\n${plain(header.render(64)[0])}`);
	sim.emit("session_shutdown");
});

test("claude-bridge replies with no priced model: tokens only, no estimate (S37)", () => {
	const sim = simulate("E:\\DEV\\app");
	sim.ctx.sessionManager.getEntries = (() => BRIDGE_ENTRIES) as never;
	(sim.ctx as Record<string, unknown>).modelRegistry = { find: () => undefined };
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	assert.match(sessionRows(railOf(sim)(58)).find((row) => row.startsWith("│ cost"))!, /^│ cost     12\.4M tok +│$/);
	sim.emit("session_shutdown");
});

test("a real cost above 0 keeps the cost row as today even with tokens (S37)", () => {
	const sim = simulate("E:\\DEV\\app");
	const paid = BRIDGE_ENTRIES.map((entry) => ({ ...entry, message: { ...entry.message, provider: "anthropic", usage: { ...entry.message.usage, cost: { ...entry.message.usage.cost, total: 0.0062 } } } }));
	sim.ctx.sessionManager.getEntries = (() => paid) as never;
	(sim.ctx as Record<string, unknown>).modelRegistry = fakeRegistry();
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	assert.match(sessionRows(railOf(sim)(58)).find((row) => row.startsWith("│ cost"))!, /^│ cost     \$0\.012 +│$/);
	sim.emit("session_shutdown");
});

test("a new RDD row enters: the clock repaints at 75 ms only while the entrance plays; the todo there at load stays still (S54)", (t) => {
	animated(t);
	let renders = 0;
	const sim = simulate("E:\\DEV\\app", { branch: () => todoBranch(1, 3) });
	const tui = { terminal: sim.tui.terminal, requestRender: () => void renders++ };
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(tui);
	const raw = () => (sim.parts.get("footer") as { render(width: number): string[] }).render(47);
	const ROSE = "\x1b[38;2;255;118;195m";
	const CORAL = "\x1b[38;2;255;155;133m";
	const todoRow = () => raw().find((line) => plain(line).includes("Wire the todo card"))!;
	assert.ok(!todoRow().includes(`${CORAL}W`), "the task active at load does not enter");
	let before = renders;
	t.mock.timers.tick(1_000);
	assert.equal(renders, before, "nothing runs, nothing enters: no timer");

	sim.emitEvent("gentle-ai:review-sidebar", { sessionId: "s1", snapshot: { state: "declined", scope: "a.ts" } });
	const row = () => raw().find((line) => plain(line).includes("a.ts skipped"))!;
	assert.ok(row().includes(`${ROSE}-`) && row().includes(`\x1b[1m${ROSE}a.ts skipped`), "step 0: the row flashes rose, its glyph too");
	before = renders;
	t.mock.timers.tick(75);
	assert.equal(renders, before + 1, "one repaint per 75 ms entrance step");
	t.mock.timers.tick(5 * 75);
	assert.ok(row().includes("\x1b[38;2;255;255;255m"), "the white shine crosses it");
	t.mock.timers.tick(2_000);
	assert.ok(!row().includes(ROSE) && !row().includes("255;255;255"), "over: today's look");
	before = renders;
	t.mock.timers.tick(1_000);
	assert.equal(renders, before, "the clock stopped with the entrance");
	sim.emit("session_shutdown");
});

// --- S64: CI checks of the last pushed commit ----------------------------------------

test("CI: gh runs show at session start; a failed read keeps them; an empty list, no runs or a branch change removes them; a git push reads after 5 s and 20 s (S64)", async (t) => {
	const start = Date.parse("2026-10-31T14:01:12Z");
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: start });
	// waitFor sleeps on setTimeout, which is mocked here: settle on setImmediate instead.
	const settle = async () => {
		for (let round = 0; round < 50; round++) await new Promise((resolve) => setImmediate(resolve));
	};
	const sha = "e6f1ffd0123456789abcdef0123456789abcdef0";
	const ghRun = (id: number, workflowName: string, status: string, conclusion: string) => ({ databaseId: id, workflowName, name: workflowName, status, conclusion, startedAt: "2026-10-31T14:00:00Z", updatedAt: "2026-10-31T14:00:34Z", createdAt: "2026-10-31T14:00:00Z", headSha: sha });
	let branch = "feat/x\n";
	let list: { code: number; stdout: string } = { code: 0, stdout: JSON.stringify([ghRun(1, "tests", "in_progress", ""), ghRun(2, "lint", "completed", "success")]) };
	const jobs = JSON.stringify({ jobs: [{ name: "node-22", conclusion: "failure", steps: [{ name: "Run npm test", conclusion: "failure" }] }] });
	const gh: string[] = [];
	const exec: Exec = async (command, args) => {
		if (command === "gh") {
			gh.push(args.join(" "));
			if (args[1] === "list") return { ...list, stderr: "" };
			if (args[1] === "view" && args[2] === "1") return { code: 0, stdout: jobs, stderr: "" };
			return { code: 1, stdout: "", stderr: "" };
		}
		if (args[0] === "rev-parse") return { code: 0, stdout: branch, stderr: "" };
		if (args[0] === "status" || args[0] === "diff") return { code: 0, stdout: "", stderr: "" };
		return { code: 1, stdout: "", stderr: "" };
	};
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, exec });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const ci = () => {
		const lines = railOf(sim)(47);
		const top = lines.findIndex((line) => line.startsWith("╭─ CI"));
		if (top < 0) return [];
		return [lines[top].replace(/─+/g, "─"), ...lines.slice(top + 1, lines.findIndex((line, index) => index > top && line.startsWith("╰"))).map((line) => line.slice(2).replace(/ +│$/, "").replace(/(\S) {2,}(\S)/g, "$1 $2"))];
	};
	const lists = () => gh.filter((call) => call.startsWith("run list")).length;
	await settle();

	// Session start: the runs of the branch from the git read.
	assert.deepEqual(gh, ["run list --branch feat/x --limit 20 --json databaseId,workflowName,name,status,conclusion,startedAt,updatedAt,createdAt,headSha"]);
	assert.deepEqual(ci(), ["╭─ CI ─ e6f1ffd ─╮", "✓ lint passed 0:34", "⠹ tests running… 1:12"]);

	// A run is going: read again after 30 s; a failed read keeps what is shown.
	list = { code: 1, stdout: "" };
	t.mock.timers.tick(30_000);
	await settle();
	assert.equal(lists(), 2, "read every 30 s while a run is going");
	assert.deepEqual(ci(), ["╭─ CI ─ e6f1ffd ─╮", "✓ lint passed 0:34", "⠹ tests running… 1:42"], "kept");

	// It failed: the failed job comes from gh run view.
	list = { code: 0, stdout: JSON.stringify([ghRun(1, "tests", "completed", "failure"), ghRun(2, "lint", "completed", "success")]) };
	t.mock.timers.tick(30_000);
	await settle();
	assert.ok(gh.includes("run view 1 --json jobs"));
	assert.deepEqual(ci(), ["╭─ CI ─ e6f1ffd ─╮", "✓ lint passed 0:34", "✗ tests failed 0:34", "  node-22 · Run npm test"]);

	// Nothing runs: every 3 min; a successful read with no runs removes the section.
	list = { code: 0, stdout: "[]" };
	t.mock.timers.tick(150_000);
	await settle();
	assert.equal(lists(), 3, "not before 3 min");
	t.mock.timers.tick(30_000);
	await settle();
	assert.equal(lists(), 4);
	assert.deepEqual(ci(), [], "no runs: no section");

	// A git push from bash: reads 5 s and 20 s after the tool ends.
	list = { code: 0, stdout: JSON.stringify([ghRun(3, "tests", "completed", "success")]) };
	const tool = (name: string, event: Record<string, unknown>) => {
		for (const handler of sim.handlers.get(name) ?? []) handler(event, sim.ctx);
	};
	tool("tool_execution_start", { toolName: "bash", toolCallId: "c1", args: { command: "git push origin feat/x" } });
	tool("tool_execution_end", { toolName: "bash", toolCallId: "c1", isError: false, result: {} });
	t.mock.timers.tick(4_999);
	await settle();
	assert.equal(lists(), 4, "not before 5 s");
	t.mock.timers.tick(1);
	await settle();
	assert.equal(lists(), 5, "5 s after the push");
	assert.deepEqual(ci(), ["╭─ CI ─ e6f1ffd ─╮", `✓ 1 check passed ${hhmmLocal(Date.parse("2026-10-31T14:00:34Z"))}`, "  tests · longest 0:34"]);
	t.mock.timers.tick(15_000);
	await settle();
	assert.equal(lists(), 6, "20 s after the push");
	tool("tool_execution_start", { toolName: "bash", toolCallId: "c2", args: { command: "git status" } });
	tool("tool_execution_end", { toolName: "bash", toolCallId: "c2", isError: false, result: {} });
	t.mock.timers.tick(20_000);
	await settle();
	assert.equal(lists(), 6, "other commands read nothing");

	// The branch changed: the shown runs go; the new branch's read fails, so nothing shows.
	branch = "main\n";
	list = { code: 1, stdout: "" };
	sim.emit("turn_end");
	await settle();
	assert.deepEqual(ci(), [], "a branch change clears the runs");
	assert.equal(lists(), 7, "the new branch is read right after the change");
	assert.equal(gh.filter((call) => call.startsWith("run list")).at(-1), "run list --branch main --limit 20 --json databaseId,workflowName,name,status,conclusion,startedAt,updatedAt,createdAt,headSha", "read for the new branch");

	// Disposed: no more reads.
	sim.emit("session_shutdown");
	const after = gh.length;
	t.mock.timers.tick(400_000);
	await settle();
	assert.equal(gh.length, after, "no reads after shutdown");
});

// --- S66: CI review findings ------------------------------------------------------

/** The CI test harness: fake git and gh, mocked timers, the rail's CI rows and the gh list calls. */
function ciSim(t: TestContext) {
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: Date.parse("2026-10-31T14:01:12Z") });
	const state = {
		branch: { code: 0, stdout: "feat/x\n" },
		list: { code: 0, stdout: JSON.stringify([{ databaseId: 1, workflowName: "tests", name: "tests", status: "in_progress", conclusion: "", startedAt: "2026-10-31T14:00:00Z", updatedAt: "2026-10-31T14:00:34Z", createdAt: "2026-10-31T14:00:00Z", headSha: "e6f1ffd0123456789abcdef0123456789abcdef0" }]) },
	};
	const gh: string[] = [];
	const exec: Exec = async (command, args) => {
		if (command === "gh") {
			gh.push(args.join(" "));
			return args[1] === "list" ? { ...state.list, stderr: "" } : { code: 1, stdout: "", stderr: "" };
		}
		if (args[0] === "rev-parse") return { ...state.branch, stderr: "" };
		if (args[0] === "status" || args[0] === "diff") return { code: 0, stdout: "", stderr: "" };
		return { code: 1, stdout: "", stderr: "" };
	};
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, exec });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const settle = async () => {
		for (let round = 0; round < 50; round++) await new Promise((resolve) => setImmediate(resolve));
	};
	const ci = () => {
		const lines = railOf(sim)(47);
		const top = lines.findIndex((line) => line.startsWith("╭─ CI"));
		if (top < 0) return [];
		return lines.slice(top + 1, lines.findIndex((line, index) => index > top && line.startsWith("╰"))).map((line) => line.slice(2).replace(/ +│$/, "").replace(/(\S) {2,}(\S)/g, "$1 $2"));
	};
	const lists = () => gh.filter((call) => call.startsWith("run list"));
	const tool = (name: string, event: Record<string, unknown>) => {
		for (const handler of sim.handlers.get(name) ?? []) handler(event, sim.ctx);
	};
	return { sim, state, settle, ci, lists, tool };
}

test("CI: a git read whose branch command failed is not a branch change; only a different known branch clears and reads (S66)", async (t) => {
	const { sim, state, settle, ci, lists } = ciSim(t);
	await settle();
	assert.deepEqual(ci(), ["⠹ tests running… 1:12"]);
	assert.equal(lists().length, 1);

	// The branch command fails: the branch, the shown CI and its schedule stay.
	state.branch = { code: 128, stdout: "" };
	sim.emit("turn_end");
	await settle();
	assert.deepEqual(ci(), ["⠹ tests running… 1:12"], "kept after a git failure");
	assert.equal(lists().length, 1, "no read for an unknown branch");
	t.mock.timers.tick(30_000);
	await settle();
	assert.equal(lists().length, 2, "the 30 s schedule goes on");
	assert.ok(lists()[1].startsWith("run list --branch feat/x "), "for the known branch");

	// The same branch again: not a change either.
	state.branch = { code: 0, stdout: "feat/x\n" };
	sim.emit("turn_end");
	await settle();
	assert.equal(lists().length, 2);
	assert.deepEqual(ci(), ["⠹ tests running… 1:42"]);

	// A different known branch: the runs go and the new branch is read.
	state.branch = { code: 0, stdout: "main\n" };
	state.list = { code: 1, stdout: "" };
	sim.emit("turn_end");
	await settle();
	assert.deepEqual(ci(), [], "cleared");
	assert.equal(lists().length, 3);
	assert.ok(lists()[2].startsWith("run list --branch main "));
	sim.emit("session_shutdown");
});

test("CI: remembered git push calls stay bounded; at the cap the oldest gives way and a new push is never ignored (S66)", async (t) => {
	const { sim, settle, lists, tool } = ciSim(t);
	await settle();
	assert.equal(lists().length, 1);
	// 33 pushes start (one over the cap of 32); their ends carry no arguments, like Pi's.
	for (let index = 0; index <= 32; index++) tool("tool_execution_start", { toolName: "bash", toolCallId: `p${index}`, args: { command: "git push" } });
	tool("tool_execution_end", { toolName: "bash", toolCallId: "p32", isError: false, result: {} });
	t.mock.timers.tick(5_000);
	await settle();
	assert.equal(lists().length, 2, "the newest push reads 5 s after it ends");
	t.mock.timers.tick(15_000);
	await settle();
	assert.equal(lists().length, 3, "and 20 s after");
	// The oldest gave way: its end is not a known push any more.
	tool("tool_execution_end", { toolName: "bash", toolCallId: "p0", isError: false, result: {} });
	t.mock.timers.tick(20_000);
	await settle();
	assert.equal(lists().length, 4, "only the 30 s schedule read (a run is going), no push reads");
	t.mock.timers.tick(5_000);
	await settle();
	assert.equal(lists().length, 4);
	// The others are still known.
	tool("tool_execution_end", { toolName: "bash", toolCallId: "p1", isError: false, result: {} });
	t.mock.timers.tick(5_000);
	await settle();
	assert.equal(lists().length, 5, "p1 still reads after its end");
	sim.emit("session_shutdown");
});

function hhmmLocal(ms: number): string {
	const date = new Date(ms);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// --- S87: 4.6.0 subagent tasks next to the jobs ----------------------------------

/** 4.6.0's `gentle-pi:notification:source` payload for a subagent task (lib/notification-events.ts), restated. */
const subagentEvent = (taskId: string, status: string, sequence: number) => ({ source: "subagent", producerId: "p1", sessionId: "s1", parentSessionId: "s1", taskId, status, runId: "p1:r1", sequence, event: `subagent.${status}`, occurredAt: 1 });

const agentRows = (lines: string[]) => {
	const start = lines.findIndex((line) => line.startsWith("╭─ agents"));
	if (start < 0) return [];
	return lines.slice(start + 1, lines.findIndex((line, index) => index > start && line.startsWith("╰"))).map((line) => line.replace(/ +│$/, " │").replace(/ {2,}/g, "  "));
};

test("S87 a subagent_run in task mode shows in agents next to the job: its events name the state, the call its agent and task, the result its model and effort", (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 100_000 });
	const sim = simulate("E:\\DEV\\app");
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const tool = (name: string, event: Record<string, unknown>) => {
		for (const handler of sim.handlers.get(name) ?? []) handler(event, sim.ctx);
	};
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	tool("tool_execution_start", { toolName: "subagent_run", toolCallId: "c1", args: { agent: "explore", task: "Map the footer sources", mode: "task" } });
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("t1", "queued", 1));
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ job-1 npm test +\d+(?::\d\d)+ │$/, /^│ ○ explore Map the footer sources │$/]);
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("t1", "running", 2));
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ job-1 npm test +\d+(?::\d\d)+ │$/, /^│ ⠹ explore Map the footer sources +\d+(?::\d\d)+ │$/]);
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("t1", "waiting", 3));
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ job-1 npm test +\d+(?::\d\d)+ │$/, /^│▎! explore Map the footer sources +\d+(?::\d\d)+ │$/], "a waiting task keeps its time");
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("t1", "running", 4));
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("t1", "completed", 5));
	tool("tool_execution_end", { toolName: "subagent_run", toolCallId: "c1", isError: false, result: { content: [], details: { gentleAgents: { taskId: "t1", agent: "explore", status: "completed", mode: "task", cwd: "E:/DEV/app", label: "map footer", turns: 3, toolCalls: 4, lastStep: "done", model: "anthropic/claude-opus-5-5", thinking: "high" } } } });
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ job-1 npm test +\d+(?::\d\d)+ │$/, /^│ ✓ explore map footer  opus · high │$/], "a finished task: no time");
	// Another session's task and a stale sequence change nothing.
	sim.emitEvent("gentle-pi:notification:source", { ...subagentEvent("t9", "running", 6), sessionId: "s2", parentSessionId: "s2" });
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("t1", "running", 5));
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ job-1 npm test +\d+(?::\d\d)+ │$/, /^│ ✓ explore map footer  opus · high │$/]);
	// Finished tasks fold after the same tail as Gentle Shell's finished jobs, on the idle refresh.
	t.mock.timers.tick(70_000);
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ job-1 npm test +\d+(?::\d\d)+ │$/]);
	sim.emit("session_shutdown");
});

test("S87 a background subagent_run: the result names the task first, the events follow; the card and the strip count it with the job", (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 100_000 });
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const strip = sim.widgets.get("fisi-dock-strip")!(sim.tui);
	const tool = (name: string, event: Record<string, unknown>) => {
		for (const handler of sim.handlers.get(name) ?? []) handler(event, sim.ctx);
	};
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	tool("tool_execution_start", { toolName: "subagent_run", toolCallId: "c1", args: { agent: "verify", task: "Check PR 265", label: "check PR", mode: "background" } });
	tool("tool_execution_end", { toolName: "subagent_run", toolCallId: "c1", isError: false, result: { content: [], details: { gentleAgents: { taskId: "t1", agent: "verify", status: "queued", mode: "background", cwd: "E:/DEV/app", label: "check PR", turns: 0, toolCalls: 0, lastStep: "starting", model: "anthropic/claude-sonnet-4-5" } } } });
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ job-1 npm test +\d+(?::\d\d)+ │$/, /^│ ○ verify check PR  sonnet │$/]);
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("t1", "running", 1));
	t.mock.timers.tick(5_000);
	const card = strip.render(53).map((line) => plain(line).replace(/ {2,}/g, "  ").replace(/─+/g, "─"));
	// JOB started at epoch 1 ms and the mocked clock is at 105 000 ms: 1:44; the task ran 5 s.
	assert.deepEqual(card, ["╭─ agents ─ 2 ─╮", "│ ⠹ job-1  npm test  1:44 │", "│ ⠹ verify check PR  0:05 sonnet │", "╰─╯"], "the card: the job time from its own start, the task time from its running event");
	sim.emit("session_shutdown");
});

/** The rail's ODD rows that name `phase`, without the box borders. */
const oddPhaseRows = (lines: string[], phase: string) => {
	const start = lines.findIndex((line) => line.startsWith("╭─ ODD"));
	if (start < 0) return [];
	const end = lines.findIndex((line, index) => index > start && line.startsWith("╰"));
	return lines.slice(start + 1, end).filter((line) => line.includes(phase)).map((line) => line.replace(/^│ /, "").replace(/ +│$/, "").replace(/ {2,}/g, "  ").trim());
};

test("S91 after agent_end, the ODD step stays active while a background subagent runs and closes when it completes", (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 100_000 });
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const tool = (name: string, event: Record<string, unknown>) => {
		for (const handler of sim.handlers.get(name) ?? []) handler(event, sim.ctx);
	};
	sim.emit("agent_start");
	tool("tool_execution_start", { toolName: "read", toolCallId: "r0", args: { path: "a.ts" } });
	tool("tool_execution_start", { toolName: "subagent_run", toolCallId: "c1", args: { agent: "gentle-ai-explore", task: "Map it", label: "map it", mode: "background" } });
	tool("tool_execution_end", { toolName: "subagent_run", toolCallId: "c1", isError: false, result: { content: [], details: { gentleAgents: { taskId: "t1", agent: "gentle-ai-explore", status: "queued", mode: "background", cwd: "E:/DEV/app", label: "map it", turns: 0, toolCalls: 0, lastStep: "starting" } } } });
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("t1", "running", 1));
	t.mock.timers.tick(2_000);
	sim.emit("agent_end");
	t.mock.timers.tick(3_000);
	const held = oddPhaseRows(railOf(sim)(47), "exploring");
	assert.equal(held.length, 1, held.join("\n"));
	assert.ok(!held[0].startsWith("✓"), `the step is not done while the subagent runs: ${held[0]}`);
	assert.ok(held[0].endsWith("0:05"), `its time keeps counting: ${held[0]}`);
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("t1", "completed", 2));
	t.mock.timers.tick(4_000);
	assert.deepEqual(oddPhaseRows(railOf(sim)(47), "exploring"), ["✓ exploring  0:05"], "the subagent completed: the step closes at that time");
	sim.emit("session_shutdown");
});

test("S91 agent_end with no subagent running closes the ODD step at once, as before", (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 100_000 });
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	sim.emit("agent_start");
	for (const handler of sim.handlers.get("tool_execution_start") ?? []) handler({ toolName: "read", toolCallId: "r0", args: { path: "a.ts" } }, sim.ctx);
	t.mock.timers.tick(2_000);
	sim.emit("agent_end");
	t.mock.timers.tick(3_000);
	assert.deepEqual(oddPhaseRows(railOf(sim)(47), "exploring"), ["✓ exploring  0:02"]);
	sim.emit("session_shutdown");
});

test("S87 after a reload, unfinished tasks are seeded once from this session presence activity file; a missing file changes nothing", async (t) => {
	const scratch = mkdtempSync(join(tmpdir(), "fisi-dock-presence-"));
	console.log(`--- presence scratch: ${scratch}`);
	const saved = process.env.GENTLE_PI_AGENT_HOME;
	process.env.GENTLE_PI_AGENT_HOME = join(scratch, "agent");
	t.after(() => {
		if (saved === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = saved;
	});
	const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
	const none = simulate("E:\\DEV\\app");
	none.emit("session_start");
	none.widgets.get("fisi-dock")!(none.tui);
	await settle();
	assert.deepEqual(agentRows(railOf(none)(47)), [], "no presence dir: nothing");
	none.emit("session_shutdown");
	const presence = join(scratch, "agent", "gentle-agents", "presence");
	mkdirSync(presence, { recursive: true });
	const hash = createHash("sha256").update("s1").digest("hex");
	const summary = (id: string, status: string, startedAt: number | null) => ({ summary: { id, agent: "writer", label: `label ${id}`, status, model: "anthropic/claude-opus-5-5", createdAt: 1_000, startedAt, endedAt: null, lastActivityAt: 2_000 }, thread: { version: 1, dropped: 0, items: [] } });
	writeFileSync(join(presence, `${hash}.11111111-1111-4111-8111-111111111111.activity.json`), JSON.stringify({ tasks: [summary("t1", "running", 1_500), summary("t2", "queued", null)] }));
	const sim = simulate("E:\\DEV\\app");
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	// The seed is an async disk read: wait for it, not for a fixed time, so a loaded suite does not race it.
	for (const deadline = Date.now() + 5_000; agentRows(railOf(sim)(47)).length === 0 && Date.now() < deadline;) await settle();
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ writer label t1 +\d+(?::\d\d)+ opus │$/, /^│ ○ writer label t2  opus │$/], "the running seed with its time, the queued one without");
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("t1", "completed", 1));
	assert.deepEqual(agentRows(railOf(sim)(47)), ["│ ✓ writer label t1  opus │", "│ ○ writer label t2  opus │"], "events move a seeded task");
	sim.emit("session_shutdown");
});

/** Real time spent on I/O while the test's timers are mocked: setImmediate turns, never a mocked timer. */
const ioPause = async (ms: number) => {
	for (const end = performance.now() + ms; performance.now() < end;) await new Promise((resolve) => setImmediate(resolve));
};

/** A fresh GENTLE_PI_AGENT_HOME for the test, and the writer of this session's presence activity file as Gentle Shell writes it (schema 1). */
function presenceHome(t: TestContext) {
	const scratch = mkdtempSync(join(tmpdir(), "fisi-dock-presence-"));
	console.log(`--- presence scratch: ${scratch}`);
	const saved = process.env.GENTLE_PI_AGENT_HOME;
	process.env.GENTLE_PI_AGENT_HOME = join(scratch, "agent");
	t.after(() => {
		if (saved === undefined) delete process.env.GENTLE_PI_AGENT_HOME;
		else process.env.GENTLE_PI_AGENT_HOME = saved;
		rmSync(scratch, { recursive: true, force: true });
	});
	const presence = join(scratch, "agent", "gentle-agents", "presence");
	const hash = createHash("sha256").update("s1").digest("hex");
	return (tasks: { id: string; label: string; model: string }[]) => {
		mkdirSync(presence, { recursive: true });
		const entries = tasks.map(({ id, label, model }) => ({ summary: { id, agent: "gentle-ai-worker", label, status: "running", model, createdAt: 1_000, startedAt: 1_500, endedAt: null, lastActivityAt: 2_000 }, thread: { version: 1, dropped: 0, items: [] } }));
		writeFileSync(join(presence, `${hash}.11111111-1111-4111-8111-111111111111.activity.json`), JSON.stringify({ schema: 1, sessionHash: hash, incarnation: "11111111-1111-4111-8111-111111111111", generation: 1, activity: { tasks: entries } }));
	};
}

test("S87 a task-mode subagent_run shows its model while it runs: read from the presence activity file after its status event; the result then wins", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 100_000 });
	const write = presenceHome(t);
	const sim = simulate("E:\\DEV\\app");
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const tool = (name: string, event: Record<string, unknown>) => {
		for (const handler of sim.handlers.get(name) ?? []) handler(event, sim.ctx);
	};
	// The session-start seed reads a presence dir that is not there yet.
	await ioPause(100);
	tool("tool_execution_start", { toolName: "subagent_run", toolCallId: "w1", args: { agent: "gentle-ai-worker", task: "Say hello", label: "hello", mode: "task" } });
	write([{ id: "t1", label: "file label", model: "claude-bridge/claude-opus-5-5" }]);
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("t1", "queued", 1));
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("t1", "running", 2));
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ gentle-ai-worker hello +\d+(?::\d\d)+ │$/], "no model before the read");
	t.mock.timers.tick(1_000);
	for (const end = performance.now() + 5_000; !agentRows(railOf(sim)(47))[0]?.includes("opus") && performance.now() < end;) await ioPause(10);
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ gentle-ai-worker hello +\d+(?::\d\d)+ opus │$/], "the model while it runs, the call's label kept");
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("t1", "completed", 3));
	tool("tool_execution_end", { toolName: "subagent_run", toolCallId: "w1", isError: false, result: { content: [], details: { gentleAgents: { taskId: "t1", agent: "gentle-ai-worker", status: "completed", mode: "task", cwd: "E:/DEV/app", label: "said hi", turns: 1, toolCalls: 1, lastStep: "done", model: "anthropic/claude-sonnet-4-5", thinking: "high" } } } });
	assert.deepEqual(agentRows(railOf(sim)(47)), ["│ ✓ gentle-ai-worker said hi  sonnet · high │"], "the result's label, model and effort");
	// A finished task is never changed by the file.
	t.mock.timers.tick(5_000);
	await ioPause(100);
	assert.deepEqual(agentRows(railOf(sim)(47)), ["│ ✓ gentle-ai-worker said hi  sonnet · high │"]);
	sim.emit("session_shutdown");
});

test("S87 the presence file is read a few times at most for a task whose entry names no model; then the task is left alone", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 100_000 });
	const write = presenceHome(t);
	const sim = simulate("E:\\DEV\\app");
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	await ioPause(100);
	write([{ id: "t1", label: "from the file", model: "" }]);
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("t1", "running", 1));
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ subagent task t1 +\d+(?::\d\d)+ │$/]);
	t.mock.timers.tick(1_000);
	for (const end = performance.now() + 5_000; !agentRows(railOf(sim)(47))[0]?.includes("from the file") && performance.now() < end;) await ioPause(10);
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ subagent from the file +\d+(?::\d\d)+ │$/], "the first read gave the label, no model");
	// The second and third reads, one delay after each.
	for (let read = 2; read <= 3; read++) {
		await ioPause(100);
		t.mock.timers.tick(1_000);
	}
	await ioPause(100);
	// The model shows up too late: no read is left for this task.
	write([{ id: "t1", label: "from the file", model: "claude-bridge/claude-opus-5-5" }]);
	for (let tick = 0; tick < 5; tick++) {
		t.mock.timers.tick(1_000);
		await ioPause(50);
	}
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ subagent from the file +\d+(?::\d\d)+ │$/], "left alone after the bounded reads");
	sim.emit("session_shutdown");
});


/** Two explorers run and finish with their events, then five delegations are refused: Pi ends each call at once with the reason as text and empty details. */
function explorersThenRefusals(sim: ReturnType<typeof simulate>, tool: (name: string, event: Record<string, unknown>) => void) {
	const explorerEnd = (id: string, taskId: string, label: string) => tool("tool_execution_end", { toolName: "subagent_run", toolCallId: id, isError: false, result: { content: [{ type: "text", text: `Task ${taskId} completed` }], details: { gentleAgents: { taskId, agent: "gentle-ai-explore", status: "completed", mode: "task", cwd: "E:/DEV/app", label, turns: 1, toolCalls: 1, lastStep: "done", model: "anthropic/claude-opus-5-5", thinking: "high" } } } });
	tool("tool_execution_start", { toolName: "subagent_run", toolCallId: "e1", args: { agent: "gentle-ai-explore", task: "Map the tracker", mode: "task" } });
	tool("tool_execution_start", { toolName: "subagent_run", toolCallId: "e2", args: { agent: "gentle-ai-explore", task: "Map the panel", mode: "task" } });
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("tA", "running", 1));
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("tB", "running", 2));
	assert.equal(agentRows(railOf(sim)(47)).length, 2, "both explorers are listed");
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("tA", "completed", 3));
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("tB", "completed", 4));
	explorerEnd("e1", "tA", "map tracker");
	explorerEnd("e2", "tB", "map panel");
	const refuse = (id: string, agent: string) => {
		tool("tool_execution_start", { toolName: "subagent_run", toolCallId: id, args: { agent, task: "Refused", mode: "task" } });
		tool("tool_execution_end", { toolName: "subagent_run", toolCallId: id, isError: true, result: { content: [{ type: "text", text: "Writers run only for a task of an existing ODD feature document" }], details: {} } });
	};
	refuse("r1", "gentle-ai-verify");
	for (const id of ["r2", "r3", "r4", "r5"]) refuse(id, "gentle-ai-worker");
}

test("T102 the screenshot's sequence with status events flowing: after the refusals, two task-mode workers are live in the rail's agents section before any result", (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 100_000 });
	const sim = simulate("E:\\DEV\\app");
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const tool = (name: string, event: Record<string, unknown>) => {
		for (const handler of sim.handlers.get(name) ?? []) handler(event, sim.ctx);
	};
	explorersThenRefusals(sim, tool);
	t.mock.timers.tick(70_000);
	assert.deepEqual(agentRows(railOf(sim)(47)), [], "explorers folded, no row for a refused launch");
	tool("tool_execution_start", { toolName: "subagent_run", toolCallId: "w1", args: { agent: "gentle-ai-worker", task: "Agent one says hello", mode: "task" } });
	tool("tool_execution_start", { toolName: "subagent_run", toolCallId: "w2", args: { agent: "gentle-ai-worker", task: "Agent two says hello", mode: "task" } });
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("tC", "queued", 5));
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("tD", "queued", 6));
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("tC", "running", 7));
	sim.emitEvent("gentle-pi:notification:source", subagentEvent("tD", "running", 8));
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ gentle-ai-worker Agent one says h… \d+(?::\d\d)+ │$/, /^│ ⠹ gentle-ai-worker Agent two says h… \d+(?::\d\d)+ │$/]);
	sim.emit("session_shutdown");
});

test("T102 the same sequence when the workers' status events never arrive: both show in the rail's agents section from their calls alone, a refused launch does not, and their results close them", (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 100_000 });
	const sim = simulate("E:\\DEV\\app");
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const tool = (name: string, event: Record<string, unknown>) => {
		for (const handler of sim.handlers.get(name) ?? []) handler(event, sim.ctx);
	};
	explorersThenRefusals(sim, tool);
	t.mock.timers.tick(70_000);
	assert.deepEqual(agentRows(railOf(sim)(47)), [], "explorers folded, no row for a refused launch");
	tool("tool_execution_start", { toolName: "subagent_run", toolCallId: "w1", args: { agent: "gentle-ai-worker", task: "Agent one says hello", mode: "task" } });
	tool("tool_execution_start", { toolName: "subagent_run", toolCallId: "w2", args: { agent: "gentle-ai-worker", task: "Agent two says hello", mode: "task" } });
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ gentle-ai-worker Agent one says h… \d+(?::\d\d)+ │$/, /^│ ⠹ gentle-ai-worker Agent two says h… \d+(?::\d\d)+ │$/], "both live from their calls alone");
	const end = (id: string, taskId: string, label: string) => tool("tool_execution_end", { toolName: "subagent_run", toolCallId: id, isError: false, result: { content: [{ type: "text", text: `Task ${taskId} completed` }], details: { gentleAgents: { taskId, agent: "gentle-ai-worker", status: "completed", mode: "task", cwd: "E:/DEV/app", label, turns: 2, toolCalls: 3, lastStep: "done", model: "anthropic/claude-opus-5-5", thinking: "high" } } } });
	t.mock.timers.tick(5_000);
	end("w2", "tD", "agent two");
	assertRows(agentRows(railOf(sim)(47)), [/^│ ⠹ gentle-ai-worker Agent one says h… 0:05 │$/, /^│ ✓ gentle-ai-worker agent two  opus · high │$/], "the second worker\'s result closes its row; the first stays live, its time ticking");
	end("w1", "tC", "agent one");
	assert.deepEqual(agentRows(railOf(sim)(47)), ["│ ✓ gentle-ai-worker agent one  opus · high │", "│ ✓ gentle-ai-worker agent two  opus · high │"]);
	// A call whose end was lost goes when the run settles.
	tool("tool_execution_start", { toolName: "subagent_run", toolCallId: "w3", args: { agent: "gentle-ai-worker", task: "End lost", mode: "task" } });
	assert.equal(agentRows(railOf(sim)(47)).length, 3);
	sim.emit("agent_settled");
	assert.equal(agentRows(railOf(sim)(47)).length, 2, "the settled run takes the stale call away");
	t.mock.timers.tick(70_000);
	assert.deepEqual(agentRows(railOf(sim)(47)), [], "finished rows fold after the tail");
	sim.emit("session_shutdown");
});

// --- /fisi-dock on|off (S95) -------------------------------------------------

type Sim = ReturnType<typeof simulate>;
const RAIL_KEYS = ["header", "footer", "todo", "jobs", "agents", "statusbar"];
const WIDGET_KEYS = ["fisi-dock", "fisi-dock-strip", "fisi-dock-prompt-line"];
const gentleOriginal = (sim: Sim, key: string) => (key === "header" ? sim.gentleHeader : key === "footer" ? sim.gentleFooter : sim.gentleParts[key]);
const listenerCount = (sim: Sim) => [...sim.channels.values()].reduce((count, handlers) => count + handlers.length, 0);
const fisiDockCommand = (sim: Sim, args: string) => sim.commands.get("fisi-dock")!.handler(args, sim.ctx);
const assertGentleShellOwns = (sim: Sim, why: string) => {
	for (const key of RAIL_KEYS) assert.equal(sim.parts.get(key), gentleOriginal(sim, key), `${why}: ${key} is Gentle Shell's`);
};
const assertFisiDockOwns = (sim: Sim, why: string) => {
	for (const key of RAIL_KEYS) assert.notEqual(sim.parts.get(key), gentleOriginal(sim, key), `${why}: ${key} is Fisi Dock's`);
};

/**
 * Points Pi's agent dir, where /fisi-dock keeps its state, at a fresh temp folder; seeds the file when given,
 * as a state after the first start (its theme step done, T9). Returns the state file path.
 */
function stateDir(t: TestContext, enabled?: boolean): string {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-agent-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	t.after(() => {
		process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	});
	const path = join(dir, "fisi-dock", "state.json");
	if (enabled !== undefined) {
		mkdirSync(join(dir, "fisi-dock"));
		writeFileSync(path, JSON.stringify({ enabled, themeApplied: true }));
	}
	return path;
}

test("S95 /fisi-dock off gives Gentle Shell back its rail parts, top row, editor and theme, stops painting, goes dormant and saves the choice", async (t) => {
	const path = stateDir(t, true);
	const gentle = gentleEditorFactory();
	let wide = true;
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => wide, editor: gentle });
	const command = sim.commands.get("fisi-dock");
	assert.ok(command, "/fisi-dock registered");
	assert.match(command.description ?? "", /on.*off|off.*on/);
	sim.emit("session_start");
	const rail = sim.widgets.get("fisi-dock")!(sim.tui);
	const strip = sim.widgets.get("fisi-dock-strip")!(sim.tui);
	const promptLine = sim.widgets.get("fisi-dock-prompt-line")!(sim.tui);
	assertFisiDockOwns(sim, "before");
	assert.notEqual(sim.ctx.ui.getEditorComponent(), gentle);

	await fisiDockCommand(sim, "off");
	assertGentleShellOwns(sim, "off");
	assert.equal(sim.ctx.ui.getEditorComponent(), gentle, "Gentle Shell's editor factory and prompt box back");
	for (const key of WIDGET_KEYS) assert.equal(sim.widgets.get(key), undefined, `${key} removed`);
	assert.deepEqual(rail.render(80), [], "a rail widget still on screen paints nothing");
	assertGentleShellOwns(sim, "a late frame of the old widget takes nothing back");
	wide = false;
	assert.deepEqual(strip.render(64), [], "the strip and cards paint nothing");
	assert.deepEqual(promptLine.render(100), [], "the prompt line paints nothing");
	assert.equal((globalThis as Record<symbol, unknown>)[USER_FRAME_HOOK], undefined, "user messages back to Pi's own lines");
	assert.equal((globalThis as Record<symbol, unknown>)[Symbol.for("fisi-dock")], false, "Gentle Shell's hidden lines show again");
	assert.equal(listenerCount(sim), 0, "no pi.events listener left");
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: false, themeApplied: true });
	assert.deepEqual(sim.themes, ["Gentleman-Cute"], "Gentle Shell's own theme");
	assert.match(sim.notices.at(-1)!, /^Fisi Dock off/);

	// Dormant: events and turns take nothing over.
	sim.emit("turn_end");
	sim.emit("agent_end");
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	assertGentleShellOwns(sim, "after a turn");
	assert.equal(sim.ctx.ui.getEditorComponent(), gentle);

	// /dock says Fisi Dock is off instead of opening.
	await sim.commands.get("dock")!.handler("", sim.ctx);
	assert.equal(sim.customs.length, 0);
	assert.equal(sim.notices.at(-1), "Fisi Dock is off · /fisi-dock on turns it back on");
	sim.emit("session_shutdown");
	assertGentleShellOwns(sim, "after shutdown");
});

test("S95 /fisi-dock on takes everything over again as at session start, with no duplicate listeners, and saves the choice", async (t) => {
	const path = stateDir(t, true);
	const gentle = gentleEditorFactory();
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, editor: gentle });
	sim.emit("session_start");
	const listening = listenerCount(sim);
	assert.ok(listening > 0);
	await fisiDockCommand(sim, "off");
	await fisiDockCommand(sim, "on");
	for (const key of WIDGET_KEYS) assert.equal(typeof sim.widgets.get(key), "function", `${key} registered again`);
	sim.widgets.get("fisi-dock")!(sim.tui);
	assertFisiDockOwns(sim, "on");
	const wrapper = sim.ctx.ui.getEditorComponent() as Record<symbol, unknown>;
	assert.notEqual(wrapper, gentle, "the prompt box wraps Gentle Shell's editor again");
	assert.equal(wrapper[PROMPT_OWNER], true);
	assert.equal(listenerCount(sim), listening, "the same listeners as at session start, none twice");
	assert.equal((globalThis as Record<symbol, unknown>)[Symbol.for("fisi-dock")], true);
	assert.equal(typeof (globalThis as Record<symbol, unknown>)[USER_FRAME_HOOK], "function");
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true, theme: "Gentleman-Cute", themeApplied: true }, "on remembers the theme off had set (S7)");
	assert.deepEqual(sim.themes, ["Gentleman-Cute", "Fisi-Dock"]);
	assert.match(sim.notices.at(-1)!, /^Fisi Dock on/);
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	assert.ok(railOf(sim)(47).some((line) => line.includes("job-1 npm test")), "live data reaches the panel again");

	// Already on: nothing restarts.
	await fisiDockCommand(sim, "on");
	assert.equal(listenerCount(sim), listening);
	assert.deepEqual(sim.themes, ["Gentleman-Cute", "Fisi-Dock"]);
	assert.equal(sim.notices.at(-1), "Fisi Dock is already on");
	sim.emit("session_shutdown");
	assertGentleShellOwns(sim, "shutdown after on");
	assert.equal(sim.ctx.ui.getEditorComponent(), gentle);
});

test("S95 a restart with the state file off stays dormant from the start until /fisi-dock on", async (t) => {
	stateDir(t, false);
	const marker = Symbol.for("fisi-dock");
	delete (globalThis as Record<symbol, unknown>)[marker];
	const gentle = gentleEditorFactory();
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, editor: gentle });
	assert.equal((globalThis as Record<symbol, unknown>)[marker], false, "dormant at load");
	sim.emit("session_start");
	await Promise.resolve();
	assert.equal(sim.widgets.size, 0, "no widget set");
	assertGentleShellOwns(sim, "dormant start");
	assert.equal(sim.ctx.ui.getEditorComponent(), gentle);
	assert.deepEqual(sim.editorSets, []);
	assert.equal(listenerCount(sim), 0);
	assert.equal((globalThis as Record<symbol, unknown>)[marker], false);
	assert.equal((globalThis as Record<symbol, unknown>)[USER_FRAME_HOOK], undefined);
	sim.emit("turn_end");
	assert.equal(sim.ctx.ui.getEditorComponent(), gentle);
	assert.deepEqual(sim.themes, [], "the theme is not touched at start");
	await sim.commands.get("dock")!.handler("", sim.ctx);
	assert.equal(sim.customs.length, 0);
	assert.equal(sim.notices.at(-1), "Fisi Dock is off · /fisi-dock on turns it back on");
	await fisiDockCommand(sim, "");
	assert.deepEqual(sim.selects.at(-1), { title: "Fisi Dock is off", options: ["on", "off", "settings"] }, "alone, the picker says it is off");
	assert.equal(sim.widgets.size, 0, "Esc keeps it off");

	await fisiDockCommand(sim, "on");
	sim.widgets.get("fisi-dock")!(sim.tui);
	assertFisiDockOwns(sim, "on after a dormant start");
	assert.deepEqual(sim.themes, ["Fisi-Dock"]);
	sim.emit("session_shutdown");
	assertGentleShellOwns(sim, "shutdown");
});

test("S95 an unknown argument shows the usage and changes nothing", async (t) => {
	const path = stateDir(t, true);
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	for (const args of ["maybe", "of", "on off"]) {
		await fisiDockCommand(sim, args);
		assert.equal(sim.notices.at(-1), "Usage: /fisi-dock on | off | settings (alone: pick one)");
	}
	assert.equal(sim.selects.length, 0, "an argument never opens the picker");
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true, themeApplied: true }, "no state written");
	assert.deepEqual(sim.themes, []);
	assertFisiDockOwns(sim, "after unknown arguments");
	for (const key of WIDGET_KEYS) assert.equal(typeof sim.widgets.get(key), "function");

	await fisiDockCommand(sim, " OFF ");
	assertGentleShellOwns(sim, "off, any case and spacing");
	await fisiDockCommand(sim, "bogus");
	assert.equal(sim.notices.at(-1), "Usage: /fisi-dock on | off | settings (alone: pick one)");
	await fisiDockCommand(sim, "off");
	assert.equal(sim.notices.at(-1), "Fisi Dock is already off");
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: false, themeApplied: true });
	assert.deepEqual(sim.themes, ["Gentleman-Cute"]);
	assertGentleShellOwns(sim, "still off");
	sim.emit("session_shutdown");
});

test("S98 /fisi-dock alone opens an on/off picker, the change first, that switches like typing it; Esc changes nothing", async (t) => {
	const path = stateDir(t, true);
	const gentle = gentleEditorFactory();
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, editor: gentle });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);

	// On: Esc keeps everything as it was, with no notice and nothing saved.
	await fisiDockCommand(sim, "");
	assert.deepEqual(sim.selects, [{ title: "Fisi Dock is on", options: ["off", "on", "settings"] }]);
	assert.deepEqual(sim.notices, []);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true, themeApplied: true });
	assert.deepEqual(sim.themes, []);
	assertFisiDockOwns(sim, "Esc while on");

	// Picking off: the same as /fisi-dock off.
	sim.picks.push("off");
	await fisiDockCommand(sim, "");
	assertGentleShellOwns(sim, "picked off");
	assert.equal(sim.ctx.ui.getEditorComponent(), gentle);
	for (const key of WIDGET_KEYS) assert.equal(sim.widgets.get(key), undefined, `${key} removed`);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: false, themeApplied: true });
	assert.deepEqual(sim.themes, ["Gentleman-Cute"]);
	assert.match(sim.notices.at(-1)!, /^Fisi Dock off/);

	// Off: the picker says so and offers on first; picking the current state says so.
	sim.picks.push("off");
	await fisiDockCommand(sim, "");
	assert.deepEqual(sim.selects.at(-1), { title: "Fisi Dock is off", options: ["on", "off", "settings"] });
	assert.equal(sim.notices.at(-1), "Fisi Dock is already off");
	sim.picks.push("on");
	await fisiDockCommand(sim, "");
	sim.widgets.get("fisi-dock")!(sim.tui);
	assertFisiDockOwns(sim, "picked on");
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true, theme: "Gentleman-Cute", themeApplied: true }, "on remembers the theme off had set (S7)");
	assert.deepEqual(sim.themes, ["Gentleman-Cute", "Fisi-Dock"]);
	assert.match(sim.notices.at(-1)!, /^Fisi Dock on/);
	sim.emit("session_shutdown");
});

test("S98 without a UI, or when the picker fails, /fisi-dock alone says whether it is on as before", async (t) => {
	const path = stateDir(t, true);
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	sim.ctx.hasUI = false;
	await fisiDockCommand(sim, "");
	assert.equal(sim.notices.at(-1), "Fisi Dock is on · /fisi-dock off gives Gentle Shell its panel back");
	assert.equal(sim.selects.length, 0);
	sim.ctx.hasUI = true;
	sim.ctx.ui.select = async () => {
		throw new Error("no picker");
	};
	await fisiDockCommand(sim, "");
	assert.equal(sim.notices.at(-1), "Fisi Dock is on · /fisi-dock off gives Gentle Shell its panel back");
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true, themeApplied: true });
	assertFisiDockOwns(sim, "still on");
	sim.emit("session_shutdown");
});

/** Writes the state file stateDir points at, as given: theme included, and the first-start step (T9) done only with themeApplied. */
function seedState(path: string, state: { enabled: boolean; theme?: string; themeApplied?: boolean }) {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, JSON.stringify(state));
}

test("S7 /fisi-dock on remembers the theme in use and off puts it back instead of Gentleman-Cute", async (t) => {
	const path = stateDir(t, false);
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "dark" });
	sim.emit("session_start");
	await fisiDockCommand(sim, "on");
	assert.deepEqual(sim.themes, ["Fisi-Dock"]);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true, theme: "dark", themeApplied: true }, "the theme before Fisi-Dock is saved");
	await fisiDockCommand(sim, "off");
	assert.deepEqual(sim.themes, ["Fisi-Dock", "dark"], "your own theme back");
	assert.equal(sim.ctx.ui.theme.name, "dark");
	assert.equal(sim.notices.at(-1), "Fisi Dock off · Gentle Shell's panel and your theme dark are back; /fisi-dock on turns it back on");
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: false, theme: "dark", themeApplied: true });
	assertGentleShellOwns(sim, "off");
	sim.emit("session_shutdown");
});

test("S7 /fisi-dock on while the theme already is Fisi-Dock keeps the theme remembered before", async (t) => {
	const path = stateDir(t);
	seedState(path, { enabled: false, theme: "light", themeApplied: true });
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "Fisi-Dock" });
	sim.emit("session_start");
	await fisiDockCommand(sim, "on");
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true, theme: "light", themeApplied: true }, "Fisi-Dock is never remembered");
	await fisiDockCommand(sim, "off");
	await fisiDockCommand(sim, "on");
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true, theme: "light", themeApplied: true });
	await fisiDockCommand(sim, "on");
	assert.equal(sim.notices.at(-1), "Fisi Dock is already on");
	await fisiDockCommand(sim, "off");
	assert.deepEqual(sim.themes, ["Fisi-Dock", "light", "Fisi-Dock", "light"], "on twice still gives the first theme back");
	sim.emit("session_shutdown");

	// Nothing remembered and Fisi-Dock in use: off falls back to Gentle Shell's theme.
	const fresh = stateDir(t, false);
	const other = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "Fisi-Dock" });
	other.emit("session_start");
	await fisiDockCommand(other, "on");
	assert.deepEqual(JSON.parse(readFileSync(fresh, "utf8")), { enabled: true, themeApplied: true });
	await fisiDockCommand(other, "off");
	assert.deepEqual(other.themes, ["Fisi-Dock", "Gentleman-Cute"]);
	assert.equal(other.notices.at(-1), "Fisi Dock off · Gentle Shell's panel and theme Gentleman-Cute are back; /fisi-dock on turns it back on");
	other.emit("session_shutdown");
});

test("S7 the remembered theme survives a restart: a new session's /fisi-dock off restores it", async (t) => {
	const path = stateDir(t, false);
	const before = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "light" });
	before.emit("session_start");
	await fisiDockCommand(before, "on");
	before.emit("session_shutdown");

	const after = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "Fisi-Dock" });
	after.emit("session_start");
	after.widgets.get("fisi-dock")!(after.tui);
	assertFisiDockOwns(after, "on after the restart");
	await fisiDockCommand(after, "off");
	assert.deepEqual(after.themes, ["light"]);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: false, theme: "light", themeApplied: true });
	after.emit("session_shutdown");
});

test("S7 a remembered theme that is gone falls back to Gentleman-Cute, and a missing Gentleman-Cute still warns", async (t) => {
	const path = stateDir(t);
	seedState(path, { enabled: true, theme: "removed-theme", themeApplied: true });
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "Fisi-Dock", knownThemes: ["Fisi-Dock", "Gentleman-Cute"] });
	sim.emit("session_start");
	await fisiDockCommand(sim, "off");
	assert.deepEqual(sim.themes, ["Gentleman-Cute"], "a theme Pi does not know is never tried, so Pi never falls to its system theme on the way");
	assert.equal(sim.ctx.ui.theme.name, "Gentleman-Cute");
	assert.equal(
		sim.notices.at(-1),
		"Fisi Dock off · Gentle Shell's panel and theme Gentleman-Cute are back; /fisi-dock on turns it back on · theme removed-theme not available",
	);
	assertGentleShellOwns(sim, "off");
	sim.emit("session_shutdown");

	seedState(path, { enabled: true, theme: "removed-theme", themeApplied: true });
	const bare = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "Fisi-Dock", knownThemes: ["Fisi-Dock"] });
	bare.emit("session_start");
	await fisiDockCommand(bare, "off");
	assert.deepEqual(bare.themes, ["Gentleman-Cute"]);
	assert.equal(
		bare.notices.at(-1),
		"Fisi Dock off · Gentle Shell's panel is back; /fisi-dock on turns it back on · theme removed-theme not available · theme not changed: Theme not found: Gentleman-Cute",
		"a theme that could not be set is never called back",
	);
	assertGentleShellOwns(bare, "off without any theme to restore");
	bare.emit("session_shutdown");
});

test("S7 a theme setter that throws counts as not changed, on and off, and is never called back", async (t) => {
	const path = stateDir(t);
	seedState(path, { enabled: true, theme: "dark", themeApplied: true });
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "Fisi-Dock", throwingThemes: ["dark", "Gentleman-Cute", "Fisi-Dock"] });
	sim.emit("session_start");
	await fisiDockCommand(sim, "off");
	assert.deepEqual(sim.themes, ["dark", "Gentleman-Cute"]);
	assert.equal(
		sim.notices.at(-1),
		"Fisi Dock off · Gentle Shell's panel is back; /fisi-dock on turns it back on · theme dark not available · theme not changed: unknown theme",
	);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: false, theme: "dark", themeApplied: true }, "the remembered theme is kept for the next off");
	await fisiDockCommand(sim, "on");
	assert.equal(sim.notices.at(-1), "Fisi Dock on · theme not changed: unknown theme");
	sim.emit("session_shutdown");
});

// --- The first start applies the Fisi-Dock theme once (T9) -------------------

const readState = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("T9 the first start remembers the theme in use, applies Fisi-Dock and says so once; off puts that exact theme back", async (t) => {
	const path = stateDir(t);
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "dark" });
	sim.emit("session_start");
	assert.deepEqual(sim.themes, ["Fisi-Dock"]);
	assert.equal(sim.ctx.ui.theme.name, "Fisi-Dock");
	assert.deepEqual(readState(path), { enabled: true, theme: "dark", themeApplied: true });
	assert.deepEqual(sim.notices, ["Fisi Dock applied its theme · /fisi-dock off puts your theme dark back"]);
	sim.widgets.get("fisi-dock")!(sim.tui);
	assertFisiDockOwns(sim, "the dock starts as before");
	await fisiDockCommand(sim, "off");
	assert.deepEqual(sim.themes, ["Fisi-Dock", "dark"], "exactly the theme you had");
	assert.equal(sim.notices.at(-1), "Fisi Dock off · Gentle Shell's panel and your theme dark are back; /fisi-dock on turns it back on");
	assert.deepEqual(readState(path), { enabled: false, theme: "dark", themeApplied: true }, "off keeps the step done");
	sim.emit("session_shutdown");
});

test("T9 the step never repeats: a theme picked later in /settings stays on every following start", (t) => {
	const path = stateDir(t);
	const first = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "dark" });
	first.emit("session_start");
	first.emit("session_shutdown");
	const saved = readFileSync(path, "utf8");
	for (const theme of ["light", "Fisi-Dock", undefined]) {
		const next = simulate("E:\\DEV\\app", { ownsHost: () => true, theme });
		next.emit("session_start");
		assert.deepEqual(next.themes, [], `no theme set with ${theme} in use`);
		assert.deepEqual(next.notices, [], `no notice with ${theme} in use`);
		next.emit("session_shutdown");
	}
	assert.equal(readFileSync(path, "utf8"), saved, "later starts write nothing");
});

test("T9 a state from before the step (no themeApplied) gets it once on the next start; with no theme name the notice names Gentleman-Cute", (t) => {
	const path = stateDir(t);
	seedState(path, { enabled: true, theme: "light" });
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "dark" });
	sim.emit("session_start");
	assert.deepEqual(sim.themes, ["Fisi-Dock"]);
	assert.deepEqual(readState(path), { enabled: true, theme: "dark", themeApplied: true }, "the theme in use now is the one off gives back");
	assert.deepEqual(sim.notices, ["Fisi Dock applied its theme · /fisi-dock off puts your theme dark back"]);
	sim.emit("session_shutdown");

	seedState(path, { enabled: true, theme: "light" });
	const unnamed = simulate("E:\\DEV\\app", { ownsHost: () => true });
	unnamed.emit("session_start");
	assert.deepEqual(unnamed.themes, ["Fisi-Dock"]);
	assert.deepEqual(readState(path), { enabled: true, theme: "light", themeApplied: true }, "no theme name in use keeps the one remembered");
	assert.deepEqual(unnamed.notices, ["Fisi Dock applied its theme · /fisi-dock off puts your theme light back"]);
	unnamed.emit("session_shutdown");

	seedState(path, { enabled: true });
	const bare = simulate("E:\\DEV\\app", { ownsHost: () => true });
	bare.emit("session_start");
	assert.deepEqual(bare.themes, ["Fisi-Dock"]);
	assert.deepEqual(readState(path), { enabled: true, themeApplied: true });
	assert.deepEqual(bare.notices, ["Fisi Dock applied its theme · /fisi-dock off puts theme Gentleman-Cute back"]);
	bare.emit("session_shutdown");
});

test("T9 a state that says off gets nothing at start; /fisi-dock on sets the theme and marks the step done", async (t) => {
	const path = stateDir(t);
	seedState(path, { enabled: false });
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "dark" });
	sim.emit("session_start");
	assert.deepEqual(sim.themes, []);
	assert.deepEqual(sim.notices, []);
	assert.deepEqual(readState(path), { enabled: false }, "dormant: the step stays pending");
	await fisiDockCommand(sim, "on");
	assert.deepEqual(sim.themes, ["Fisi-Dock"]);
	assert.equal(sim.notices.at(-1), "Fisi Dock on · theme Fisi-Dock");
	assert.deepEqual(readState(path), { enabled: true, theme: "dark", themeApplied: true });
	sim.emit("session_shutdown");

	const later = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "light" });
	later.emit("session_start");
	assert.deepEqual(later.themes, [], "after on, a start applies nothing");
	assert.deepEqual(later.notices, []);
	later.emit("session_shutdown");

	// An on whose theme could not be set leaves the step pending.
	seedState(path, { enabled: false });
	const failing = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "dark", failingThemes: ["Fisi-Dock"] });
	failing.emit("session_start");
	await fisiDockCommand(failing, "on");
	assert.deepEqual(readState(path), { enabled: true, theme: "dark" });
	failing.emit("session_shutdown");
});

test("T9 a start with Fisi-Dock already in use marks the step done without setting it again or remembering Fisi-Dock", (t) => {
	const path = stateDir(t);
	seedState(path, { enabled: true, theme: "light" });
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "Fisi-Dock" });
	sim.emit("session_start");
	assert.deepEqual(sim.themes, []);
	assert.deepEqual(sim.notices, []);
	assert.deepEqual(readState(path), { enabled: true, theme: "light", themeApplied: true });
	sim.emit("session_shutdown");

	const fresh = stateDir(t);
	const other = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "Fisi-Dock" });
	other.emit("session_start");
	assert.deepEqual(other.themes, []);
	assert.deepEqual(readState(fresh), { enabled: true, themeApplied: true });
	other.emit("session_shutdown");
});

test("T9 a Fisi-Dock theme Pi does not know, or a setter that fails or throws, leaves the step pending for the next start", (t) => {
	const path = stateDir(t);
	const unknown = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "dark", knownThemes: ["dark"] });
	unknown.emit("session_start");
	assert.deepEqual(unknown.themes, [], "an unknown Fisi-Dock is never tried");
	assert.equal(existsSync(path), false, "nothing written");
	assert.deepEqual(unknown.notices, []);
	for (const key of WIDGET_KEYS) assert.equal(typeof unknown.widgets.get(key), "function", `${key} set: the dock still starts`);
	unknown.emit("session_shutdown");

	for (const broken of [{ failingThemes: ["Fisi-Dock"] }, { throwingThemes: ["Fisi-Dock"] }]) {
		const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "dark", ...broken });
		assert.doesNotThrow(() => sim.emit("session_start"));
		assert.deepEqual(sim.themes, ["Fisi-Dock"]);
		assert.equal(sim.ctx.ui.theme.name, "dark");
		assert.deepEqual(readState(path), { enabled: true, theme: "dark" }, "remembered, not marked");
		assert.deepEqual(sim.notices, []);
		for (const key of WIDGET_KEYS) assert.equal(typeof sim.widgets.get(key), "function", `${key} set`);
		sim.emit("session_shutdown");
	}

	const working = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "dark" });
	working.emit("session_start");
	assert.deepEqual(working.themes, ["Fisi-Dock"], "the next start tries again");
	assert.deepEqual(readState(path), { enabled: true, theme: "dark", themeApplied: true });
	assert.deepEqual(working.notices, ["Fisi Dock applied its theme · /fisi-dock off puts your theme dark back"]);
	working.emit("session_shutdown");
});

test("T9 a state file that cannot be written never changes the theme, and the dock still starts", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-agent-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	t.after(() => {
		process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	});
	writeFileSync(join(dir, "fisi-dock"), "");
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "dark" });
	assert.doesNotThrow(() => sim.emit("session_start"));
	assert.deepEqual(sim.themes, []);
	assert.deepEqual(sim.notices, []);
	sim.widgets.get("fisi-dock")!(sim.tui);
	assertFisiDockOwns(sim, "the dock starts");
	sim.emit("session_shutdown");
});

test("T9 a delegated child session (GENTLE_PI_AGENTS_CHILD=1) or a session without a UI never touches the theme or the state", (t) => {
	const path = stateDir(t);
	t.after(() => delete process.env.GENTLE_PI_AGENTS_CHILD);
	process.env.GENTLE_PI_AGENTS_CHILD = "1";
	const child = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "dark" });
	child.emit("session_start");
	assert.deepEqual(child.themes, []);
	assert.deepEqual(child.notices, []);
	assert.equal(existsSync(path), false);
	child.emit("session_shutdown");
	delete process.env.GENTLE_PI_AGENTS_CHILD;

	const headless = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "dark" });
	headless.ctx.hasUI = false;
	headless.emit("session_start");
	assert.deepEqual(headless.themes, []);
	assert.equal(existsSync(path), false);
	headless.emit("session_shutdown");
});

test("S95 /fisi-dock offers on and off as completions, then settings (S1)", () => {
	const sim = simulate("E:\\DEV\\app");
	const command = sim.commands.get("fisi-dock") as Command & { getArgumentCompletions?(prefix: string): { value: string }[] | null };
	assert.deepEqual(command.getArgumentCompletions?.("")?.map((item) => item.value), ["on", "off", "settings"]);
	assert.deepEqual(command.getArgumentCompletions?.("of")?.map((item) => item.value), ["off"]);
});

test("S95 preserve: with the state file on, session_start takes over as before", (t) => {
	const path = stateDir(t, true);
	const gentle = gentleEditorFactory();
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, editor: gentle });
	sim.emit("session_start");
	for (const key of WIDGET_KEYS) assert.equal(typeof sim.widgets.get(key), "function", `${key} set`);
	sim.widgets.get("fisi-dock")!(sim.tui);
	assertFisiDockOwns(sim, "session_start");
	assert.notEqual(sim.ctx.ui.getEditorComponent(), gentle);
	assert.equal((globalThis as Record<symbol, unknown>)[Symbol.for("fisi-dock")], true);
	assert.deepEqual(sim.themes, []);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true, themeApplied: true }, "the state is only read");
	sim.emit("session_shutdown");
});

test("S95 preserve: with the state file on, /dock opens the overlay as before", async (t) => {
	stateDir(t, true);
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false });
	sim.emit("session_start");
	const pending = Promise.resolve(sim.commands.get("dock")!.handler("", sim.ctx));
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(sim.customs.length, 1);
	assert.equal(sim.customs[0].options?.overlay, true);
	assert.deepEqual(sim.notices, []);
	const view = sim.customs[0].factory({ terminal: { columns: 64, rows: 36 }, requestRender() {} }, {}, KEYS, sim.customs[0].closed);
	view.handleInput?.("\x1b");
	await pending;
	sim.emit("session_shutdown");
});

test("S95 preserve: with the state file on, session_shutdown gives everything back as before and writes nothing", (t) => {
	const path = stateDir(t, true);
	const gentle = gentleEditorFactory();
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, editor: gentle });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	sim.emit("session_shutdown");
	assertGentleShellOwns(sim, "shutdown");
	assert.equal(sim.ctx.ui.getEditorComponent(), gentle);
	assert.equal((globalThis as Record<symbol, unknown>)[Symbol.for("fisi-dock")], false);
	assert.equal(listenerCount(sim), 0);
	assert.deepEqual(sim.themes, []);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: true, themeApplied: true });
});

// --- Welcome card instead of Gentle Shell's rose (S1) ------------------------

const roseHeader = () => ({ render: () => ["rose"], invalidate() {} });
const startCard = (sim: Sim) => (sim.startHeader.current?.render(100) ?? []).map(plain).join("\n");

test("S1 the startup header is the welcome card, and it takes the slot back when Gentle Shell's rose replaces it", async (t) => {
	stateDir(t, true);
	const sim = simulate("E:\\DEV\\projects\\my-app");
	sim.emit("session_start");
	assert.match(startCard(sim), /Gentle Shell[\s\S]*with Fisi Dock[\s\S]*Ready in my-app[\s\S]*Resume session +\/resume/);
	const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
	assert.ok(startCard(sim).includes(`with Fisi Dock ${version}`), "Fisi Dock's own version, from its package.json");

	sim.ctx.ui.setHeader(roseHeader);
	assert.equal(startCard(sim), "rose", "Gentle Shell's banner lands later");
	await Promise.resolve();
	assert.match(startCard(sim), /with Fisi Dock/, "the card is back on the next microtask");
	sim.emit("session_shutdown");
});

test("S1 a header call Pi drops before its own header exists is tried again", (t) => {
	stateDir(t, true);
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const sim = simulate("E:\\DEV\\projects\\my-app");
	sim.startHeader.ready = false;
	sim.emit("session_start");
	assert.equal(sim.startHeader.current, undefined);
	sim.startHeader.ready = true;
	t.mock.timers.tick(100);
	assert.match(startCard(sim), /with Fisi Dock/);
	sim.emit("session_shutdown");
});

test("S1 /fisi-dock off gives the startup header back to Pi and stops reclaiming it; off at start installs none", async (t) => {
	stateDir(t, true);
	const sim = simulate("E:\\DEV\\projects\\my-app");
	sim.emit("session_start");
	await fisiDockCommand(sim, "off");
	assert.equal(sim.startHeader.current, undefined, "Pi's built-in header");
	sim.ctx.ui.setHeader(roseHeader);
	await Promise.resolve();
	assert.equal(startCard(sim), "rose", "nothing takes it back while off");

	sim.emit("session_start");
	await Promise.resolve();
	assert.equal(startCard(sim), "rose", "a dormant start leaves the header alone");
	sim.emit("session_shutdown");
});

// --- Loaded box under the welcome card (design start-screen/02) --------------

/** Pi's ExpandableText (interactive-mode.js): a ThemedText whose build follows `state.expanded`. */
class PiSection extends Text {
	state: { expanded: boolean };
	build: () => string;
	constructor(collapsed: string, expanded: string) {
		super("", 0, 0);
		const state = { expanded: false };
		this.state = state;
		this.build = () => (state.expanded ? expanded : collapsed);
	}
	setExpanded(expanded: boolean): void {
		this.state.expanded = expanded;
		this.invalidate();
	}
	override render(width: number): string[] {
		this.setText(this.build());
		return super.render(width);
	}
}

/**
 * Pi's tree around the simulated header slot: TUI > document > [header (spacer,
 * the current custom header, spacer), loaded resources, chat]. The loaded
 * resources hold Pi's three listing sections and a skill warning, each followed
 * by a spacer, as showLoadedResources adds them.
 */
function mountPi(sim: Sim) {
	const before = new Spacer(1);
	const after = new Spacer(1);
	const header = { get children() { return [before, sim.startHeader.current ?? { render: () => ["pi header"] }, after]; }, render: () => [] };
	const loaded = new Container();
	for (const [name, names] of [["Skills", "btw, go-testing"], ["Prompts", "/skill-creation"], ["Extensions", "fisi-dock.ts, gentle-ai.ts"]]) {
		loaded.addChild(new PiSection(`[${name}]\n  ${names}`, `[${name}]\n  user\n    ${names.split(", ").join("\n    ")}`));
		loaded.addChild(new Spacer(1));
	}
	loaded.addChild(new Text("[Skill warnings]\n  duplicate skill name: skill-creator", 0, 0));
	loaded.addChild(new Spacer(1));
	const document = { children: [header, loaded, new Container()], render: () => [] };
	(sim.tui as { children?: unknown[] }).children = [document];
	return loaded;
}

const listing = (loaded: Container, width = 100) => loaded.render(width).map((line) => plain(line).trimEnd());
const piListing = (loaded: Container, width = 100) => Container.prototype.render.call(loaded, width).map((line) => plain(line).trimEnd());

test("S1 S2 under the welcome card Pi's listing is the loaded box; Pi's warning stays under it", (t) => {
	stateDir(t, true);
	const sim = simulate("E:\DEV\projects\my-app");
	sim.emit("session_start");
	const loaded = mountPi(sim);
	startCard(sim);
	const lines = listing(loaded);
	const indent = " ".repeat(18);
	const row = (content: string) => `${indent}│  ${content.padEnd(57)}  │`;
	assert.deepEqual(lines, [
		`${indent}╭─ loaded ────────────────────────────────────────────────────╮`,
		row("skills      2  btw, go-testing"),
		row("prompts     1  /skill-creation"),
		row("extensions  2  fisi-dock.ts, gentle-ai.ts"),
		`${indent}╰───────────────────────────────────────── ctrl+o lists them ─╯`,
		"",
		"[Skill warnings]",
		"  duplicate skill name: skill-creator",
		"",
	]);
	sim.emit("session_shutdown");
});

test("S3 Pi's expand toggle (the sections expanded) shows Pi's full listing; collapsed, the box is back", (t) => {
	stateDir(t, true);
	const sim = simulate("E:\DEV\projects\my-app");
	sim.emit("session_start");
	const loaded = mountPi(sim);
	startCard(sim);
	for (const child of loaded.children) (child as Partial<PiSection>).setExpanded?.(true);
	assert.deepEqual(listing(loaded), piListing(loaded));
	assert.ok(listing(loaded).includes("    gentle-ai.ts"), "names and scopes reachable");
	for (const child of loaded.children) (child as Partial<PiSection>).setExpanded?.(false);
	assert.ok(listing(loaded)[0].includes("╭─ loaded "));
	sim.emit("session_shutdown");
});

test("S4 S5 /fisi-dock off and session shutdown give Pi's listing back; Container.prototype is never touched", async (t) => {
	stateDir(t, true);
	const prototypeRender = Container.prototype.render;
	const sim = simulate("E:\DEV\projects\my-app");
	sim.emit("session_start");
	const loaded = mountPi(sim);
	startCard(sim);
	assert.ok(listing(loaded)[0].includes("╭─ loaded "));
	assert.equal(Container.prototype.render, prototypeRender);
	await fisiDockCommand(sim, "off");
	assert.ok(!Object.hasOwn(loaded, "render"), "off: Pi's own render on the container");
	assert.deepEqual(listing(loaded), piListing(loaded));

	await fisiDockCommand(sim, "on");
	startCard(sim);
	assert.ok(listing(loaded)[0].includes("╭─ loaded "), "on again: the box is back");
	sim.emit("session_shutdown");
	assert.ok(!Object.hasOwn(loaded, "render"), "shutdown: Pi's own render on the container");
	assert.deepEqual(listing(loaded), piListing(loaded));
	assert.equal(Container.prototype.render, prototypeRender);
});

test("S4 while Gentle Shell's rose holds the header (no card) Pi's listing shows; the card back brings the box back", async (t) => {
	stateDir(t, true);
	const sim = simulate("E:\DEV\projects\my-app");
	sim.emit("session_start");
	const loaded = mountPi(sim);
	startCard(sim);
	sim.ctx.ui.setHeader(roseHeader);
	assert.deepEqual(listing(loaded), piListing(loaded));
	await Promise.resolve();
	assert.ok(listing(loaded)[0].includes("╭─ loaded "));
	sim.emit("session_shutdown");
});

test("S4 a TUI tree Fisi Dock does not recognize leaves Pi's output alone and the card still renders", (t) => {
	stateDir(t, true);
	const sim = simulate("E:\DEV\projects\my-app");
	sim.emit("session_start");
	assert.match(startCard(sim), /with Fisi Dock/, "no children on the TUI: nothing found, nothing thrown");
	// The header's sibling is not Pi's listing (a chat-like container): it renders as before.
	const odd = new Container();
	odd.addChild({ render: () => ["a message"], invalidate() {} } as never);
	const header = { get children() { return [sim.startHeader.current]; }, render: () => [] };
	(sim.tui as { children?: unknown[] }).children = [{ children: [header, odd], render: () => [] }];
	startCard(sim);
	assert.deepEqual(odd.render(100).map(plain), ["a message"]);
	sim.emit("session_shutdown");
	assert.ok(!Object.hasOwn(odd, "render"));
});

test("S6 the welcome card replaces only Gentle Shell's banner: without Gentle Shell's commands Pi keeps its own header", async (t) => {
	stateDir(t, true);
	const bare = simulate("E:/DEV/projects/my-app", { commands: () => [{ name: "skill:btw", source: "skill" }] });
	bare.emit("session_start");
	await Promise.resolve();
	assert.equal(bare.startHeader.current, undefined, "Pi's built-in header stays");
	bare.emit("session_shutdown");

	const shell = simulate("E:/DEV/projects/my-app", { commands: () => [{ name: "gentle:banner", source: "extension" }] });
	shell.emit("session_start");
	assert.match(startCard(shell), /with Fisi Dock/);
	shell.emit("session_shutdown");
});

test("T9 without Gentle Shell (no gentle:banner command) the first start leaves the theme alone and keeps the step pending", (t) => {
	const path = stateDir(t);
	const sim = simulate("E:\DEV\app", { theme: "dark", commands: () => [{ name: "skill:btw", source: "skill" }] });
	sim.emit("session_start");
	assert.deepEqual(sim.themes, [], "plain Pi keeps its theme");
	assert.equal(existsSync(path) ? readState(path).themeApplied : undefined, undefined, "the step stays pending");
	sim.emit("session_shutdown");
});

// --- /fisi-dock settings (look settings S1, S5, S6) ---------------------------

/** Opens `/fisi-dock settings` (or runs `args`) and mounts its overlay on a `columns` x `rows` terminal. */
async function openSettings(sim: Sim, columns = 60, rows = 24, args = "settings") {
	const count = sim.customs.length;
	let closed = false;
	const pending = Promise.resolve(fisiDockCommand(sim, args)).then(() => (closed = true));
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(sim.customs.length, count + 1, "one overlay opened");
	const custom = sim.customs.at(-1)!;
	let renders = 0;
	const tui = { terminal: { ...sim.tui.terminal, columns, rows }, requestRender: () => void renders++ };
	const view = custom.factory(tui, {}, KEYS, custom.closed);
	return { custom, view, pending, closed: () => closed, renders: () => renders, width: overlayWidth(custom, columns) };
}
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
type Rail = { render(width: number): string[]; digest(): string };
/** The rail shows its MCP row: the session's MCP config read settled, so a later frame differs only by what the test changed. */
const mcpRead = (sim: Sim) => (sim.parts.get("footer") as Rail).render(57).some((line) => plain(line).includes("mcp "));
const hasBraille = (lines: string[]) => lines.slice(0, 4).some((line) => /[\u2800-\u28ff]/.test(plain(line)));

test("S1 /fisi-dock settings opens the look overlay: rows, values, hint and a live preview, every row the overlay width; Esc closes", async (t) => {
	stateDir(t, true);
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const settings = await openSettings(sim);
	assert.equal(settings.custom.options?.overlay, true);
	assert.equal(settings.width, 60);
	const lines = settings.view.render(settings.width);
	assert.equal(lines.length, 24, "the whole screen height");
	for (const line of lines) assert.equal(visibleWidth(line), 60, "opaque: every row the overlay width");
	const shown = lines.map(plain);
	assert.match(shown[0], /^ Fisi Dock look/);
	assert.match(shown[2], /^ › logo +‹ braille › *$/);
	assert.match(shown[3], /^ {3}frames +‹ faded › *$/);
	assert.match(shown[4], /^ {3}colors +‹ vivid › *$/);
	assert.match(shown[5], /^ {3}accent +‹ pink › *$/);
	assert.match(shown[6], /^ {3}divider +‹ medium › *$/);
	assert.match(shown[7], /^ {3}motion +‹ on › *$/);
	assert.ok(shown.some((line) => line.includes("session")), "the live preview of the rail");
	assert.match(shown.at(-1)!, /^ ↑↓ choose · ←→ change · Esc close *$/);
	console.log(`--- simulated /fisi-dock settings, 60x24, default look\n${shown.join("\n")}`);
	settings.view.handleInput?.(DOWN);
	settings.view.handleInput?.(RIGHT);
	const after = settings.view.render(60).map(plain);
	assert.match(after[3], /^ › frames +‹ classic › *$/);
	console.log(`--- simulated /fisi-dock settings, 60x24, after ↓ →\n${after.join("\n")}`);
	assert.equal(settings.closed(), false);
	settings.view.handleInput?.("\x1b");
	await settings.pending;
	assert.ok(settings.closed());
	sim.emit("session_shutdown");
});

test("S1 S5 each change applies at once and is saved: the rail repaints (memo and digest follow the look), state.json keeps its other keys", async (t) => {
	const path = stateDir(t, true);
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const rail = sim.parts.get("footer") as Rail;
	await waitFor(() => mcpRead(sim));
	assert.ok(mcpRead(sim), "the MCP row shows");
	const before = rail.render(57);
	const digest = rail.digest();
	assert.ok(hasBraille(before), "today's braille logo (S6)");
	const settings = await openSettings(sim);

	settings.view.handleInput?.(DOWN);
	settings.view.handleInput?.(RIGHT);
	assert.ok(settings.renders() > 0, "a change repaints");
	assert.deepEqual(readState(path), { enabled: true, themeApplied: true, look: { logo: "braille", frames: "classic", colors: "vivid", accent: "pink", divider: "medium", motion: "on", sections: DEFAULT_SECTIONS } });
	const classic = rail.render(57);
	assert.notDeepEqual(classic, before, "the frames changed with no other model change");
	assert.notEqual(rail.digest(), digest, "Gentle Shell's rail memo sees the change");

	settings.view.handleInput?.(UP);
	settings.view.handleInput?.("l");
	settings.view.handleInput?.("l");
	assert.equal(readState(path).look.logo, "none");
	assert.ok(!hasBraille(rail.render(57)), "no logo");

	settings.view.handleInput?.("j");
	settings.view.handleInput?.("j");
	settings.view.handleInput?.("\r");
	assert.equal(readState(path).look.colors, "soft", "Enter cycles forward");
	const soft = rail.render(57);
	settings.view.handleInput?.(LEFT);
	assert.notDeepEqual(rail.render(57), soft, "the colors repaint too");

	// Back to the default look: the very first rail again.
	settings.view.handleInput?.("k");
	settings.view.handleInput?.("k");
	settings.view.handleInput?.(RIGHT);
	settings.view.handleInput?.("j");
	settings.view.handleInput?.(LEFT);
	assert.deepEqual(readState(path).look, { logo: "braille", frames: "faded", colors: "vivid", accent: "pink", divider: "medium", motion: "on", sections: DEFAULT_SECTIONS });
	assert.deepEqual(rail.render(57), before);
	assert.equal(rail.digest(), digest);
	settings.view.handleInput?.("q");
	await settings.pending;
	sim.emit("session_shutdown");
});

test("look-more S6 settings › sections: → opens the list, space hides, Shift+↑ and K move; each change is saved and the rail and /dock repaint; Esc goes back, Esc again closes", async (t) => {
	const path = stateDir(t, true);
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const rail = sim.parts.get("footer") as Rail;
	await waitFor(() => mcpRead(sim));
	const titles = (lines: string[]) => lines.map(plain).filter((line) => /^. ╭─ /.test(line)).map((line) => line.slice(5).split(" ")[0]);
	const before = rail.render(57);
	const digest = rail.digest();
	assert.deepEqual(titles(before), ["session", "ODD", "todo"], "today's rail");
	const settings = await openSettings(sim);
	for (let index = 0; index < 6; index++) settings.view.handleInput?.(DOWN);
	assert.match(plain(settings.view.render(60)[8]), /^ › sections  7 of 7 › *$/);
	settings.view.handleInput?.(RIGHT);
	let shown = settings.view.render(60).map(plain);
	assert.match(shown[0], /^ Fisi Dock look › sections *$/);
	assert.match(shown[2], /^ › \[x\] heads-up *$/);
	assert.match(shown.at(-1)!, /^ space show · shift\+↑↓ move · Esc back *$/);
	assert.equal(existsSync(path) ? readState(path).look : undefined, undefined, "opening the list saves nothing");

	settings.view.handleInput?.(DOWN);
	settings.view.handleInput?.(" ");
	const sections = () => (readState(path).look.sections as { id: string; shown: boolean }[]).map((section) => `${section.shown ? "" : "!"}${section.id}`).join(" ");
	assert.equal(sections(), "heads-up !odd rdd ci agents todo changes", "space hides ODD, saved");
	assert.deepEqual(titles(rail.render(57)), ["session", "todo"], "the rail drops ODD at once");
	assert.notEqual(rail.digest(), digest, "Gentle Shell's rail memo sees it");

	for (let index = 0; index < 4; index++) settings.view.handleInput?.(DOWN);
	settings.view.handleInput?.("\x1b[1;2A");
	assert.equal(sections(), "heads-up !odd rdd ci todo agents changes", "Shift+↑ moves todo up");
	settings.view.handleInput?.("K");
	settings.view.handleInput?.("K");
	settings.view.handleInput?.("K");
	assert.equal(sections(), "heads-up todo !odd rdd ci agents changes", "K moves it on");
	settings.view.handleInput?.(DOWN);
	settings.view.handleInput?.(" ");
	assert.equal(sections(), "heads-up todo odd rdd ci agents changes", "the cursor followed todo: one down is ODD, space shows it again");
	assert.deepEqual(titles(rail.render(57)), ["session", "todo", "ODD"], "todo above ODD on the rail");
	shown = settings.view.render(60).map(plain);
	assert.match(shown[3], /^ {3}\[x\] todo *$/);
	assert.match(shown[4], /^ › \[x\] odd *$/, "the cursor on ODD");
	assert.ok(settings.renders() > 0, "each change repaints");

	settings.view.handleInput?.("\x1b");
	assert.equal(settings.closed(), false, "Esc goes back to the main rows");
	shown = settings.view.render(60).map(plain);
	assert.match(shown[0], /^ Fisi Dock look *$/);
	assert.match(shown[8], /^ › sections  7 of 7 › *$/);
	settings.view.handleInput?.("\x1b");
	await settings.pending;
	assert.ok(settings.closed(), "Esc on the main rows closes");
	assert.deepEqual(readState(path), { enabled: true, themeApplied: true, look: { logo: "braille", frames: "faded", colors: "vivid", accent: "pink", divider: "medium", motion: "on", sections: ["heads-up", "todo", "odd", "rdd", "ci", "agents", "changes"].map((id) => ({ id, shown: true })) } });

	// /dock takes the order too.
	const dockOpen = Promise.resolve(sim.commands.get("dock")!.handler("", sim.ctx));
	await new Promise((resolve) => setTimeout(resolve, 0));
	const dock = sim.customs.at(-1)!;
	const dockView = dock.factory({ terminal: { ...sim.tui.terminal, columns: 64, rows: 60 }, requestRender() {} }, {}, KEYS, dock.closed);
	const dockLines = dockView.render(64).map(plain);
	const at = (title: string) => dockLines.findIndex((line) => line.includes(`╭─ ${title}`));
	assert.ok(at("session") >= 0 && at("session") < at("todo") && at("todo") < at("ODD"), "/dock: session, todo, ODD");
	dockView.handleInput?.("");
	await dockOpen;
	sim.emit("session_shutdown");
});

test("S1 the prompt line, the user frame, the narrow cards, the prompt box and /dock paint in the chosen look", async (t) => {
	stateDir(t, true);
	class UserMessageComponent {
		children: unknown[] = [];
		render(width: number): string[] {
			return [" hola".padEnd(width)];
		}
	}
	const message = new UserMessageComponent();
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false, branch: () => todoBranch(1, 3), editor: gentleEditorFactory() });
	Object.assign(sim.tui, { children: [{ children: [message] }] });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const strip = sim.widgets.get("fisi-dock-strip")!(sim.tui);
	const promptLine = sim.widgets.get("fisi-dock-prompt-line")!(sim.tui);
	const editor = (sim.ctx.ui.getEditorComponent() as EditorFactory)(sim.tui, {}, {});
	const labels = { mode: undefined, modelId: "claude-opus-5-5", effort: "high" };
	const vivid = { user: message.render(20), cards: strip.render(53), box: editor.render(60) };
	editor.render(12);
	const vividLine = promptLine.render(100);
	assert.deepEqual(vividLine, renderPromptLine(labels, 100), "the box did not fit: the line under the prompt");

	const settings = await openSettings(sim);
	settings.view.handleInput?.(DOWN);
	settings.view.handleInput?.(DOWN);
	settings.view.handleInput?.(RIGHT);
	editor.render(12);
	assert.deepEqual(promptLine.render(100), renderPromptLine(labels, 100, "soft"), "the line under the prompt");
	assert.notDeepEqual(promptLine.render(100), vividLine);
	assert.deepEqual(message.render(20), frameUserLines((width) => [" hola".padEnd(width)], 20, "soft", "faded"), "the user frame");
	assert.notDeepEqual(message.render(20), vivid.user);
	assert.ok(strip.render(53).some((line) => plain(line).startsWith("╭─ todo")));
	assert.notDeepEqual(strip.render(53), vivid.cards, "the todo card (its memo follows the look)");
	assert.notDeepEqual(editor.render(60), vivid.box, "the prompt box labels");
	settings.view.handleInput?.("\x1b");
	await settings.pending;

	// /dock draws the panel in the chosen look too.
	const dockOpen = Promise.resolve(sim.commands.get("dock")!.handler("", sim.ctx));
	await new Promise((resolve) => setTimeout(resolve, 0));
	const dock = sim.customs.at(-1)!;
	const dockView = dock.factory({ terminal: { ...sim.tui.terminal, columns: 64, rows: 36 }, requestRender() {} }, {}, KEYS, dock.closed);
	const softDock = dockView.render(64);
	const second = await openSettings(sim);
	second.view.handleInput?.(DOWN);
	second.view.handleInput?.(RIGHT);
	second.view.handleInput?.("\x1b");
	await second.pending;
	assert.notDeepEqual(dockView.render(64), softDock, "the frames change in /dock");
	dockView.handleInput?.("\x1b");
	await dockOpen;
	sim.emit("session_shutdown");
});

test("look-more S3 the prompt box and the user frame follow the frames: faded by default, classic and none at once from the menu", async (t) => {
	stateDir(t, true);
	class UserMessageComponent {
		children: unknown[] = [];
		render(width: number): string[] {
			return [" hola".padEnd(width)];
		}
	}
	const message = new UserMessageComponent();
	const pi = (width: number) => [" hola".padEnd(width)];
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false, editor: gentleEditorFactory() });
	Object.assign(sim.tui, { children: [{ children: [message] }] });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const editor = (sim.ctx.ui.getEditorComponent() as EditorFactory)(sim.tui, {}, {});
	const faded = { user: message.render(30), box: editor.render(60) };
	assert.deepEqual(faded.user, frameUserLines(pi, 30, "vivid", "faded"), "the default look: faded");
	assert.equal(plain(faded.box[0]).slice(0, 2), "╭─");

	const settings = await openSettings(sim);
	settings.view.handleInput?.(DOWN);
	settings.view.handleInput?.(RIGHT);
	const classic = { user: message.render(30), box: editor.render(60) };
	assert.deepEqual(classic.user, frameUserLines(pi, 30), "classic: today's user frame");
	assert.notDeepEqual(classic.user, faded.user);
	assert.notDeepEqual(classic.box, faded.box, "the prompt box repaints at once");
	assert.deepEqual(classic.box.map(plain), faded.box.map(plain), "same geometry");
	settings.view.handleInput?.(RIGHT);
	const none = { user: message.render(30), box: editor.render(60) };
	assert.deepEqual(none.user, frameUserLines(pi, 30, "vivid", "none"));
	assert.deepEqual(none.user.map((line) => plain(line).replace(/\x1b\]133;[ABC]\x07/g, "")), [`── you ${"─".repeat(23)}`, `  hola${" ".repeat(24)}`]);
	assert.equal(none.box.length, classic.box.length - 1, "no bottom border");
	assert.ok(plain(none.box.find((row) => plain(row).includes("✿"))!).startsWith("── ✿"), "the labels on a bare rule");
	assert.ok(!none.box.some((row) => /[│╭╮╰╯]/u.test(plain(row))));
	settings.view.handleInput?.("\x1b");
	await settings.pending;
	sim.emit("session_shutdown");
});

test("S1 colors switch Pi's theme to Fisi-Dock-Soft and back while Fisi Dock's theme is in use; the user's theme is never remembered as Fisi Dock's, and off puts it back", async (t) => {
	const path = stateDir(t);
	seedState(path, { enabled: true, theme: "dark", themeApplied: true });
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "Fisi-Dock" });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	/** Opens the menu, changes the colors with `key` and closes it. */
	const changeColors = async (key: string) => {
		const settings = await openSettings(sim);
		settings.view.handleInput?.(DOWN);
		settings.view.handleInput?.(DOWN);
		settings.view.handleInput?.(key);
		settings.view.handleInput?.("\x1b");
		await settings.pending;
	};
	await changeColors(RIGHT);
	assert.deepEqual(sim.themes, ["Fisi-Dock-Soft"]);
	assert.equal(sim.ctx.ui.theme.name, "Fisi-Dock-Soft");
	assert.deepEqual(readState(path), { enabled: true, theme: "dark", themeApplied: true, look: { logo: "braille", frames: "faded", colors: "soft", accent: "pink", divider: "medium", motion: "on", sections: DEFAULT_SECTIONS } });
	await changeColors(RIGHT);
	assert.deepEqual(sim.themes, ["Fisi-Dock-Soft", "Fisi-Dock-Light"], "look-more S5: soft, then light");
	await changeColors(LEFT);
	assert.deepEqual(sim.themes, ["Fisi-Dock-Soft", "Fisi-Dock-Light", "Fisi-Dock-Soft"]);

	// Off from Fisi-Dock-Soft puts the user's theme back; on remembers nothing of Fisi Dock's and takes the soft theme.
	await fisiDockCommand(sim, "off");
	assert.equal(sim.ctx.ui.theme.name, "dark");
	assert.equal(readState(path).theme, "dark");
	await fisiDockCommand(sim, "on");
	assert.equal(sim.ctx.ui.theme.name, "Fisi-Dock-Soft");
	assert.match(sim.notices.at(-1)!, /^Fisi Dock on · theme Fisi-Dock-Soft/);
	assert.equal(readState(path).theme, "dark");
	sim.emit("session_shutdown");

	// A user theme in use is the user's: colors change the dock, never the theme.
	const own = stateDir(t, true);
	const mine = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "light" });
	mine.emit("session_start");
	const other = await openSettings(mine);
	other.view.handleInput?.(DOWN);
	other.view.handleInput?.(DOWN);
	other.view.handleInput?.(RIGHT);
	assert.deepEqual(mine.themes, []);
	assert.equal(readState(own).look.colors, "soft");
	other.view.handleInput?.("\x1b");
	await other.pending;
	mine.emit("session_shutdown");
});

test("S1 S4 L8 colors never switch Pi's theme inside the menu's key handler: the menu stays responsive, and the theme follows once, when it closes", async (t) => {
	const path = stateDir(t);
	seedState(path, { enabled: true, theme: "dark", themeApplied: true });
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "Fisi-Dock" });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const rail = sim.parts.get("footer") as Rail;
	const vivid = rail.render(57);
	const settings = await openSettings(sim);
	// Pi's setter (interactive-mode.js setTheme -> theme-controller.js applyThemeName -> notifyChanged, and
	// theme.js setTheme -> onThemeChange) invalidates the whole UI and saves settings.json, synchronously:
	// here it repaints the menu and the rail at once, and records each call made while a key is handled.
	const setTheme = sim.ctx.ui.setTheme;
	let keyDepth = 0;
	const duringKey: string[] = [];
	sim.ctx.ui.setTheme = (name: string) => {
		if (keyDepth > 0) duringKey.push(name);
		if (sim.themes.length > 50) throw new Error("theme switch loop");
		settings.view.render(60);
		rail.render(57);
		return setTheme(name);
	};
	const press = (data: string) => {
		keyDepth++;
		try {
			settings.view.handleInput?.(data);
		} finally {
			keyDepth--;
		}
	};
	press(DOWN);
	press(DOWN);
	// Held → (key repeat): vivid, soft, light, vivid, soft (look-more S5 adds light).
	for (let index = 0; index < 4; index++) press(RIGHT);
	assert.deepEqual(duringKey, [], "no theme switch inside the key handler");
	assert.deepEqual(sim.themes, [], "nor while the menu is open");
	assert.equal(readState(path).look.colors, "soft", "each change is saved at once");
	assert.match(plain(settings.view.render(60)[4]), /^ › colors +‹ soft › *$/);
	assert.notDeepEqual(rail.render(57), vivid, "the rail repaints in soft at once");
	assert.equal(settings.closed(), false);
	press("\x1b");
	await settings.pending;
	assert.ok(settings.closed(), "Esc still closes the menu");
	assert.deepEqual(duringKey, [], "not in the closing key's handler either");
	assert.deepEqual(sim.themes, ["Fisi-Dock-Soft"], "one switch, after the menu closed, to the last colors' theme");
	assert.equal(sim.ctx.ui.theme.name, "Fisi-Dock-Soft");
	assert.deepEqual(readState(path), { enabled: true, theme: "dark", themeApplied: true, look: { logo: "braille", frames: "faded", colors: "soft", accent: "pink", divider: "medium", motion: "on", sections: DEFAULT_SECTIONS } });

	// Back and forth to the colors already in use: no switch at all.
	const again = await openSettings(sim);
	again.view.handleInput?.(DOWN);
	again.view.handleInput?.(DOWN);
	again.view.handleInput?.(RIGHT);
	again.view.handleInput?.(LEFT);
	again.view.handleInput?.("\x1b");
	await again.pending;
	assert.deepEqual(sim.themes, ["Fisi-Dock-Soft"]);
	sim.emit("session_shutdown");

	// As before: with the colors left as they were, Fisi-Dock picked in /settings beside soft colors stays.
	writeFileSync(path, JSON.stringify({ enabled: true, theme: "dark", themeApplied: true, look: { colors: "soft" } }));
	const picked = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "Fisi-Dock" });
	picked.emit("session_start");
	const logoOnly = await openSettings(picked);
	logoOnly.view.handleInput?.(RIGHT);
	logoOnly.view.handleInput?.("\x1b");
	await logoOnly.pending;
	assert.equal(readState(path).look.logo, "text");
	assert.deepEqual(picked.themes, [], "a logo change switches no theme");
	picked.emit("session_shutdown");
});

test("S1 Fisi-Dock-Soft in use counts as Fisi Dock's own theme: on and the first start never remember it, and the first start applies the saved colors' theme", async (t) => {
	const path = stateDir(t);
	seedState(path, { enabled: false, theme: "light", themeApplied: true });
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "Fisi-Dock-Soft" });
	sim.emit("session_start");
	await fisiDockCommand(sim, "on");
	assert.equal(readState(path).theme, "light", "Fisi-Dock-Soft is never remembered");
	await fisiDockCommand(sim, "off");
	assert.equal(sim.ctx.ui.theme.name, "light");
	sim.emit("session_shutdown");

	const fresh = stateDir(t);
	const soft = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "Fisi-Dock-Soft" });
	soft.emit("session_start");
	assert.deepEqual(soft.themes, []);
	assert.deepEqual(readState(fresh), { enabled: true, themeApplied: true }, "the step is done, nothing remembered");
	soft.emit("session_shutdown");

	const first = stateDir(t);
	mkdirSync(join(first, ".."), { recursive: true });
	writeFileSync(first, JSON.stringify({ look: { colors: "soft" } }));
	const start = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "dark" });
	start.emit("session_start");
	assert.deepEqual(start.themes, ["Fisi-Dock-Soft"], "the first start applies the soft theme");
	assert.deepEqual(readState(first), { look: { colors: "soft" }, enabled: true, theme: "dark", themeApplied: true });
	assert.match(start.notices.at(-1)!, /^Fisi Dock applied its theme/);
	start.emit("session_shutdown");
});

test("S5 a saved look is used from the next session start; S6 without one the look is today's", async (t) => {
	const path = stateDir(t, true);
	const plainSim = simulate("E:\\DEV\\app", { ownsHost: () => true });
	plainSim.emit("session_start");
	plainSim.widgets.get("fisi-dock")!(plainSim.tui);
	const today = (plainSim.parts.get("footer") as Rail).render(57);
	assert.ok(hasBraille(today));
	const settings = await openSettings(plainSim);
	settings.view.handleInput?.(RIGHT);
	settings.view.handleInput?.(RIGHT);
	settings.view.handleInput?.(DOWN);
	settings.view.handleInput?.(LEFT);
	settings.view.handleInput?.("\x1b");
	await settings.pending;
	// Both rails once the MCP config read settled, so only the look can differ.
	await waitFor(() => mcpRead(plainSim));
	assert.ok(mcpRead(plainSim), "the MCP row shows");
	const picked = (plainSim.parts.get("footer") as Rail).render(57);
	plainSim.emit("session_shutdown");
	assert.deepEqual(readState(path).look, { logo: "none", frames: "none", colors: "vivid", accent: "pink", divider: "medium", motion: "on", sections: DEFAULT_SECTIONS });

	const next = simulate("E:\\DEV\\app", { ownsHost: () => true });
	next.emit("session_start");
	next.widgets.get("fisi-dock")!(next.tui);
	await waitFor(() => mcpRead(next));
	assert.ok(mcpRead(next), "the MCP row shows");
	const rail = (next.parts.get("footer") as Rail).render(57);
	assert.ok(!hasBraille(rail), "no logo from the start");
	assert.deepEqual(rail, picked);
	assert.notDeepEqual(rail, today);
	next.emit("session_shutdown");
});

test("S5 while off, /fisi-dock settings still saves the look and sets no theme; /fisi-dock on applies it", async (t) => {
	const path = stateDir(t);
	seedState(path, { enabled: false, theme: "dark", themeApplied: true });
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "dark" });
	sim.emit("session_start");
	const settings = await openSettings(sim);
	const shown = settings.view.render(60).map(plain);
	assert.match(shown[2], /‹ braille ›/);
	assert.ok(shown.some((line) => line.includes("session")), "a preview even while off");
	settings.view.handleInput?.(DOWN);
	settings.view.handleInput?.(RIGHT);
	settings.view.handleInput?.(DOWN);
	settings.view.handleInput?.(RIGHT);
	settings.view.handleInput?.("\x1b");
	await settings.pending;
	assert.deepEqual(readState(path), { enabled: false, theme: "dark", themeApplied: true, look: { logo: "braille", frames: "classic", colors: "soft", accent: "pink", divider: "medium", motion: "on", sections: DEFAULT_SECTIONS } });
	assert.deepEqual(sim.themes, [], "off: the theme is the user's");
	assertGentleShellOwns(sim, "still off");
	await fisiDockCommand(sim, "on");
	assert.deepEqual(sim.themes, ["Fisi-Dock-Soft"]);
	sim.widgets.get("fisi-dock")!(sim.tui);
	const rail = (sim.parts.get("footer") as Rail).render(57);
	sim.emit("session_shutdown");
	const reference = simulate("E:\\DEV\\app", { ownsHost: () => true });
	reference.emit("session_start");
	reference.widgets.get("fisi-dock")!(reference.tui);
	assert.deepEqual((reference.parts.get("footer") as Rail).render(57), rail, "the same look as a fresh start with it saved");
	reference.emit("session_shutdown");
});

test("S1 without a UI, /fisi-dock settings only says the look; the picker offers settings after on and off, and completions name it", async (t) => {
	const path = stateDir(t, true);
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true });
	sim.emit("session_start");
	sim.ctx.hasUI = false;
	await fisiDockCommand(sim, "settings");
	assert.equal(sim.customs.length, 0);
	assert.equal(sim.notices.at(-1), "Fisi Dock look: logo braille · frames faded · colors vivid · accent pink · divider medium · motion on · sections 7 of 7 · /fisi-dock settings changes it in the interactive UI");
	assert.deepEqual(readState(path), { enabled: true, themeApplied: true });
	sim.ctx.hasUI = true;

	sim.picks.push("settings");
	const settings = await openSettings(sim, 60, 24, "");
	assert.deepEqual(sim.selects.at(-1), { title: "Fisi Dock is on", options: ["off", "on", "settings"] });
	assert.match(settings.view.render(60).map(plain)[0], /Fisi Dock look/);
	settings.view.handleInput?.("\x1b");
	await settings.pending;
	const command = sim.commands.get("fisi-dock") as Command & { getArgumentCompletions?(prefix: string): { value: string }[] | null };
	assert.deepEqual(command.getArgumentCompletions?.("s")?.map((item) => item.value), ["settings"]);
	assert.match(command.description ?? "", /settings/);
	sim.emit("session_shutdown");
});

// --- look-more S1 divider, S2 motion ----------------------------------------------

test("look-more S2 a saved motion off: a running job schedules no animation repaints and the strip and rail hold the still frame", (t) => {
	animated(t);
	const path = stateDir(t, true);
	writeFileSync(path, JSON.stringify({ enabled: true, themeApplied: true, look: { motion: "off" } }));
	let renders = 0;
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false });
	const tui = { terminal: sim.tui.terminal, requestRender: () => void renders++ };
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(tui);
	const strip = sim.widgets.get("fisi-dock-strip")!(tui);
	const rail = sim.parts.get("footer") as Rail;
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	assertJobCard(strip.render(64), "⠹", "the still frame at once");
	const digest = rail.digest();
	const before = renders;
	t.mock.timers.tick(800);
	assert.equal(renders, before, "no spinner timer: no repaints");
	assert.equal(rail.digest(), digest);
	assertJobCard(strip.render(64), "⠹");
	assert.ok(rail.render(47).some((line) => /^│ ⠹ job-1 npm test +\d+(?::\d\d)+ │$/.test(plain(railPanelLine(line)))), "rail agent row, still");
	sim.emit("session_shutdown");
});

test("look-more S2 motion off in the menu stops the running spinner's timer at once; on starts it again", async (t) => {
	animated(t);
	const path = stateDir(t, true);
	let renders = 0;
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => false });
	const tui = { terminal: sim.tui.terminal, requestRender: () => void renders++ };
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(tui);
	const strip = sim.widgets.get("fisi-dock-strip")!(tui);
	sim.emitEvent("gentle-ai:jobs-sidebar", JOB);
	let before = renders;
	t.mock.timers.tick(80);
	assert.ok(renders > before, "motion on: the spinner repaints");
	assertJobCard(strip.render(64), "⠙");

	const settings = await openSettings(sim);
	settings.view.handleInput?.(UP);
	settings.view.handleInput?.(UP);
	assert.match(plain(settings.view.render(60)[7]), /^ › motion +‹ on › *$/);
	settings.view.handleInput?.(RIGHT);
	assert.match(plain(settings.view.render(60)[7]), /^ › motion +‹ off › *$/);
	settings.view.handleInput?.("\x1b");
	await settings.pending;
	assert.equal(readState(path).look.motion, "off", "saved");
	assertJobCard(strip.render(64), "⠹", "the still frame at once");
	before = renders;
	t.mock.timers.tick(800);
	assert.equal(renders, before, "no animation repaints with motion off");
	assertJobCard(strip.render(64), "⠹");

	const again = await openSettings(sim);
	again.view.handleInput?.(UP);
	again.view.handleInput?.(UP);
	again.view.handleInput?.(RIGHT);
	again.view.handleInput?.("\x1b");
	await again.pending;
	assert.equal(readState(path).look.motion, "on");
	before = renders;
	t.mock.timers.tick(80);
	assert.ok(renders > before, "motion on again: the spinner turns");
	sim.emit("session_shutdown");
});

test("look-more S1 the divider row repaints the rail live and is saved: off leaves the first column blank, the panel in place", async (t) => {
	const path = stateDir(t, true);
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const rail = sim.parts.get("footer") as Rail;
	await waitFor(() => mcpRead(sim));
	const medium = rail.render(57);
	const digest = rail.digest();
	assert.ok(medium.some((line) => plain(line)[0] === "│"), "today's divider");
	const settings = await openSettings(sim);
	for (let index = 0; index < 4; index++) settings.view.handleInput?.(DOWN);
	assert.match(plain(settings.view.render(60)[6]), /^ › divider +‹ medium › *$/);
	settings.view.handleInput?.(RIGHT);
	assert.equal(readState(path).look.divider, "off");
	const off = rail.render(57);
	assert.notEqual(rail.digest(), digest, "Gentle Shell's rail memo sees the change");
	assert.ok(off.every((line) => plain(line)[0] === " "), "no divider glyph");
	assert.deepEqual(off.map((line) => plain(line).slice(1)), medium.map((line) => plain(line).slice(1)), "same panel, same width");
	settings.view.handleInput?.(RIGHT);
	settings.view.handleInput?.(RIGHT);
	assert.equal(readState(path).look.divider, "strong");
	assert.notDeepEqual(rail.render(57), medium, "strong repaints");
	settings.view.handleInput?.(RIGHT);
	assert.deepEqual(rail.render(57), medium, "back to medium: today's rail");
	settings.view.handleInput?.("q");
	await settings.pending;
	sim.emit("session_shutdown");
});

// --- look-more S4 accent ---------------------------------------------------------------

test("look-more S4 the accent row repaints at once and, once the menu closes, switches Pi's theme to the accent's one, once; off puts the user's theme back", async (t) => {
	const path = stateDir(t);
	seedState(path, { enabled: true, theme: "dark", themeApplied: true });
	class UserMessageComponent {
		children: unknown[] = [];
		render(width: number): string[] {
			return [" hola".padEnd(width)];
		}
	}
	const message = new UserMessageComponent();
	const pi = (width: number) => [" hola".padEnd(width)];
	const sim = simulate("E:\DEV\app", { ownsHost: () => true, theme: "Fisi-Dock" });
	Object.assign(sim.tui, { children: [{ children: [message] }] });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const rail = sim.parts.get("footer") as Rail;
	const pinkRail = rail.render(57);
	const digest = rail.digest();
	assert.deepEqual(message.render(30), frameUserLines(pi, 30, "vivid", "faded"), "pink `you`");

	const settings = await openSettings(sim);
	for (let index = 0; index < 3; index++) settings.view.handleInput?.(DOWN);
	assert.match(plain(settings.view.render(60)[5]), /^ › accent +‹ pink › *$/);
	settings.view.handleInput?.(RIGHT);
	assert.match(plain(settings.view.render(60)[5]), /^ › accent +‹ teal › *$/);
	assert.equal(readState(path).look.accent, "teal", "saved at once");
	assert.notEqual(rail.digest(), digest, "Gentle Shell's rail memo sees the change");
	assert.notDeepEqual(rail.render(57), pinkRail, "the rail repaints in teal (the logo's SHELL)");
	assert.deepEqual(message.render(30), frameUserLines(pi, 30, "vivid", "faded", "teal"), "`you` in teal");
	settings.view.handleInput?.(RIGHT);
	settings.view.handleInput?.(LEFT);
	assert.deepEqual(sim.themes, [], "no theme switch while the menu is open");
	settings.view.handleInput?.("\x1b");
	await settings.pending;
	assert.deepEqual(sim.themes, ["Fisi-Dock-Teal"], "one switch, to the accent's theme");
	assert.equal(sim.ctx.ui.theme.name, "Fisi-Dock-Teal");
	assert.deepEqual(readState(path), { enabled: true, theme: "dark", themeApplied: true, look: { logo: "braille", frames: "faded", colors: "vivid", accent: "teal", divider: "medium", motion: "on", sections: DEFAULT_SECTIONS } });

	// Soft colors with the teal accent: Fisi-Dock-Teal-Soft.
	const soft = await openSettings(sim);
	soft.view.handleInput?.(DOWN);
	soft.view.handleInput?.(DOWN);
	soft.view.handleInput?.(RIGHT);
	soft.view.handleInput?.("\x1b");
	await soft.pending;
	assert.deepEqual(sim.themes, ["Fisi-Dock-Teal", "Fisi-Dock-Teal-Soft"]);

	// An accent changed and put back: no switch.
	const same = await openSettings(sim);
	for (let index = 0; index < 3; index++) same.view.handleInput?.(DOWN);
	same.view.handleInput?.(RIGHT);
	same.view.handleInput?.(LEFT);
	same.view.handleInput?.("\x1b");
	await same.pending;
	assert.deepEqual(sim.themes, ["Fisi-Dock-Teal", "Fisi-Dock-Teal-Soft"]);

	// Back to pink: the pink soft theme.
	const back = await openSettings(sim);
	for (let index = 0; index < 3; index++) back.view.handleInput?.(DOWN);
	back.view.handleInput?.(LEFT);
	back.view.handleInput?.("\x1b");
	await back.pending;
	assert.deepEqual(sim.themes, ["Fisi-Dock-Teal", "Fisi-Dock-Teal-Soft", "Fisi-Dock-Soft"]);
	assert.equal(readState(path).look.accent, "pink");

	// Off from an accent theme puts the user's theme back; on takes the saved look's theme and remembers nothing of Fisi Dock's.
	const green = await openSettings(sim);
	for (let index = 0; index < 3; index++) green.view.handleInput?.(DOWN);
	green.view.handleInput?.(LEFT);
	green.view.handleInput?.("\x1b");
	await green.pending;
	assert.equal(sim.ctx.ui.theme.name, "Fisi-Dock-Green-Soft");
	await fisiDockCommand(sim, "off");
	assert.equal(sim.ctx.ui.theme.name, "dark");
	assert.equal(readState(path).theme, "dark");
	await fisiDockCommand(sim, "on");
	assert.equal(sim.ctx.ui.theme.name, "Fisi-Dock-Green-Soft");
	assert.match(sim.notices.at(-1)!, /^Fisi Dock on · theme Fisi-Dock-Green-Soft/);
	assert.equal(readState(path).theme, "dark");
	sim.emit("session_shutdown");

	// A user theme in use: the accent changes the dock, never the theme.
	const own = stateDir(t, true);
	const mine = simulate("E:\DEV\app", { ownsHost: () => true, theme: "light" });
	mine.emit("session_start");
	const other = await openSettings(mine);
	for (let index = 0; index < 3; index++) other.view.handleInput?.(DOWN);
	other.view.handleInput?.(RIGHT);
	other.view.handleInput?.("\x1b");
	await other.pending;
	assert.deepEqual(mine.themes, []);
	assert.equal(readState(own).look.accent, "teal");
	mine.emit("session_shutdown");
});

test("look-more S5 colors light: the menu cycles vivid, soft, light; everything Fisi Dock paints repaints light at once; Pi's theme becomes Fisi-Dock-Light once the menu closed, whatever the accent", async (t) => {
	const { lightPalette, fgCode, palette } = await import("../lib/palette.ts");
	const path = stateDir(t);
	seedState(path, { enabled: true, theme: "dark", themeApplied: true, look: { accent: "teal" } });
	class UserMessageComponent {
		children: unknown[] = [];
		render(width: number): string[] {
			return [" hola".padEnd(width)];
		}
	}
	const message = new UserMessageComponent();
	const pi = (width: number) => [" hola".padEnd(width)];
	const sim = simulate("E:\\DEV\\app", { ownsHost: () => true, theme: "Fisi-Dock-Teal" });
	Object.assign(sim.tui, { children: [{ children: [message] }] });
	sim.emit("session_start");
	sim.widgets.get("fisi-dock")!(sim.tui);
	const rail = sim.parts.get("footer") as Rail;
	const header = sim.parts.get("header") as { render(width: number): string[]; digest(): string };
	const before = { rail: rail.render(57), digest: rail.digest(), header: header.digest(), card: sim.startHeader.current?.render(100) ?? [] };
	assert.ok(before.rail.join("\n").includes(fgCode(palette.text)), "vivid paints today's text");

	const settings = await openSettings(sim);
	settings.view.handleInput?.(DOWN);
	settings.view.handleInput?.(DOWN);
	settings.view.handleInput?.(RIGHT);
	settings.view.handleInput?.(RIGHT);
	assert.match(plain(settings.view.render(60)[4]), /^ › colors +‹ light › *$/);
	assert.equal(readState(path).look.colors, "light", "saved at once");
	assert.notEqual(rail.digest(), before.digest, "Gentle Shell's rail memo sees the change");
	const lightRail = rail.render(57).join("\n");
	assert.ok(lightRail.includes(fgCode(lightPalette.text)) && !lightRail.includes(fgCode(palette.text)), "the rail repaints in the light palette");
	assert.notEqual(header.digest(), before.header, "the top row's memo sees the colors");
	assert.ok(header.render(60).join("").includes(fgCode(lightPalette.muted)), "the path in the light muted");
	assert.deepEqual(message.render(30), frameUserLines(pi, 30, "light", "faded", "teal"), "the user frame in light, `you` in the light teal");
	const card = sim.startHeader.current?.render(100) ?? [];
	assert.ok(card.join("").includes(fgCode(lightPalette.text)) && !card.join("").includes(fgCode(palette.text)), "the welcome card in light");
	assert.deepEqual(sim.themes, [], "no theme switch while the menu is open");
	settings.view.handleInput?.("\x1b");
	await settings.pending;
	assert.deepEqual(sim.themes, ["Fisi-Dock-Light"], "one switch, to the light theme, though the accent is teal");
	assert.equal(sim.ctx.ui.theme.name, "Fisi-Dock-Light");
	assert.deepEqual(readState(path), { enabled: true, theme: "dark", themeApplied: true, look: { logo: "braille", frames: "faded", colors: "light", accent: "teal", divider: "medium", motion: "on", sections: DEFAULT_SECTIONS } });

	// The accent row still saves in light, and the panel follows it, but the theme stays Fisi-Dock-Light.
	const accent = await openSettings(sim);
	for (let index = 0; index < 3; index++) accent.view.handleInput?.(DOWN);
	accent.view.handleInput?.(RIGHT);
	const lilacRail = rail.render(57);
	accent.view.handleInput?.("\x1b");
	await accent.pending;
	assert.equal(readState(path).look.accent, "lilac");
	assert.notDeepEqual(lilacRail.join("\n"), lightRail, "the panel's pink family follows the accent");
	assert.deepEqual(sim.themes, ["Fisi-Dock-Light"], "no switch: one light theme for every accent");

	// Off from Fisi-Dock-Light puts the user's theme back; on takes the light theme again and remembers nothing of Fisi Dock's.
	await fisiDockCommand(sim, "off");
	assert.equal(sim.ctx.ui.theme.name, "dark");
	await fisiDockCommand(sim, "on");
	assert.equal(sim.ctx.ui.theme.name, "Fisi-Dock-Light");
	assert.equal(readState(path).theme, "dark");

	// Light back to vivid: Fisi Dock's theme for the accent.
	const back = await openSettings(sim);
	back.view.handleInput?.(DOWN);
	back.view.handleInput?.(DOWN);
	back.view.handleInput?.(RIGHT);
	back.view.handleInput?.("\x1b");
	await back.pending;
	assert.equal(sim.ctx.ui.theme.name, "Fisi-Dock-Lilac");
	assert.equal(readState(path).look.colors, "vivid");
	sim.emit("session_shutdown");
});

test("look-more S4 every Fisi Dock theme counts as its own: on never remembers it, off restores the user's theme from it, and the first start applies the saved look's theme", async (t) => {
	const { FISI_DOCK_THEMES } = await import("../lib/look.ts");
	for (const name of FISI_DOCK_THEMES) {
		const path = stateDir(t);
		seedState(path, { enabled: false, theme: "light", themeApplied: true });
		const sim = simulate("E:\DEV\app", { ownsHost: () => true, theme: name });
		sim.emit("session_start");
		await fisiDockCommand(sim, "on");
		assert.equal(readState(path).theme, "light", `${name} is never remembered`);
		await fisiDockCommand(sim, "off");
		assert.equal(sim.ctx.ui.theme.name, "light", `off from ${name}`);
		sim.emit("session_shutdown");

		const fresh = stateDir(t);
		const start = simulate("E:\DEV\app", { ownsHost: () => true, theme: name });
		start.emit("session_start");
		assert.deepEqual(start.themes, [], `${name} in use at the first start: no switch`);
		assert.deepEqual(readState(fresh), { enabled: true, themeApplied: true }, `${name}: the step is done, nothing remembered`);
		start.emit("session_shutdown");
	}
	const first = stateDir(t);
	mkdirSync(join(first, ".."), { recursive: true });
	writeFileSync(first, JSON.stringify({ look: { accent: "lilac" } }));
	const start = simulate("E:\DEV\app", { ownsHost: () => true, theme: "dark" });
	start.emit("session_start");
	assert.deepEqual(start.themes, ["Fisi-Dock-Lilac"], "the first start applies the lilac theme");
	assert.deepEqual(readState(first), { look: { accent: "lilac" }, enabled: true, theme: "dark", themeApplied: true });
	start.emit("session_shutdown");
});
