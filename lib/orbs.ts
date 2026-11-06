import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { OddPhase } from "./odd-inference.ts";
import { fg, palette, type Rgb } from "./palette.ts";
import { padEnd, visibleWidth } from "./text.ts";

// Animated braille orbs per ODD phase (S17), from artboard 09
// (design/gentle-shell-redesign/09-phase-orbs.html, ORBS table). Frames are a
// pure function of the clock, so the panel and the tests agree on what shows.

export interface Orb {
	/** Every frame padded to the same visible width. */
	frames: readonly string[];
	color: Rgb;
	/** Milliseconds per frame at full rate. */
	ms: number;
}

/** Gentle Shell's animation levels (/gentle:animations). */
export type OrbMotion = "quality" | "performance" | "potato";

export const STATIC_ORB = "●";
/** The static tick: potato motion and unknown phases only move the m:ss. */
const STILL_TICK_MS = 1000;

function orb(color: Rgb, ms: number, frames: string[]): Orb {
	const width = Math.max(...frames.map(visibleWidth));
	return { color, ms, frames: frames.map((frame) => padEnd(frame, width)) };
}

export const ORBS: Record<OddPhase, Orb> = {
	exploring: orb(palette.teal, 80, ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]),
	researching: orb(palette.lilac, 110, ["⢄⠀", "⢂⠀", "⢁⠀", "⡁⠀", "⡈⢀", "⡐⢄", "⡠⢂", "⠠⡁", "⠀⡈", "⠀⡐", "⠀⡠", "⠀⠠"]),
	authorizing: orb(palette.coral, 140, ["⠁⠀⠈", "⠂⠀⠐", "⠄⠀⠠", "⡀⣀⢀", "⠄⠀⠠", "⠂⠀⠐"]),
	deciding: orb(palette.pink, 160, ["⠀", "⠂", "⠒", "⠶", "⣶", "⣿", "⣶", "⠶", "⠒", "⠂"]),
	planning: orb(palette.blue, 180, ["⠄⠀⠀", "⠆⠀⠀", "⠇⠄⠀", "⠇⠆⠀", "⠇⠇⠄", "⠇⠇⠆", "⠇⠇⠇", "⠀⠀⠀"]),
	implementing: orb(palette.rose, 120, ["⡀", "⡄", "⡆", "⡇", "⣇", "⣧", "⣷", "⣿", "⣾", "⣼", "⣸", "⢸", "⠸", "⠘", "⠈", "⠀"]),
	checking: orb(palette.amber, 90, ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"]),
	closing: orb(palette.green, 150, ["⣿", "⡿", "⠿", "⠟", "⠛", "⠋", "⠉", "⠁", "⠀", "⠁", "⠉", "⠋", "⠛", "⠟", "⠿", "⡿"]),
};

/** The orb of `phase`, or undefined for a phase the artboard does not name. */
export function orbOf(phase: string): Orb | undefined {
	return Object.hasOwn(ORBS, phase) ? ORBS[phase as OddPhase] : undefined;
}

/** Visible width of every frame of `phase`; 1 for the static dot. */
export function orbWidth(phase: string): number {
	const found = orbOf(phase);
	return found ? visibleWidth(found.frames[0]) : 1;
}

/** Milliseconds between visible frame changes; the 1 s tick when nothing animates. */
export function orbInterval(phase: string, motion: OrbMotion = "quality"): number {
	const found = orbOf(phase);
	if (!found || motion === "potato") return STILL_TICK_MS;
	// S29: performance used to halve the rate and looked sluggish; only potato stops motion.
	return found.ms;
}

/** The still frame: the middle one, as the artboard shows under reduced motion. */
export function orbStillIndex(phase: string): number {
	return Math.floor((orbOf(phase)?.frames.length ?? 0) / 2);
}

/** Frame index at `nowMs`; potato and unknown phases stay on the still frame. */
export function orbFrameIndex(phase: string, nowMs: number, motion: OrbMotion = "quality"): number {
	const found = orbOf(phase);
	if (!found || motion === "potato") return orbStillIndex(phase);
	return Math.floor(Math.max(0, nowMs) / orbInterval(phase, motion)) % found.frames.length;
}

/** Frame `index` of `phase` (the still frame when undefined), or the static dot. */
export function orbAt(phase: string, index?: number): string {
	const found = orbOf(phase);
	if (!found) return STATIC_ORB;
	const count = found.frames.length;
	const at = index === undefined || !Number.isFinite(index) ? orbStillIndex(phase) : ((Math.floor(index) % count) + count) % count;
	return found.frames[at];
}

/** The visible orb of `phase` at `nowMs`. */
export function orbFrame(phase: string, nowMs: number, motion: OrbMotion = "quality"): string {
	return orbAt(phase, orbFrameIndex(phase, nowMs, motion));
}

// The running spinner (S31) on active todo tasks and running agents: the
// classic braille dots, one column each, at the exploring orb's rate.
export const SPINNER_FRAMES: readonly string[] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const SPINNER_MS = 80;
/** ⠹, the glyph the panel showed before it moved: potato motion and no frame. */
const SPINNER_STILL = 2;

/** Spinner frame index at `nowMs`; potato stays on the still frame. */
export function spinnerFrameIndex(nowMs: number, motion: OrbMotion = "quality"): number {
	if (motion === "potato") return SPINNER_STILL;
	return Math.floor(Math.max(0, nowMs) / SPINNER_MS) % SPINNER_FRAMES.length;
}

/** Spinner frame `index`, the still one when undefined. */
export function spinnerAt(index?: number): string {
	const count = SPINNER_FRAMES.length;
	const at = index === undefined || !Number.isFinite(index) ? SPINNER_STILL : ((Math.floor(index) % count) + count) % count;
	return SPINNER_FRAMES[at];
}

// The active ODD label's shine (S49), after Gentle Shell's prompt scanner
// (lib/shell-prompt.ts scanWorkingText): a white head walks a muted label one
// letter per step, entering 3 cells before it and leaving 3 cells after it.
export const SHIMMER_STEP_MS = 75;
/** Cells the head spends before the first letter and after the last one. */
const SHIMMER_ENTRY = 3;
/** Head, then its two neighbours on each side; everything else is muted. */
const SHIMMER_COLORS: readonly Rgb[] = [[0xff, 0xff, 0xff], [0xc8, 0xc8, 0xc8], [0x9a, 0x9a, 0x9a]];

/** Shine step at `nowMs`; undefined under potato, where the label stays still. */
export function shimmerStepIndex(nowMs: number, motion: OrbMotion = "quality"): number | undefined {
	if (motion === "potato") return undefined;
	return Math.floor(Math.max(0, nowMs) / SHIMMER_STEP_MS);
}

/** `text` in muted gray with the white head at `step`; all muted without a step. */
export function shimmerText(text: string, step?: number): string {
	const chars = Array.from(text);
	if (step === undefined || !Number.isFinite(step)) return fg(palette.muted, text);
	const cycle = chars.length + SHIMMER_ENTRY * 2;
	const head = (((Math.floor(step) % cycle) + cycle) % cycle) - SHIMMER_ENTRY;
	let out = "";
	let run = "";
	let runColor: Rgb = palette.muted;
	chars.forEach((char, index) => {
		const color = SHIMMER_COLORS[Math.abs(index - head)] ?? palette.muted;
		if (color !== runColor) {
			out += fg(runColor, run);
			run = "";
			runColor = color;
		}
		run += char;
	});
	return out + fg(runColor, run);
}

// Gentle Shell keeps its animation level in <config home>/animations.json
// (lib/animation-policy.ts, schema gentle-pi.animations/v1). The config home
// rule is restated from lib/gentle-shell-bundled.ts resolveGentlePiConfigHome,
// without its bundled-install validation: a bundled prefix's file is tried
// first and skipped when absent. FISI_DOCK_ORBS=off forces the still orb.
const ANIMATION_SCHEMA = "gentle-pi.animations/v1";

type Env = Record<string, string | undefined>;

function policyFrom(raw: string): OrbMotion | undefined {
	try {
		const value = JSON.parse(raw) as { schema?: unknown; policy?: unknown } | null;
		if (!value || typeof value !== "object" || value.schema !== ANIMATION_SCHEMA) return undefined;
		return value.policy === "quality" || value.policy === "performance" || value.policy === "potato" ? value.policy : undefined;
	} catch {
		return undefined;
	}
}

/** The orb motion for this process; quality when nothing says otherwise. */
export function readOrbMotion(env: Env, home: string, read: (path: string) => string = (path) => readFileSync(path, "utf8")): OrbMotion {
	if (env.FISI_DOCK_ORBS?.toLowerCase() === "off") return "potato";
	const attempt = (dir: string): OrbMotion | "missing" => {
		try {
			return policyFrom(read(join(dir, "animations.json"))) ?? "quality";
		} catch (error) {
			return (error as { code?: unknown })?.code === "ENOENT" ? "missing" : "quality";
		}
	};
	const prefix = env.GENTLE_SHELL_PREFIX;
	if (prefix && isAbsolute(prefix)) {
		const bundled = attempt(join(prefix, "config", "gentle-ai"));
		if (bundled !== "missing") return bundled;
	}
	const marker = env.GENTLE_SHELL_CONFIG_HOME;
	const dir = env.GENTLE_PI_CONFIG_HOME || (marker && isAbsolute(marker) ? marker : join(home, ".pi", "gentle-ai"));
	const motion = attempt(dir);
	return motion === "missing" ? "quality" : motion;
}
