import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Container, Key, Spacer, Text } from "@earendil-works/pi-tui";
import { installLoadedBox, loadedKind, piKeybindingsPath, readExpandKey, renderLoadedBox, type LoadedKind } from "../lib/loaded-box.ts";
import { visibleWidth } from "../lib/text.ts";

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

// The lists of the artboard (design/start-screen/02-loaded-box.html), in Pi's order.
const SKILLS = "btw, chained-pr, cognitive-doc-design, gentle-ai, gentle-ai-branch-pr, gentle-ai-chained-pr, gentle-ai-cognitive-doc-design, gentle-ai-comment-writer, gentle-ai-issue-creation, gentle-ai-judgment-day, gentle-ai-rdd-defect-workflow, gentle-ai-skill-creator, gentle-ai-skill-improver, gentle-ai-skill-registry, gentle-ai-work-unit-commits, gentle-design, gentle-ui-design, go-testing, judgment-day, reverse-engineer-anything, skill-creator, skill-improver, skill-registry, work-unit-commits".split(", ");
const PROMPTS = ["/skill-creation"];
const EXTENSIONS = "@gtrabanco/pi-nan-provider:src, ask-user-choice.ts, ask-user-question.ts, child-context.ts, child-safety.ts, codegraph-tools.ts, fisi-dock.ts, gentle-agents.ts, gentle-ai.ts, gentle-design.ts, gentle-herdr-activity.ts, gentle-music.ts, gentle-notifications.ts, gentle-shell.ts, gentle-stats.ts, gentle-todo.ts, gentle-voice.ts, cwd.ts, history.ts, moshi-hooks.ts".split(", ");
const KINDS: LoadedKind[] = [
	{ label: "skills", names: SKILLS },
	{ label: "prompts", names: PROMPTS },
	{ label: "extensions", names: EXTENSIONS },
];

test("S1 the loaded box at 100 columns: the card's 63-column frame, centered, `loaded` on the top rule, counts aligned, names cut, the hint on the bottom rule", () => {
	const indent = " ".repeat(18);
	assert.deepEqual(renderLoadedBox(KINDS, 100).map(plain), [
		`${indent}╭─ loaded ────────────────────────────────────────────────────╮`,
		`${indent}│  skills      24  btw, chained-pr, cognitive-doc-design, g…  │`,
		`${indent}│  prompts      1  /skill-creation                            │`,
		`${indent}│  extensions  20  @gtrabanco/pi-nan-provider:src, ask-user…  │`,
		`${indent}╰───────────────────────────────────────── ctrl+o lists them ─╯`,
	]);
});

test("S1 the box paints with the card's palette roles: gray frame, muted kinds, title and hint, text counts", () => {
	const [top, row, , , bottom] = renderLoadedBox(KINDS, 63);
	const frame = "\x1b[38;2;69;69;69m";
	const muted = "\x1b[38;2;108;108;108m";
	const text = "\x1b[38;2;225;225;225m";
	assert.ok(top.startsWith(`${frame}╭─ `) && top.includes(`${muted}loaded`), JSON.stringify(top));
	assert.ok(row.startsWith(`${frame}│`) && row.includes(`${muted}skills    `) && row.includes(`${text}24`), JSON.stringify(row));
	assert.ok(bottom.includes(`${muted} ctrl+o lists them `), JSON.stringify(bottom));
});

test("S1 at 50 columns the box shrinks with the card and fewer names fit", () => {
	assert.deepEqual(renderLoadedBox(KINDS, 50).map(plain), [
		"╭─ loaded ───────────────────────────────────────╮",
		"│  skills      24  btw, chained-pr, cognitive-…  │",
		"│  prompts      1  /skill-creation               │",
		"│  extensions  20  @gtrabanco/pi-nan-provider:…  │",
		"╰──────────────────────────── ctrl+o lists them ─╯",
	]);
});

test("S1 under the card's 34-column minimum the rows print without a frame or hint", () => {
	assert.deepEqual(renderLoadedBox(KINDS, 30).map(plain), ["skills      24  btw, chained-…", "prompts      1  /skill-creati…", "extensions  20  @gtrabanco/pi…"]);
	assert.ok(renderLoadedBox(KINDS, 34).map(plain)[0].startsWith("╭─ loaded "), "34 columns still has the frame");
	assert.ok(renderLoadedBox(KINDS, 33).every((line) => !/[╭│╰]/.test(plain(line))), "33 columns has none");
});

test("S1 a kind with nothing loaded is left out; the labels pad to the longest one shown; nothing loaded draws nothing", () => {
	const lines = renderLoadedBox([{ label: "skills", names: [] }, { label: "prompts", names: ["/a", "/b"] }, { label: "extensions", names: [] }], 63).map(plain);
	assert.deepEqual(lines.slice(1, -1), [`│  prompts  2  /a, /b${" ".repeat(57 - 18)}  │`]);
	assert.deepEqual(renderLoadedBox([{ label: "skills", names: [] }], 100), []);
	assert.deepEqual(renderLoadedBox([], 100), []);
});

test("S1 the hint names the key the expand toggle is bound to, and goes when it has none", () => {
	assert.ok(plain(renderLoadedBox(KINDS, 63, "ctrl+shift+o").at(-1)!).endsWith("─ ctrl+shift+o lists them ─╯"));
	assert.equal(plain(renderLoadedBox(KINDS, 63, "").at(-1)!), `╰${"─".repeat(61)}╯`);
});

test("S1 every line fits its width, from 0 to 140 columns", () => {
	const long: LoadedKind[] = [...KINDS, { label: "context", names: ["~/a-really-long-folder-name/that-keeps-going/AGENTS.md"] }];
	for (let width = 0; width <= 140; width++) {
		for (const line of renderLoadedBox(long, width)) assert.ok(visibleWidth(line) <= width, `width ${width}: ${plain(line)}`);
	}
	assert.deepEqual(renderLoadedBox(KINDS, 0), []);
});

test("S1 a collapsed Pi section reads as its kind and names; anything without a [Name] header does not", () => {
	const dim = (value: string) => `\x1b[38;2;102;102;102m${value}\x1b[39m`;
	assert.deepEqual(loadedKind(`\x1b[1m[Skills]\x1b[22m\n${dim("  btw, chained-pr, go-testing")}`), { label: "skills", names: ["btw", "chained-pr", "go-testing"] });
	assert.deepEqual(loadedKind("[Prompts]\n  /skill-creation"), { label: "prompts", names: ["/skill-creation"] });
	assert.equal(loadedKind("  btw, chained-pr"), undefined);
	assert.equal(loadedKind(""), undefined);
});

// --- Pi's loaded-resources container under the welcome card -----------------

/** Pi's ExpandableText (interactive-mode.js): a ThemedText whose build follows `state.expanded`. */
class Section extends Text {
	state: { expanded: boolean };
	build: () => string;
	constructor(collapsed: () => string, expanded: () => string, isExpanded = false) {
		super("", 0, 0);
		const state = { expanded: isExpanded };
		this.state = state;
		this.build = () => (state.expanded ? expanded() : collapsed());
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
/** Pi's ThemedText: the warning sections. */
class Themed extends Text {
	build: () => string;
	constructor(build: () => string) {
		super("", 0, 0);
		this.build = build;
	}
	override render(width: number): string[] {
		this.setText(this.build());
		return super.render(width);
	}
}

/** Pi's showLoadedResources: clear, then each section followed by a Spacer(1), then the warnings. */
function showLoadedResources(container: Container, lists: Record<string, string[]>, options: { expanded?: boolean; warning?: boolean } = {}) {
	container.clear();
	for (const [name, names] of Object.entries(lists)) {
		container.addChild(new Section(() => `[${name}]\n  ${names.join(", ")}`, () => `[${name}]\n  user\n    ${names.join("\n    ")}`, options.expanded));
		container.addChild(new Spacer(1));
	}
	if (options.warning) {
		container.addChild(new Themed(() => "[Skill warnings]\n  duplicate skill name: skill-creator"));
		container.addChild(new Spacer(1));
	}
}

/**
 * Pi's tree: TUI > document > [header (spacer, card, spacer), loaded resources, chat], and the
 * editor with Pi's keybindings (`null`: an editor without them, as a custom editor may be).
 */
function piTree(keys: string[] | null = ["ctrl+o"]) {
	const card = { render: () => ["card"], invalidate() {} };
	const header = new Container();
	header.addChild(new Spacer(1));
	header.addChild(card);
	header.addChild(new Spacer(1));
	const loaded = new Container();
	const chat = new Container();
	const document = new Container();
	for (const child of [header, loaded, chat]) document.addChild(child);
	const editor = { ...(keys ? { keybindings: { getKeys: (id: string) => (id === "app.tools.expand" ? keys : []) } } : {}), render: () => [], invalidate() {} };
	const editorContainer = new Container();
	editorContainer.addChild(editor);
	return { tui: { children: [document, editorContainer], requestRender() {} }, card, loaded, chat };
}

const LISTS = { Skills: SKILLS, Prompts: PROMPTS, Extensions: EXTENSIONS };
const piLines = (container: Container, width: number) => Container.prototype.render.call(container, width).map((line) => plain(line).trimEnd());
const shown = (container: Container, width: number) => container.render(width).map((line) => plain(line).trimEnd());

test("S1 S2 the box takes the listing's place in Pi's container; the warning stays under it as Pi prints it", () => {
	const pi = piTree();
	showLoadedResources(pi.loaded, LISTS, { warning: true });
	const restore = installLoadedBox(pi.tui, pi.card, { active: () => true });
	assert.equal(typeof restore, "function");
	assert.deepEqual(shown(pi.loaded, 100), [...renderLoadedBox(KINDS, 100).map((line) => plain(line).trimEnd()), "", "[Skill warnings]", "  duplicate skill name: skill-creator", ""]);
	restore!();
});

test("S1 the box follows Pi refilling the container (reload, settings) and reads the current sections each render", () => {
	const pi = piTree();
	showLoadedResources(pi.loaded, LISTS);
	const restore = installLoadedBox(pi.tui, pi.card, { active: () => true })!;
	showLoadedResources(pi.loaded, { Skills: ["only-one"] });
	const lines = shown(pi.loaded, 63);
	assert.deepEqual(lines.slice(1, -2), [`│  skills  1  only-one${" ".repeat(57 - 19)}  │`]);
	assert.equal(lines.at(-1), "", "one blank row under the box, where Pi's spacer was");
	restore();
});

test("S3 with Pi's expand toggle on (the sections expanded) Pi's full listing shows instead of the box", () => {
	const pi = piTree();
	showLoadedResources(pi.loaded, LISTS, { warning: true });
	const restore = installLoadedBox(pi.tui, pi.card, { active: () => true })!;
	for (const child of pi.loaded.children) (child as Partial<Section>).setExpanded?.(true);
	assert.deepEqual(shown(pi.loaded, 100), piLines(pi.loaded, 100));
	assert.ok(shown(pi.loaded, 100).includes("[Skills]"));
	for (const child of pi.loaded.children) (child as Partial<Section>).setExpanded?.(false);
	assert.ok(shown(pi.loaded, 100)[0].includes("╭─ loaded "), "collapsed again: the box is back");
	restore();
});

test("S4 while the card is not installed (inactive) Pi's listing shows", () => {
	const pi = piTree();
	showLoadedResources(pi.loaded, LISTS);
	let active = false;
	const restore = installLoadedBox(pi.tui, pi.card, { active: () => active })!;
	assert.deepEqual(shown(pi.loaded, 100), piLines(pi.loaded, 100));
	active = true;
	assert.ok(shown(pi.loaded, 100)[0].includes("╭─ loaded "));
	restore();
});

test("S4 S5 restore gives the container Pi's own render back; only the instance is ever patched, never Container.prototype", () => {
	const pi = piTree();
	const prototypeRender = Container.prototype.render;
	showLoadedResources(pi.loaded, LISTS);
	const restore = installLoadedBox(pi.tui, pi.card, { active: () => true })!;
	assert.equal(Container.prototype.render, prototypeRender);
	assert.ok(Object.hasOwn(pi.loaded, "render"), "patched on the instance");
	assert.ok(!Object.hasOwn(pi.chat, "render"), "the chat container is left alone");
	restore();
	assert.equal(Container.prototype.render, prototypeRender);
	assert.ok(!Object.hasOwn(pi.loaded, "render"), "nothing of ours left on the instance");
	assert.deepEqual(Object.getOwnPropertySymbols(pi.loaded), []);
	assert.deepEqual(shown(pi.loaded, 100), piLines(pi.loaded, 100));
	restore();
	assert.deepEqual(shown(pi.loaded, 100), piLines(pi.loaded, 100), "a second restore changes nothing");
});

test("S4 an unrecognized shape leaves Pi's output as it is and never throws", () => {
	// No header holding the card: nothing to patch.
	const bare = piTree();
	assert.equal(installLoadedBox({ children: [] }, bare.card, { active: () => true }), undefined);
	assert.equal(installLoadedBox(undefined, bare.card, { active: () => true }), undefined);
	assert.equal(installLoadedBox({ children: [{ children: [bare.card] }] }, bare.card, { active: () => true }), undefined, "the header has no sibling after it");
	// A child of a shape Pi's listing never has, or a section without a [Name] header: Pi's lines.
	const pi = piTree();
	const restore = installLoadedBox(pi.tui, pi.card, { active: () => true })!;
	showLoadedResources(pi.loaded, LISTS);
	pi.loaded.addChild({ render: () => ["something else"], invalidate() {} } as never);
	assert.deepEqual(shown(pi.loaded, 100), piLines(pi.loaded, 100));
	showLoadedResources(pi.loaded, {});
	pi.loaded.addChild(new Section(() => "no header here", () => "no header here"));
	assert.deepEqual(shown(pi.loaded, 100), piLines(pi.loaded, 100));
	showLoadedResources(pi.loaded, {});
	assert.deepEqual(shown(pi.loaded, 100), [], "an empty container stays empty");
	restore();
});

test("S1 the hint names the key Pi's keybindings bind to app.tools.expand", () => {
	const pi = piTree(["ctrl+e"]);
	showLoadedResources(pi.loaded, LISTS);
	const restore = installLoadedBox(pi.tui, pi.card, { active: () => true })!;
	assert.ok(shown(pi.loaded, 63)[4].endsWith(" ctrl+e lists them ─╯"));
	restore();
});

// --- Pi's keybindings file, when the tree holds no keybindings ---------------

const KEYBINDINGS = join(import.meta.dirname, "fixtures", "keybindings");
const fixture = (name: string) => join(KEYBINDINGS, name, "keybindings.json");

/** The bottom rule of the box at 63 columns for a tree without keybindings and Pi's keybindings file at `keybindingsPath`. */
function bottomRule(keybindingsPath: string, keys: string[] | null = null): string {
	const pi = piTree(keys);
	showLoadedResources(pi.loaded, LISTS);
	const restore = installLoadedBox(pi.tui, pi.card, { active: () => true, keybindingsPath })!;
	const lines = shown(pi.loaded, 63);
	restore();
	return lines[4];
}
const PLAIN_RULE = `╰${"─".repeat(61)}╯`;

test("S4 without keybindings in the tree, the hint names the key the user's keybindings.json binds to app.tools.expand", () => {
	assert.ok(bottomRule(fixture("remapped")).endsWith("─ ctrl+e lists them ─╯"), bottomRule(fixture("remapped")));
	assert.ok(bottomRule(fixture("bom")).endsWith("─ ctrl+e lists them ─╯"), "a file with a byte order mark, as Pi strips it");
});

test("S4 the legacy id expandTools counts as app.tools.expand, and app.tools.expand wins when both are set, as Pi migrates them", () => {
	assert.ok(bottomRule(fixture("legacy")).endsWith("─ ctrl+shift+e lists them ─╯"), bottomRule(fixture("legacy")));
	assert.ok(bottomRule(fixture("legacy-and-new")).endsWith("─ alt+o lists them ─╯"), bottomRule(fixture("legacy-and-new")));
});

test("S4 a list of keys names each once, joined with `/`", () => {
	assert.ok(bottomRule(fixture("two-keys")).endsWith("─ ctrl+e/alt+o lists them ─╯"), bottomRule(fixture("two-keys")));
});

test("S4 app.tools.expand set to an empty list (unbound) drops the hint: the rule is plain", () => {
	assert.equal(bottomRule(fixture("unbound")), PLAIN_RULE);
});

test("S4 with no override Pi's default ctrl+o shows: no file, malformed JSON, another binding only, or a value Pi rejects", () => {
	for (const name of ["missing-file", "malformed", "other-binding", "invalid-key"]) {
		assert.ok(bottomRule(fixture(name)).endsWith("─ ctrl+o lists them ─╯"), `${name}: ${bottomRule(fixture(name))}`);
	}
});

test("S4 the tree's live keybindings come first: the file is not what the hint names when the editor has them", () => {
	assert.ok(bottomRule(fixture("remapped"), ["alt+x"]).endsWith("─ alt+x lists them ─╯"));
	assert.equal(bottomRule(fixture("remapped"), []), PLAIN_RULE, "unbound in the tree: no hint, whatever the file says");
});

test("S4 the keybindings file is read once at install, never per render", () => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-keys-"));
	try {
		const path = join(dir, "keybindings.json");
		writeFileSync(path, JSON.stringify({ "app.tools.expand": "ctrl+e" }));
		const pi = piTree(null);
		showLoadedResources(pi.loaded, LISTS);
		const restore = installLoadedBox(pi.tui, pi.card, { active: () => true, keybindingsPath: path })!;
		assert.ok(shown(pi.loaded, 63)[4].endsWith(" ctrl+e lists them ─╯"));
		writeFileSync(path, JSON.stringify({ "app.tools.expand": "alt+y" }));
		assert.ok(shown(pi.loaded, 63)[4].endsWith(" ctrl+e lists them ─╯"), "the same key on the next render");
		restore();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("S4 every key name Pi accepts is read, with up to four modifiers; Pi's key-id rules reject the rest", () => {
	const dir = mkdtempSync(join(tmpdir(), "fisi-dock-keys-"));
	try {
		const path = join(dir, "keybindings.json");
		const names = [..."abcdefghijklmnopqrstuvwxyz0123456789", ...Object.values(Key).filter((value): value is string => typeof value === "string")];
		writeFileSync(path, JSON.stringify({ "app.tools.expand": names.map((name) => `ctrl+${name}`) }));
		assert.equal(readExpandKey(path), names.map((name) => `ctrl+${name}`).join("/"));
		for (const key of ["ctrl+shift+alt+super+e", "e", "ctrl++", "shift+pageUp"]) {
			writeFileSync(path, JSON.stringify({ "app.tools.expand": key }));
			assert.equal(readExpandKey(path), key, key);
		}
		for (const value of ["Ctrl+E", "ctrl+ctrl+e", "ctrl+shift+alt+super+ctrl+e", "ctrl+foo", "", "ctrl+", 5, null, {}, ["ctrl+e", 1]]) {
			writeFileSync(path, JSON.stringify({ "app.tools.expand": value }));
			assert.equal(readExpandKey(path), "ctrl+o", `${JSON.stringify(value)} is ignored, as Pi ignores it`);
		}
		writeFileSync(path, JSON.stringify(["ctrl+e"]));
		assert.equal(readExpandKey(path), "ctrl+o", "a file that is not an object");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	assert.equal(readExpandKey(join(dir, "keybindings.json")), "ctrl+o", "a folder that is gone");
});

test("S4 Pi's keybindings file is keybindings.json in its agent dir: PI_CODING_AGENT_DIR (with ~ for the home), else ~/.pi/agent", () => {
	const home = join("/home", "someone");
	assert.equal(piKeybindingsPath({}, home), join(home, ".pi", "agent", "keybindings.json"));
	assert.equal(piKeybindingsPath({ PI_CODING_AGENT_DIR: "" }, home), join(home, ".pi", "agent", "keybindings.json"));
	assert.equal(piKeybindingsPath({ PI_CODING_AGENT_DIR: join("/srv", "agent") }, home), join("/srv", "agent", "keybindings.json"));
	assert.equal(piKeybindingsPath({ PI_CODING_AGENT_DIR: "~" }, home), join(home, "keybindings.json"));
	assert.equal(piKeybindingsPath({ PI_CODING_AGENT_DIR: "~/.gentle-shell/agent" }, home), join(home, ".gentle-shell", "agent", "keybindings.json"));
});

// Pi is never imported, so a Pi update that reshapes its listing would not fail
// type checking: the box would just give way to Pi's listing. This reads the
// installed Pi (the dev dependency) for the pieces the box relies on.
const PI_INTERACTIVE = join(import.meta.dirname, "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "modes", "interactive", "interactive-mode.js");

test("the installed Pi still builds its listing the way the box reads it", { skip: existsSync(PI_INTERACTIVE) ? false : `no Pi at ${PI_INTERACTIVE}` }, () => {
	const source = readFileSync(PI_INTERACTIVE, "utf8");
	const has = (pattern: RegExp | string, why: string) => assert.ok(typeof pattern === "string" ? source.includes(pattern) : pattern.test(source), why);
	has(/this\.documentContainer\.addChild\(this\.headerContainer\);\s*this\.documentContainer\.addChild\(this\.loadedResourcesContainer\);/, "the loaded resources right after the header container");
	has("this.headerContainer.children[index] = this.customHeader;", "the custom header (the card) inside the header container");
	has(/class ExpandableText extends ThemedText \{[\s\S]*?this\.state = state;[\s\S]*?setExpanded\(expanded\) \{\s*this\.state\.expanded = expanded;/, "sections expand through state.expanded");
	has("new ExpandableText(() => `${sectionHeader(name, color)}\\n${collapsedBody()}`", "a collapsed section is its [Name] header, then its list");
	has('theme.fg("dim", `  ${labels.join(", ")}`)', "the list is the names joined with commas");
	has('new ThemedText(() => `${theme.fg("warning", "[Skill warnings]")}', "warnings are plain themed text, never folded");
});

const PI_DIST = join(import.meta.dirname, "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist");
const PI_KEYBINDINGS = join(PI_DIST, "core", "keybindings.js");

test("the installed Pi still reads keybindings.json the way the hint's fallback does", { skip: existsSync(PI_KEYBINDINGS) ? false : `no Pi at ${PI_KEYBINDINGS}` }, () => {
	const keybindings = readFileSync(PI_KEYBINDINGS, "utf8");
	const config = readFileSync(join(PI_DIST, "config.js"), "utf8");
	const keyIds = readFileSync(join(PI_DIST, "core", "key-id-schema.js"), "utf8");
	const has = (source: string, pattern: RegExp | string, why: string) => assert.ok(typeof pattern === "string" ? source.includes(pattern) : pattern.test(source), why);
	has(keybindings, '"app.tools.expand": { defaultKeys: "ctrl+o"', "ctrl+o is Pi's default for app.tools.expand");
	has(keybindings, 'expandTools: "app.tools.expand"', "expandTools is the legacy id");
	has(keybindings, 'const configPath = join(agentDir, "keybindings.json");', "the file is keybindings.json in the agent dir");
	has(keybindings, /if \(key !== nextKey && Object\.hasOwn\(rawConfig, nextKey\)\) \{\s*migrated = true;\s*continue;/, "the new id wins over the legacy one");
	has(keybindings, "if (validateKeybindingValue.Check(binding))", "a value that is not a key id or a list of them is ignored");
	has(keyIds, 'const modifiers = ["ctrl", "shift", "alt", "super"];', "the modifiers");
	has(keyIds, /pattern: `\^\(\?!\.\*\(\?:\$\{duplicateModifierPattern\}\)\)\(\?:\(\?:\$\{modifiers\.join\("\|"\)\}\)\\\\\+\)\{0,4\}\$\{baseKeyPattern\}\$`/, "a key id: up to four distinct modifiers, then a key name");
	has(config, "export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;", "the agent dir comes from <APP>_CODING_AGENT_DIR");
	has(config, 'export const APP_NAME = piConfigName || "pi";', "the app is pi, so PI_CODING_AGENT_DIR");
	has(config, 'return join(homedir(), CONFIG_DIR_NAME, "agent");', "else <home>/<config dir>/agent");
});
