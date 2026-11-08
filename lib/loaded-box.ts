// Pi's list of loaded skills, prompts and extensions as one box under the
// welcome card (design start-screen/02 "Loaded box"): `loaded` on the top rule,
// one row per kind with its count, the names cut to the row, and Pi's expand key
// on the bottom rule. Pi is never imported: its loaded-resources container is
// found next to the card in the TUI tree and only that instance's render is
// wrapped, so a removed or reloaded Fisi Dock leaves Pi's own listing.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ColorMode } from "./look.ts";
import { fg, paint, palette } from "./palette.ts";
import { ellipsize, padEnd, visibleWidth } from "./text.ts";

/** Same frame as the welcome card (lib/welcome-card.ts): 63 columns, or the screen's width down to 34. */
const BOX_WIDTH = 63;
const MIN_BOX_WIDTH = 34;
/** A border and two spaces on each side. */
const SIDE = 3;
const TITLE = "loaded";
/** Cells of the top rule other than its dashes: `╭─ ` (3), the title, ` ` (1) and `╮` (1). */
const TOP_RULE_CHROME = 5 + TITLE.length;
/**
 * Pi's default for app.tools.expand, the key that lists the names in full
 * (core/keybindings.js). Pi's package exports neither its keybinding defaults
 * nor its key formatter, so this copy is checked against the installed Pi by
 * tests/loaded-box.test.ts.
 */
const DEFAULT_EXPAND_KEY = "ctrl+o";
const EXPAND_KEYBINDING = "app.tools.expand";
/** The id Pi migrates to app.tools.expand from older keybindings files. */
const LEGACY_EXPAND_KEYBINDING = "expandTools";
/** Columns between the kind, its count and the names. */
const GAP = "  ";

export type LoadedKind = { label: string; names: string[] };

const text = (value: string) => fg(palette.text, value);
const muted = (value: string) => fg(palette.muted, value);
const frame = (value: string) => fg(palette.frame, value);

const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const SECTION_HEADER = /^\[([^\]]+)\]$/;
/** Pi's warning sections ([Skill warnings], [Prompt conflicts], [Extension issues], [Theme conflicts]) are never folded. */
const DIAGNOSTIC = /warning|conflict|issue|error/i;

/**
 * One of Pi's collapsed listing sections, `[Skills]` then `  btw, chained-pr`,
 * as its kind (`skills`) and names in Pi's order. Undefined without a `[Name]`
 * header, or for a warning section.
 */
export function loadedKind(value: string): LoadedKind | undefined {
	const [header = "", ...body] = value.replace(ESCAPES, "").split("\n");
	const name = SECTION_HEADER.exec(header.trim())?.[1].trim();
	if (!name || DIAGNOSTIC.test(name)) return undefined;
	const names = body.join(" ").split(",").map((item) => item.trim()).filter((item) => item.length > 0);
	return { label: name.toLowerCase(), names };
}

/** `skills      24  btw, chained-pr, g…`: the kind padded, its count right-aligned, the names cut to `width`. */
function kindRow({ label, names }: LoadedKind, labelWidth: number, countWidth: number, width: number): string {
	const prefix = `${padEnd(label, labelWidth)}${GAP}${String(names.length).padStart(countWidth)}${GAP}`;
	const room = width - visibleWidth(prefix);
	if (room < 1) return muted(ellipsize(prefix.trimEnd(), width));
	return muted(padEnd(label, labelWidth)) + GAP + text(String(names.length).padStart(countWidth)) + GAP + muted(ellipsize(names.join(", "), room));
}

/**
 * The loaded box for `width` columns, centered like the welcome card; kinds
 * with nothing loaded are left out, and nothing loaded draws nothing. Under the
 * card's 34-column minimum the rows print without a frame or hint. The bottom
 * rule names `key`, Pi's expand key; an empty key leaves the rule plain. Light `colors`
 * paints it for a light background (look-more S5).
 */
export function renderLoadedBox(kinds: readonly LoadedKind[], width: number, key = DEFAULT_EXPAND_KEY, colors?: ColorMode): string[] {
	return boxLines(kinds, width, key).map((line) => paint(line, colors));
}

function boxLines(kinds: readonly LoadedKind[], width: number, key: string): string[] {
	const columns = Math.max(0, Math.floor(width));
	const shown = kinds.filter((kind) => kind.names.length > 0);
	if (columns < 1 || shown.length === 0) return [];
	const labelWidth = Math.max(...shown.map((kind) => visibleWidth(kind.label)));
	const countWidth = Math.max(...shown.map((kind) => String(kind.names.length).length));
	if (columns < MIN_BOX_WIDTH) return shown.map((kind) => kindRow(kind, labelWidth, countWidth, columns));

	const boxWidth = Math.min(BOX_WIDTH, columns);
	const inner = boxWidth - 2 * SIDE;
	const indent = " ".repeat((columns - boxWidth) >> 1);
	const row = (content: string) => `${indent}${frame("│")}  ${padEnd(content, inner)}  ${frame("│")}`;
	const hint = key ? ` ${key} lists them ` : "";
	const dashes = boxWidth - 3 - visibleWidth(hint);
	const bottom = hint && dashes >= 1 ? `${frame(`╰${"─".repeat(dashes)}`)}${muted(hint)}${frame("─╯")}` : frame(`╰${"─".repeat(boxWidth - 2)}╯`);
	return [
		`${indent}${frame("╭─ ")}${muted(TITLE)}${frame(` ${"─".repeat(boxWidth - TOP_RULE_CHROME)}╮`)}`,
		...shown.map((kind) => row(kindRow(kind, labelWidth, countWidth, inner))),
		`${indent}${bottom}`,
	];
}

type Render = (width: number) => string[];
type Node = { children?: unknown; render?: unknown };
/** Pi's ExpandableText: a ThemedText whose `build` gives the collapsed or expanded text by `state.expanded`. */
type PiSection = { state: { expanded: boolean }; build(): string; setExpanded(expanded: boolean): void; render: Render };

// Pi's tree: TUI > document > [header container > the card, loaded resources,
// chat]. The walk stops a few levels down and never descends into the chat.
const MAX_DEPTH = 3;
const MAX_NODES = 200;
/** Ours on a patched container; shared across reloads so a newer Fisi Dock wraps Pi's render, not an older wrapper. */
const PATCH = Symbol.for("fisi-dock.loaded-box");

type Patch = { original: Render; own: PropertyDescriptor | undefined; render: Render };

const childrenOf = (node: unknown): unknown[] | undefined => {
	const children = node && typeof node === "object" ? (node as Node).children : undefined;
	return Array.isArray(children) ? children : undefined;
};

/** Breadth-first over the top of the tree, with each node's parent; bounded. */
function walk(root: unknown, visit: (node: unknown, parent: unknown) => boolean): void {
	const seen = new Set<unknown>();
	let level: [unknown, unknown][] = [[root, undefined]];
	for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
		const next: [unknown, unknown][] = [];
		for (const [node, parent] of level) {
			if (!node || typeof node !== "object" || seen.has(node) || seen.size >= MAX_NODES) continue;
			seen.add(node);
			if (visit(node, parent)) return;
			if (depth < MAX_DEPTH) for (const child of childrenOf(node) ?? []) next.push([child, node]);
		}
		level = next;
	}
}

/** Pi's loaded-resources container: the sibling right after the container holding `header`. */
function findLoadedResources(root: unknown, header: object): Node | undefined {
	let found: Node | undefined;
	walk(root, (node, parent) => {
		if (!childrenOf(node)?.includes(header)) return false;
		const siblings = childrenOf(parent);
		const candidate = siblings?.[siblings.indexOf(node) + 1] as Node | undefined;
		if (candidate && typeof candidate === "object" && childrenOf(candidate) && typeof candidate.render === "function") found = candidate;
		return true;
	});
	return found;
}

/** Pi's keybindings.json: in its agent dir, `PI_CODING_AGENT_DIR` (`~` for the home), else `~/.pi/agent`. */
export function piKeybindingsPath(env: Record<string, string | undefined>, home: string): string {
	const custom = env.PI_CODING_AGENT_DIR;
	const agentDir = custom ? (custom === "~" ? home : custom.startsWith("~/") ? join(home, custom.slice(2)) : custom) : join(home, ".pi", "agent");
	return join(agentDir, "keybindings.json");
}

// Pi's key ids (core/key-id-schema.js): up to four distinct modifiers, then a
// letter, a digit or one of pi-tui's key names.
const MODIFIERS = ["ctrl", "shift", "alt", "super"];
const KEY_NAMES = "escape esc enter return tab space backspace delete insert clear home end pageUp pageDown up down left right f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12 ` - = [ ] \\ ; ' , . / ! @ # $ % ^ & * ( ) _ + | ~ { } : < > ?".split(" ");
const KEY_ID = new RegExp(
	`^(?!.*(?:${MODIFIERS.map((modifier) => `${modifier}\\+.*${modifier}\\+`).join("|")}))(?:(?:${MODIFIERS.join("|")})\\+){0,4}(?:[a-z0-9]|${KEY_NAMES.map((name) => name.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")).join("|")})$`,
);
const isKeyId = (value: unknown): value is string => typeof value === "string" && KEY_ID.test(value);

/** Keys as the hint names them: each once, joined with `/`; empty for none (no hint). */
const keyText = (keys: readonly string[]) => [...new Set(keys)].join("/");

/**
 * The keys Pi binds to app.tools.expand by the keybindings file at `path`, the
 * way Pi reads it (core/keybindings.js): app.tools.expand, else the legacy
 * expandTools; a key id or a list of them (`[]` unbinds it, so empty); a value
 * Pi rejects, a malformed or missing file: Pi's default.
 */
export function readExpandKey(path: string): string {
	let config: unknown;
	try {
		config = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
	} catch {
		return DEFAULT_EXPAND_KEY;
	}
	if (!config || typeof config !== "object") return DEFAULT_EXPAND_KEY;
	const id = Object.hasOwn(config, EXPAND_KEYBINDING) ? EXPAND_KEYBINDING : LEGACY_EXPAND_KEYBINDING;
	const value = (config as Record<string, unknown>)[id];
	if (isKeyId(value)) return value;
	return Array.isArray(value) && value.every(isKeyId) ? keyText(value) : DEFAULT_EXPAND_KEY;
}

/**
 * Pi's configured expand key from its keybindings, which its editor holds,
 * read on each call; without them, from Pi's keybindings file at
 * `keybindingsPath`, read once.
 */
function expandKeyReader(root: unknown, keybindingsPath: () => string): () => string {
	let keybindings: { getKeys(id: string): unknown } | undefined;
	walk(root, (node) => {
		const candidate = (node as { keybindings?: { getKeys?: unknown } }).keybindings;
		if (typeof candidate?.getKeys !== "function") return false;
		keybindings = candidate as { getKeys(id: string): unknown };
		return true;
	});
	let configured: string | undefined;
	const fromFile = () => {
		if (configured !== undefined) return configured;
		try {
			configured = readExpandKey(keybindingsPath());
		} catch {
			// No home to find the file in: Pi's default.
			configured = DEFAULT_EXPAND_KEY;
		}
		return configured;
	};
	if (!keybindings) fromFile();
	return () => {
		if (!keybindings) return fromFile();
		const keys = keybindings.getKeys(EXPAND_KEYBINDING);
		return Array.isArray(keys) ? keyText(keys.filter((key) => typeof key === "string")) : fromFile();
	};
}

const isSection = (child: unknown): child is PiSection => {
	const section = child as Partial<PiSection> | null;
	return typeof section === "object" && section !== null && typeof section.setExpanded === "function" && typeof section.build === "function" && typeof section.state?.expanded === "boolean";
};
/** Pi's Spacer: blank rows, `lines` of them. */
const isSpacer = (child: unknown) => typeof (child as { lines?: unknown }).lines === "number" && typeof (child as { setLines?: unknown }).setLines === "function";
/** Pi's warning sections and other texts: a ThemedText (`build`) or a Text (`text`). */
const isText = (child: unknown) => typeof (child as { build?: unknown }).build === "function" || typeof (child as { text?: unknown }).text === "string";

/**
 * The container's lines with the box in place of Pi's listing sections, or
 * undefined when Pi's own lines should show: no listing, a section expanded
 * (Pi's expand toggle), or any child of a shape Pi's listing never has.
 *
 * The names come from each section's collapsed text, the same lists Pi would
 * print (the compact labels Pi derives for extensions have no public API, and
 * pi.getCommands() knows neither extensions nor context files).
 */
function boxedLines(container: Node & { mouseLayout?: unknown }, width: number, key: string, colors?: ColorMode): string[] | undefined {
	const children = childrenOf(container) ?? [];
	const kinds: LoadedKind[] = [];
	const listed = new Set<number>();
	for (const [index, child] of children.entries()) {
		if (isSection(child)) {
			if (child.state.expanded) return undefined;
			const kind = loadedKind(child.build());
			if (!kind) return undefined;
			kinds.push(kind);
			listed.add(index);
		} else if (!isSpacer(child) && !isText(child)) return undefined;
	}
	if (listed.size === 0) return undefined;
	const box = renderLoadedBox(kinds, width, key, colors);
	const first = Math.min(...listed);
	// Pi's spacers around its sections give way to one blank row under the box.
	const beside = (index: number) => isSpacer(children[index]) && (listed.has(index - 1) || listed.has(index + 1));
	const lines: string[] = [];
	const layout: { component: unknown; height: number }[] = [];
	for (const [index, child] of children.entries()) {
		if (index === first) {
			const rows = box.length > 0 ? [...box, ""] : [];
			lines.push(...rows);
			layout.push({ component: {}, height: rows.length });
		}
		if (listed.has(index) || beside(index)) continue;
		const rows = (child as { render: Render }).render(width);
		lines.push(...rows);
		layout.push({ component: child, height: rows.length });
	}
	// Pi's Container routes the mouse by these heights; the box itself has nothing to click.
	container.mouseLayout = { width, children: layout };
	return lines;
}

export type LoadedBoxOptions = {
	/** True while the box should show: Fisi Dock on and its welcome card in the header. */
	active(): boolean;
	/** Pi's keybindings file, for the hint when the tree holds no keybindings; piKeybindingsPath for this process by default. */
	keybindingsPath?: string;
	/** The color mode, read per render (look-more S5): light paints the box for a light background. */
	colors?(): ColorMode;
};

/**
 * Wrap the render of Pi's loaded-resources container instance, found next to
 * the container holding `header` (the welcome card) in the TUI tree under
 * `root`. Each render reads the current sections, so Pi clearing and refilling
 * the container (reload, settings) keeps the box. Never Container.prototype.
 * Returns the restore that puts back exactly what was there, or undefined when
 * Pi's tree is not recognized (nothing patched).
 */
export function installLoadedBox(root: unknown, header: object, options: LoadedBoxOptions): (() => void) | undefined {
	const container = findLoadedResources(root, header) as (Node & Record<PropertyKey, unknown>) | undefined;
	if (!container) return undefined;
	const key = expandKeyReader(root, () => options.keybindingsPath ?? piKeybindingsPath(process.env, homedir()));
	// An earlier Fisi Dock that never restored (a crashed reload): wrap Pi's render it kept, not its wrapper.
	const earlier = container[PATCH] as Patch | undefined;
	const original = earlier?.original ?? (container.render as Render);
	const own = earlier ? earlier.own : Object.getOwnPropertyDescriptor(container, "render");
	let restored = false;
	const render: Render = function (this: unknown, width: number): string[] {
		if (!restored) {
			try {
				if (options.active()) {
					const lines = boxedLines(container, width, key(), options.colors?.());
					if (lines) return lines;
				}
			} catch {
				// Deliberately ignored: anything unexpected shows Pi's own listing.
			}
		}
		return original.call(this, width);
	};
	container.render = render;
	container[PATCH] = { original, own, render } satisfies Patch;
	return () => {
		if (restored) return;
		restored = true;
		// Someone wrapped it after us: ours stays in their chain, passing through to Pi.
		if (container.render !== render) return;
		if (own) Object.defineProperty(container, "render", own);
		else delete container.render;
		delete container[PATCH];
	};
}
