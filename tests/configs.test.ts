import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import fisiDock from "../extensions/fisi-dock.ts";
import { renderLoadedBox } from "../lib/loaded-box.ts";
import { boxPromptRows, FRAME_COLUMNS, PROMPT_OWNER } from "../lib/prompt-box.ts";
import { renderPromptLine } from "../lib/prompt-line.ts";
import { SIDEBAR_CACHE, SIDEBAR_STATE } from "../lib/slot.ts";
import { ellipsize, truncateToWidth, visibleWidth } from "../lib/text.ts";
import { USER_FRAME_HOOK } from "../lib/user-frame.ts";
import { renderWelcomeCard } from "../lib/welcome-card.ts";

// S6: simulated user configurations (another language, no Engram, many MCP
// servers, Vim on, a 30-column screen, a remapped expand key), driven through
// the extension the way Pi and Gentle Shell call it, in memory. Every test points
// Pi's and Gentle Shell's dirs at a fresh temp folder, so the real home is never read.

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitFor(check: () => boolean): Promise<void> {
	for (let tries = 0; tries < 400 && !check(); tries++) await new Promise((resolve) => setTimeout(resolve, 5));
}

const ENV_KEYS = ["PI_CODING_AGENT_DIR", "GENTLE_PI_AGENT_HOME", "GENTLE_PI_CONFIG_HOME", "GENTLE_SHELL_CONFIG_HOME", "GENTLE_SHELL_PREFIX", "GENTLE_SHELL_CHILD_PACKAGE_INJECTION", "FISI_DOCK_ORBS"];

/**
 * A fresh home for one test: Pi's agent dir (with `files` in it, as JSON), the
 * project folder and Gentle Shell's dirs, all in a temp folder removed after the
 * test; the environment is put back as it was.
 */
function configHome(t: TestContext, files: Record<string, unknown> = {}): { agent: string; cwd: string } {
	const root = mkdtempSync(join(tmpdir(), "fisi-dock-configs-"));
	const agent = join(root, "agent");
	const cwd = join(root, "app");
	mkdirSync(agent);
	mkdirSync(cwd);
	for (const [name, content] of Object.entries(files)) writeFileSync(join(agent, name), JSON.stringify(content));
	const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
	process.env.PI_CODING_AGENT_DIR = agent;
	process.env.GENTLE_PI_AGENT_HOME = agent;
	process.env.GENTLE_PI_CONFIG_HOME = join(root, "gentle-ai");
	delete process.env.GENTLE_SHELL_CONFIG_HOME;
	delete process.env.GENTLE_SHELL_PREFIX;
	process.env.GENTLE_SHELL_CHILD_PACKAGE_INJECTION = JSON.stringify({ version: 1, noExtensions: true, extensionPaths: [join(root, "no-package")] });
	process.env.FISI_DOCK_ORBS = "off";
	t.after(() => {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(root, { recursive: true, force: true });
	});
	return { agent, cwd };
}

// --- Gentle Shell's editor (lib/shell-prompt.ts panelPromptRule, restated as tests/prompt-box.test.ts does) ---

interface PromptOptions {
	/** Gentle Shell's label: `waiting for input`, translated, or a working one. */
	label?: string;
	/** A working label: Gentle Shell's scan wraps each character on its own. */
	scan?: boolean;
	/** The vim mode (`INSERT`, `NORMAL`) or esc hint at the right end of the rule. */
	hint?: string;
	/** Narrow chrome: the `[ Panel ]` button before the hint. */
	button?: boolean;
}

const gsBorder = (text: string) => `\x1b[38;2;80;80;80m${text}\x1b[39m`;
const gsLabel = (text: string) => `\x1b[2m${text}\x1b[22m`;
const gsScan = (text: string) => Array.from(text, (char) => `\x1b[90m${char}\x1b[39m`).join("");
const PETAL = "\x1b[38;2;255;118;195m✿\x1b[39m";
const padTo = (text: string, width: number) => truncateToWidth(text, width) + " ".repeat(Math.max(0, width - visibleWidth(text)));

function gentleRule(width: number, { label = "waiting for input", hint, button, scan }: PromptOptions): string {
	const painted = scan ? gsScan(label) : gsLabel(label);
	if (button) {
		// Narrow fullscreen clips the label beside its button and hint (`waiti…`).
		const end = ` [ Panel ]${hint ? ` ${gsLabel(hint)}` : ""} ${gsBorder("─")}`;
		const room = width - 4 - visibleWidth(end);
		if (room < 2) return gsBorder("─".repeat(Math.max(0, width)));
		const shown = ellipsize(label, room);
		return `${gsBorder("─ ")}${PETAL} ${scan ? gsScan(shown) : gsLabel(shown)}${gsBorder("─".repeat(room - visibleWidth(shown)))}${end}`;
	}
	const end = hint ? ` ${gsLabel(hint)} ` : "";
	const fill = width - (2 + 1 + 1 + visibleWidth(label) + 1) - (hint ? visibleWidth(hint) + 2 : 0) - 1;
	if (fill < 1) return gsBorder("─".repeat(Math.max(0, width)));
	return `${gsBorder("─ ")}${PETAL} ${painted} ${gsBorder("─".repeat(fill))}${end}${gsBorder("─")}`;
}

/** Gentle Shell's marked editor factory; its rows never pass the width it is given. */
function gentleEditor(options: () => PromptOptions) {
	return Object.assign((_tui: unknown, _theme: unknown, _keys: unknown) => ({
		topRowCount: 0,
		render: (width: number) => [gentleRule(width, options()), padTo("› hola", width), " ".repeat(Math.max(0, width))],
		handleMouse: () => undefined,
	}), { [PROMPT_OWNER]: true });
}

// --- Pi and Gentle Shell in memory (the shape tests/extension.test.ts simulates) ---

type Exec = (command: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
type Render = { render(width: number): string[] };
type Overlay = Render & { handleInput?(data: string): void };
type Custom = { factory: (tui: unknown, theme: unknown, keys: unknown, done: (result: unknown) => void) => Overlay; closed: (result: unknown) => void };

/** Git with one edited file, so the strip and the changes section have something to show. */
const GIT: Record<string, string> = {
	"rev-parse --abbrev-ref HEAD": "main\n",
	"status --porcelain=v1 -z": " M lib/a.ts\0",
	"diff --numstat -z HEAD": "3\t1\tlib/a.ts\0",
};
const gitExec: Exec = async (command, args) => {
	const stdout = command === "git" ? GIT[args.join(" ")] : undefined;
	return stdout === undefined ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout, stderr: "" };
};

interface SimOptions {
	/** False: plain Pi, no Gentle Shell sidebar state on the terminal. */
	gentle?: boolean;
	/** The wide rail owns the screen; false is narrow fullscreen (phone). */
	wide?: () => boolean;
	tools?: () => unknown[];
	/** Gentle Shell's permission mode, answered over gentle:yolo:host-ui. */
	mode?: string;
	/** Gentle Shell's editor label and hint, read per frame; undefined: no Gentle Shell editor. */
	prompt?: () => PromptOptions;
}

function simulate(cwd: string, options: SimOptions = {}) {
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => void)[]>();
	const channels = new Map<string, ((data: unknown) => void)[]>();
	const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> | void }>();
	const widgets = new Map<string, ((tui: unknown) => Render) | undefined>();
	const customs: Custom[] = [];
	let editorFactory: unknown = options.prompt ? gentleEditor(options.prompt) : undefined;
	const startHeader: { current?: Render & { dispose?(): void } } = {};
	const pi = {
		registerCommand: (name: string, command: { handler(args: string, ctx: unknown): Promise<void> | void }) => commands.set(name, command),
		on: (name: string, handler: (event: unknown, ctx: unknown) => void) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		events: {
			on: (channel: string, handler: (data: unknown) => void) => {
				channels.set(channel, [...(channels.get(channel) ?? []), handler]);
				return () => channels.set(channel, (channels.get(channel) ?? []).filter((other) => other !== handler));
			},
			emit: (channel: string, data: unknown) => {
				for (const handler of channels.get(channel) ?? []) handler(data);
			},
		},
		exec: gitExec,
		getThinkingLevel: () => "high",
		getAllTools: options.tools ?? (() => []),
	};
	const parts = new Map<string, unknown>([
		["header", { render: () => ["✿ Gentle Shell ◇ path ◇ model"], invalidate() {} }],
		["footer", { render: () => ["status"], invalidate() {} }],
		...["todo", "jobs", "agents", "statusbar"].map((key) => [key, { render: () => [`gentle ${key}`], invalidate() {} }] as [string, unknown]),
	]);
	const terminal: Record<symbol, unknown> = options.gentle === false ? {} : { [SIDEBAR_STATE]: { active: true, parts, ownsHost: options.wide ?? (() => true) }, [SIDEBAR_CACHE]: { revision: 0 } };
	const tui: { terminal: Record<symbol, unknown>; children?: unknown[]; requestRender(): void } = { terminal, requestRender() {} };
	const ctx = {
		hasUI: true,
		cwd,
		model: { id: "claude-opus-5-5", reasoning: true },
		ui: {
			setWidget: (key: string, factory?: (tui: unknown) => Render) => void widgets.set(key, factory),
			custom: (factory: Custom["factory"]) => new Promise((resolve) => customs.push({ factory, closed: resolve })),
			notify() {},
			theme: { name: "dark" },
			getTheme: (name: string) => ({ name }),
			setTheme: () => ({ success: true }),
			select: async () => undefined,
			getEditorComponent: () => editorFactory,
			setEditorComponent: (factory: unknown) => void (editorFactory = factory),
			setHeader: (factory?: (tui: unknown, theme: unknown) => Render & { dispose?(): void }) => {
				const previous = startHeader.current;
				startHeader.current = undefined;
				previous?.dispose?.();
				startHeader.current = factory?.(tui, {});
			},
		},
		sessionManager: { getSessionId: () => "s1", getCwd: () => cwd, getEntries: () => [], getBranch: () => [] },
		getContextUsage: () => ({ tokens: 53_500, contextWindow: 1_000_000, percent: 5 }),
	};
	if (options.mode) {
		const mode = options.mode;
		channels.set("gentle:yolo:host-ui", [(payload) => (payload as { respond(adapter: unknown): void }).respond({
			readSnapshot: async () => ({ mode }),
			observe: () => () => {},
			dispose() {},
		})]);
	}
	fisiDock(pi as never);
	const emit = (name: string, event: unknown = {}) => {
		for (const handler of handlers.get(name) ?? []) handler(event, ctx);
	};
	const toolEnd = (toolName: string, isError = false) => emit("tool_execution_end", { type: "tool_execution_end", toolCallId: `c-${toolName}`, toolName, result: { content: [] }, isError });
	return { parts, widgets, commands, customs, startHeader, ctx, tui, emit, toolEnd, editor: () => editorFactory };
}
type Sim = ReturnType<typeof simulate>;

/** Pi's ExpandableText (interactive-mode.js): a collapsed and an expanded text by `state.expanded`. */
class PiSection extends Text {
	state = { expanded: false };
	build: () => string;
	constructor(collapsed: string, expanded: string) {
		super("", 0, 0);
		this.build = () => (this.state.expanded ? expanded : collapsed);
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

/** Pi's tree around the header slot: TUI > document > [header (spacer, card, spacer), loaded resources, chat]. */
function mountPi(sim: Sim): Container {
	const before = new Spacer(1);
	const after = new Spacer(1);
	const header = { get children() { return [before, sim.startHeader.current ?? { render: () => ["pi header"] }, after]; }, render: () => [] };
	const loaded = new Container();
	for (const [name, names] of [["Skills", "btw, go-testing, skill-creator"], ["Prompts", "/skill-creation"], ["Extensions", "fisi-dock.ts, gentle-ai.ts, gentle-engram.ts"]]) {
		loaded.addChild(new PiSection(`[${name}]\n  ${names}`, `[${name}]\n  user\n    ${names.split(", ").join("\n    ")}`));
		loaded.addChild(new Spacer(1));
	}
	sim.tui.children = [{ children: [header, loaded, new Container()], render: () => [] }];
	return loaded;
}

const KEYS = { matches: (data: string, id: string) => id === "tui.select.cancel" && data === "\x1b" };

/**
 * Starts the session and mounts every Fisi Dock surface, keyed by name, each a
 * render at a width: the welcome card, the loaded box under it, the rail panel,
 * the top row, the strip, the prompt box, the line under the prompt and /dock.
 */
async function start(sim: Sim) {
	sim.emit("session_start");
	const loaded = mountPi(sim);
	sim.startHeader.current?.render(100);
	sim.widgets.get("fisi-dock")?.(sim.tui);
	const strip = sim.widgets.get("fisi-dock-strip")?.(sim.tui);
	const line = sim.widgets.get("fisi-dock-prompt-line")?.(sim.tui);
	const factory = sim.editor() as ((tui: unknown, theme: unknown, keys: unknown) => Render) | undefined;
	const editor = factory?.(sim.tui, {}, {});
	const pending = sim.commands.get("dock")!.handler("", sim.ctx);
	await tick();
	const custom = sim.customs[0];
	const dock = custom?.factory(sim.tui, {}, KEYS, custom.closed);
	const part = (key: string) => (width: number) => (sim.parts.get(key) as Render).render(width);
	const surfaces: Record<string, (width: number) => string[]> = {
		"welcome card": (width) => sim.startHeader.current?.render(width) ?? [],
		"loaded box": (width) => loaded.render(width),
		"rail panel": part("footer"),
		"top row": part("header"),
		strip: (width) => strip?.render(width) ?? [],
		"prompt box": (width) => editor?.render(width) ?? [],
		"line under the prompt": (width) => line?.render(width) ?? [],
		"/dock": (width) => dock?.render(width) ?? [],
	};
	const stop = async () => {
		dock?.handleInput?.("\x1b");
		await pending;
		sim.emit("session_shutdown");
	};
	return { surfaces, loaded, stop };
}

/** Every surface at every width from 0 to 140: nothing throws and no line is wider than the width. */
function sweep(surfaces: Record<string, (width: number) => string[]>, why: string): void {
	for (const [name, render] of Object.entries(surfaces)) {
		for (let width = 0; width <= 140; width++) {
			let lines: string[] = [];
			assert.doesNotThrow(() => void (lines = render(width)), `${why}: ${name} at ${width}`);
			for (const line of lines) assert.ok(visibleWidth(line) <= width, `${why}: ${name} at ${width}: ${JSON.stringify(plain(line))}`);
		}
	}
}

const sessionRows = (lines: string[]) => {
	const shown = lines.map(plain);
	const start = shown.findIndex((line) => line.startsWith("╭─ session"));
	return shown.slice(start + 1, shown.findIndex((line, index) => index > start && line.startsWith("╰"))).map((line) => line.replace(/ +│$/, ""));
};
const rule = (rows: string[]) => plain(rows[0] ?? "");

// --- 1. another language -----------------------------------------------------

test("S6 another language: a translated idle label drops its words for the labels, a translated working label keeps them (prompt box)", async (t) => {
	const { cwd } = configHome(t);
	let prompt: PromptOptions = { label: "esperando entrada", button: true };
	const sim = simulate(cwd, { wide: () => false, mode: "super-yolo", prompt: () => prompt });
	const { surfaces, stop } = await start(sim);
	const box = surfaces["prompt box"];
	await waitFor(() => rule(box(45)).includes("SUPER-YOLO"));
	assert.equal(rule(box(45)), `╭─ ✿ ${"─".repeat(7)} ● SUPER-YOLO  opus-5.5 · high ─╮`, "idle: the petal keeps the labels");
	assert.equal(rule(box(70)), `╭─ ✿ esperando entrada ${"─".repeat(14)} ● SUPER-YOLO  opus-5.5 · high ─╮`, "room for both: its words stay");
	assert.deepEqual(surfaces["line under the prompt"](45), [], "the box carries the labels");

	prompt = { label: "trabajando…", scan: true, button: true };
	assert.equal(rule(box(45)), "╭─ ✿ trabajando… ─── ● SUPER-YOLO opus-5.5 ─╮", "working: its words stay, the labels compact");
	assert.equal(rule(box(34)), "╭─ ✿ trabajando… ─ ● SUPER-YOLO ─╮");
	sweep(surfaces, "trabajando…");
	prompt = { label: "esperando entrada", button: true };
	sweep(surfaces, "esperando entrada");
	await stop();
});

// --- 2. no Engram ------------------------------------------------------------

test("S6 without Engram the memory row says not installed; with its tools a failed call reads unreachable and a later success recovers", async (t) => {
	const { cwd } = configHome(t);
	const tools: { name: string }[] = [{ name: "read" }, { name: "bash" }];
	const sim = simulate(cwd, { tools: () => tools });
	const { surfaces, stop } = await start(sim);
	const memory = () => sessionRows(surfaces["rail panel"](47)).find((line) => line.startsWith("│ memory"));
	await waitFor(() => sessionRows(surfaces["rail panel"](47)).some((line) => line.startsWith("│ mcp")));
	assert.equal(memory(), "│ memory   ○ engram  not installed");
	sim.toolEnd("mem_save", true);
	assert.equal(memory(), "│ memory   ○ engram  not installed", "a mem_* call without the tools loaded changes nothing drawn");
	sweep(surfaces, "no Engram");

	tools.push({ name: "mem_save" }, { name: "mem_search" });
	sim.emit("turn_end");
	assert.equal(memory(), "│ memory   ✗ engram  unreachable", "the earlier failed call counts once the tools exist");
	sim.toolEnd("mem_search");
	assert.equal(memory(), "│ memory   ● engram  connected · 0 saved", "a later success: connected again");
	sim.toolEnd("mem_save");
	assert.equal(memory(), "│ memory   ● engram  connected · 1 saved");
	sim.toolEnd("mem_save", true);
	assert.equal(memory(), "│ memory   ✗ engram  unreachable");
	sweep(surfaces, "Engram unreachable");
	await stop();
});

// --- 3. many MCP servers -----------------------------------------------------

const SERVERS = Array.from({ length: 10 }, (_, index) => `server-${index}`);
const mcpTool = (server: string) => ({ name: `mcp__${server.replace(/-/g, "_")}__ping`, description: "", parameters: {}, exposure: "deferred" });

test("S6 ten MCP servers in Pi's mcp.json: the rail caps them with a summary row, /dock and the narrow top row show all ten", async (t) => {
	const { cwd } = configHome(t, { "mcp.json": { mcpServers: Object.fromEntries(SERVERS.map((name) => [name, { command: name }])) } });
	const tools = SERVERS.slice(0, 7).map(mcpTool);
	let wide = true;
	const sim = simulate(cwd, { tools: () => tools, wide: () => wide });
	const { surfaces, stop } = await start(sim);
	const connections = (lines: string[]) => {
		const rows = sessionRows(lines);
		return rows.slice(rows.findIndex((line) => line.startsWith("│ connections")) + 1);
	};
	await waitFor(() => connections(surfaces["rail panel"](58)).some((line) => line.startsWith("│ mcp")));
	assert.deepEqual(connections(surfaces["rail panel"](58)), [
		"│ memory   ○ engram    not installed",
		"│ mcp      ◌ server-7  connecting",
		"│          ◌ server-8  connecting",
		"│          ◌ server-9  connecting",
		"│            +7 more · 7 connected",
	], "problems first, the rest summed up");
	assert.deepEqual(connections(surfaces["rail panel"](34)).at(-1), "│            +7 more", "the counts drop on the 34-column rail");

	const dock = surfaces["/dock"](64).map(plain);
	for (const name of SERVERS) assert.ok(dock.some((line) => new RegExp(`[●◌✗] ${name} `).test(line)), `/dock lists ${name}`);
	assert.ok(!dock.some((line) => line.includes("more ·")), "/dock has no summary row");

	wide = false;
	const top = plain(surfaces["top row"](80)[0]);
	assert.match(top, /●{10}$/, `one dot per server: ${top}`);
	sweep(surfaces, "10 MCP servers, narrow");
	wide = true;
	sweep(surfaces, "10 MCP servers, wide");
	await stop();
});

// --- 4. Vim on ---------------------------------------------------------------

test("S6 Vim on: Gentle Shell's INSERT/NORMAL hint stays beside the labels by the ladder and the rule never passes the width", async (t) => {
	const { cwd } = configHome(t);
	let prompt: PromptOptions = { hint: "INSERT", button: true };
	const sim = simulate(cwd, { wide: () => false, mode: "super-yolo", prompt: () => prompt });
	const { surfaces, stop } = await start(sim);
	const box = surfaces["prompt box"];
	await waitFor(() => rule(box(50)).includes("SUPER-YOLO"));
	// Idle: the labels beat the hint; the label's words drop first.
	assert.equal(rule(box(50)), `╭─ ✿ ${"─".repeat(4)} ● SUPER-YOLO  opus-5.5 · high  INSERT ─╮`);
	assert.equal(rule(box(45)), `╭─ ✿ ${"─".repeat(7)} ● SUPER-YOLO  opus-5.5 · high ─╮`, "the hint drops before the labels");
	// Working: the hint beats our labels, which compact beside it.
	prompt = { label: "working…", scan: true, hint: "INSERT", button: true };
	assert.equal(rule(box(56)), "╭─ ✿ working… ─ ● SUPER-YOLO  opus-5.5 · high  INSERT ─╮");
	assert.equal(rule(box(55)), "╭─ ✿ working… ─── ● SUPER-YOLO opus-5.5·high  INSERT ─╮");
	assert.equal(rule(box(50)), "╭─ ✿ working… ─── ● SUPER-YOLO opus-5.5  INSERT ─╮");
	assert.equal(rule(box(45)), `╭─ ✿ working… ${"─".repeat(7)} ● SUPER-YOLO  INSERT ─╮`);
	assert.equal(rule(box(38)), `╭─ ✿ working… ${"─".repeat(14)} INSERT ─╮`);
	for (const hint of ["INSERT", "NORMAL"]) {
		for (const working of [false, true]) {
			prompt = working ? { label: "working…", scan: true, hint, button: true } : { hint, button: true };
			for (let width = 20; width <= 140; width++) {
				const top = rule(box(width));
				assert.equal(visibleWidth(top), width, `${hint} ${working ? "working" : "idle"} at ${width}: ${top}`);
				// Too tight for Gentle Shell's own label and hint it paints dashes only: not its panel rule, so not boxed.
				if (plain(gentleRule(width - FRAME_COLUMNS, prompt)).startsWith("─ ✿ ")) assert.ok(top.startsWith("╭─ ✿ ") && top.endsWith("─╮"), `boxed at ${width}: ${top}`);
				if (width >= 56) assert.ok(top.includes(hint) && top.includes("SUPER-YOLO"), `room for both at ${width}: ${top}`);
			}
		}
	}
	prompt = { hint: "NORMAL", button: true };
	sweep(surfaces, "vim NORMAL");
	await stop();
});

// --- 5. a 30-column screen ---------------------------------------------------

test("S6 a 30-column screen: every Fisi Dock surface fits, nothing throws, and each one with content shows it", async (t) => {
	const { cwd } = configHome(t);
	const sim = simulate(cwd, { wide: () => false, mode: "super-yolo", prompt: () => ({ button: true, hint: "INSERT" }) });
	const { surfaces, stop } = await start(sim);
	await waitFor(() => plain(surfaces["top row"](30)[0] ?? "").includes("main") && plain(surfaces.strip(30)[0] ?? "").includes("±"));
	await waitFor(() => rule(surfaces["prompt box"](30)).includes("SUPER-YOLO"));
	const at30 = Object.fromEntries(Object.entries(surfaces).map(([name, render]) => [name, render(30).map(plain)]));
	for (const [name, lines] of Object.entries(at30)) for (const line of lines) assert.ok(visibleWidth(line) <= 30, `${name}: ${JSON.stringify(line)}`);
	assert.deepEqual(at30["welcome card"], ["Gentle Shell    with Fisi Dock", "Ready in app on main."], "under 34 columns: the title and ready lines");
	assert.deepEqual(at30["loaded box"].slice(0, 3), ["skills      3  btw, go-testin…", "prompts     1  /skill-creation", "extensions  3  fisi-dock.ts, …"], "rows without a frame");
	assert.ok(at30["rail panel"].some((line) => line.includes("session")), "the panel draws its sections");
	assert.equal(at30["top row"][0], " app · main  ▰▱▱▱ 5%  $0.000");
	assert.equal(at30.strip[0], "  ±1 file");
	assert.equal(at30["prompt box"][0], `╭─ ✿ ${"─".repeat(9)} ● SUPER-YOLO ─╮`);
	assert.deepEqual(at30["prompt box"].slice(1), [`│ › hola${" ".repeat(20)} │`, `╰${"─".repeat(28)}╯`]);
	assert.deepEqual(at30["line under the prompt"], [], "the box carries the labels");
	assert.equal(at30["/dock"].length, 36, "the whole overlay height");
	assert.ok(at30["/dock"].some((line) => line.includes("session")) && /Esc to close/.test(at30["/dock"].at(-1)!));
	await stop();

	// Without Gentle Shell's editor the line under the prompt is the fallback, also at 30.
	const bare = simulate(cwd, { wide: () => false, mode: "super-yolo" });
	const fallback = await start(bare);
	await waitFor(() => plain(fallback.surfaces["line under the prompt"](30)[0] ?? "").includes("SUPER-YOLO"));
	assert.deepEqual(fallback.surfaces["line under the prompt"](30).map(plain), [" SUPER-YOLO · opus-5.5 · high "]);
	assert.deepEqual(fallback.surfaces["line under the prompt"](20).map(plain), ["SUPER-YOLO·opus-5.5 "]);
	sweep(fallback.surfaces, "no Gentle Shell editor");
	await fallback.stop();
});

// --- 6. a remapped expand key ------------------------------------------------

test("S6 a remapped expand key in Pi's keybindings.json names that key on the loaded box", async (t) => {
	const remapped = configHome(t, { "keybindings.json": { "app.tools.expand": "ctrl+e" } });
	const sim = simulate(remapped.cwd);
	const first = await start(sim);
	const box = first.surfaces["loaded box"](100).map((line) => plain(line).trim());
	assert.equal(box[0].slice(0, 9), "╭─ loaded");
	assert.ok(box.includes(`╰${"─".repeat(41)} ctrl+e lists them ─╯`), box.join("\n"));
	assert.ok(!box.join("\n").includes("ctrl+o"), "never Pi's default when remapped");
	sweep(first.surfaces, "ctrl+e");
	await first.stop();
});

test("S6 an expand key bound to nothing in Pi's keybindings.json leaves the loaded box without a hint", async (t) => {
	const unbound = configHome(t, { "keybindings.json": { "app.tools.expand": [] } });
	const other = simulate(unbound.cwd);
	const second = await start(other);
	const plainBox = second.surfaces["loaded box"](100).map((line) => plain(line).trim());
	assert.ok(plainBox.includes(`╰${"─".repeat(61)}╯`), plainBox.join("\n"));
	assert.ok(!plainBox.join("\n").includes("lists them"), "a key bound to nothing: no hint");
	sweep(second.surfaces, "unbound");
	await second.stop();
});

// --- all at once -------------------------------------------------------------

test("S6 every configuration at once (Spanish, no Engram, 10 MCP servers, Vim, ctrl+e), wide and narrow, at every width from 0 to 140", async (t) => {
	const { cwd } = configHome(t, {
		"mcp.json": { mcpServers: Object.fromEntries(SERVERS.map((name) => [name, { command: name }])) },
		"keybindings.json": { "app.tools.expand": "ctrl+e" },
	});
	let wide = false;
	let prompt: PromptOptions = { label: "esperando entrada", hint: "INSERT", button: true };
	const sim = simulate(cwd, { wide: () => wide, mode: "super-yolo", tools: () => SERVERS.slice(3).map(mcpTool), prompt: () => prompt });
	const { surfaces, stop } = await start(sim);
	await waitFor(() => sessionRows(surfaces["rail panel"](47)).some((line) => line.includes("more")));
	await waitFor(() => rule(surfaces["prompt box"](50)).includes("SUPER-YOLO"));
	assert.ok(sessionRows(surfaces["rail panel"](47)).includes("│ memory   ○ engram    not installed"));
	assert.ok(surfaces["loaded box"](100).some((line) => plain(line).includes("ctrl+e lists them")));
	assert.equal(rule(surfaces["prompt box"](50)), `╭─ ✿ ${"─".repeat(4)} ● SUPER-YOLO  opus-5.5 · high  INSERT ─╮`);
	for (const next of [{ label: "esperando entrada", hint: "INSERT", button: true }, { label: "trabajando…", scan: true, hint: "NORMAL", button: true }]) {
		prompt = next;
		for (const shape of [false, true]) {
			wide = shape;
			sweep(surfaces, `${prompt.label} ${wide ? "wide" : "narrow"}`);
		}
	}
	await stop();
});

// --- no Gentle Shell ---------------------------------------------------------

test("S6 without Gentle Shell (no sidebar state) Fisi Dock paints none of its rail, strip, prompt or message surfaces and never throws", async (t) => {
	const { cwd } = configHome(t, { "mcp.json": { mcpServers: { a: {} } } });
	const piEditor = (_tui: unknown, _theme: unknown, _keys: unknown) => ({ render: (width: number) => ["─".repeat(width)] });
	const sim = simulate(cwd, { gentle: false, mode: "super-yolo" });
	sim.ctx.ui.setEditorComponent(piEditor);
	const { surfaces, stop } = await start(sim);
	await tick();
	sim.emit("turn_end");
	assert.equal(sim.editor(), piEditor, "Pi's own editor is never wrapped");
	assert.equal(sim.parts.get("footer") !== undefined && (sim.parts.get("footer") as Render).render(47)[0], "status", "the rail parts stay Gentle Shell's");
	const widget = sim.widgets.get("fisi-dock")!(sim.tui);
	for (const width of [0, 1, 30, 47, 80, 140]) {
		assert.deepEqual(surfaces.strip(width), [], `strip at ${width}`);
		assert.deepEqual(surfaces["line under the prompt"](width), [], `line under the prompt at ${width}`);
		assert.deepEqual(widget.render(width), [], `widget at ${width}`);
		const frame = (globalThis as Record<symbol, unknown>)[USER_FRAME_HOOK] as (render: (width: number) => string[], width: number) => string[];
		assert.deepEqual(frame(() => ["hola"], width), ["hola"], `your messages as Pi draws them at ${width}`);
	}
	// The rail parts and the top row stay Gentle Shell's own: only Fisi Dock's surfaces are swept.
	const { "rail panel": _rail, "top row": _top, ...own } = surfaces;
	sweep(own, "no Gentle Shell");
	await stop();
});

// --- the pure renderers under the same configurations -------------------------

test("S6 the pure renderers keep every configuration within the width from 0 to 140", () => {
	const labels = [{ mode: "super-yolo", modelId: "claude-opus-5-5", effort: "high" }, { modelId: "claude-opus-5-5", effort: "high" }, {}];
	const prompts: PromptOptions[] = [
		{ label: "esperando entrada" },
		{ label: "trabajando…", scan: true },
		{ label: "esperando entrada", hint: "INSERT", button: true },
		{ label: "trabajando…", scan: true, hint: "NORMAL", button: true },
		{ label: "implementing…", hint: "esc again to cancel" },
	];
	const kinds = [{ label: "skills", names: Array.from({ length: 30 }, (_, index) => `skill-${index}`) }, { label: "extensions", names: ["fisi-dock.ts"] }];
	for (let width = 0; width <= 140; width++) {
		for (const model of labels) {
			for (const line of renderPromptLine(model, width)) assert.ok(visibleWidth(line) <= width, `prompt line ${width}`);
			for (const options of prompts) {
				const rows = [gentleRule(width - FRAME_COLUMNS, options), padTo("› hola", width - FRAME_COLUMNS), " ".repeat(Math.max(0, width - FRAME_COLUMNS))];
				const box = boxPromptRows(rows, width, 0, model);
				if (box.boxed) for (const row of box.rows) assert.equal(visibleWidth(row), width, `box ${width} ${JSON.stringify(options)}: ${plain(row)}`);
			}
		}
		for (const key of ["ctrl+o", "ctrl+e", "ctrl+e/alt+o", ""]) for (const line of renderLoadedBox(kinds, width, key)) assert.ok(visibleWidth(line) <= width, `loaded box ${width} ${key}`);
		for (const line of renderWelcomeCard({ version: "4.6.0-main", project: "un-proyecto-con-nombre-largo", branch: "feat/robustez" }, width)) assert.ok(visibleWidth(line) <= width, `welcome card ${width}`);
	}
});
