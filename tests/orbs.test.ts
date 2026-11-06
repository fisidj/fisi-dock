import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { ORBS, orbFrame, orbFrameIndex, orbInterval, orbWidth, readOrbMotion, SHIMMER_STEP_MS, shimmerStepIndex, shimmerText, SPINNER_FRAMES, SPINNER_MS, spinnerAt, spinnerFrameIndex, STATIC_ORB } from "../lib/orbs.ts";
import { palette } from "../lib/palette.ts";
import { visibleWidth } from "../lib/text.ts";

// Artboard 09 (design/gentle-shell-redesign/09-phase-orbs.html), ORBS table.
const ARTBOARD: Record<string, { ms: number; frames: string[] }> = {
	exploring: { ms: 80, frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] },
	researching: { ms: 110, frames: ["⢄⠀", "⢂⠀", "⢁⠀", "⡁⠀", "⡈⢀", "⡐⢄", "⡠⢂", "⠠⡁", "⠀⡈", "⠀⡐", "⠀⡠", "⠀⠠"] },
	authorizing: { ms: 140, frames: ["⠁⠀⠈", "⠂⠀⠐", "⠄⠀⠠", "⡀⣀⢀", "⠄⠀⠠", "⠂⠀⠐"] },
	deciding: { ms: 160, frames: ["⠀", "⠂", "⠒", "⠶", "⣶", "⣿", "⣶", "⠶", "⠒", "⠂"] },
	planning: { ms: 180, frames: ["⠄⠀⠀", "⠆⠀⠀", "⠇⠄⠀", "⠇⠆⠀", "⠇⠇⠄", "⠇⠇⠆", "⠇⠇⠇", "⠀⠀⠀"] },
	implementing: { ms: 120, frames: ["⡀", "⡄", "⡆", "⡇", "⣇", "⣧", "⣷", "⣿", "⣾", "⣼", "⣸", "⢸", "⠸", "⠘", "⠈", "⠀"] },
	checking: { ms: 90, frames: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"] },
	closing: { ms: 150, frames: ["⣿", "⡿", "⠿", "⠟", "⠛", "⠋", "⠉", "⠁", "⠀", "⠁", "⠉", "⠋", "⠛", "⠟", "⠿", "⡿"] },
};

test("the orb table matches artboard 09: frames, intervals and panel colors", () => {
	assert.deepEqual(Object.keys(ORBS).sort(), Object.keys(ARTBOARD).sort());
	for (const [phase, orb] of Object.entries(ARTBOARD)) {
		assert.equal(ORBS[phase as keyof typeof ORBS].ms, orb.ms, phase);
		assert.deepEqual(ORBS[phase as keyof typeof ORBS].frames.map((frame) => frame.trimEnd()), orb.frames.map((frame) => frame.trimEnd()), phase);
	}
	assert.deepEqual(ORBS.exploring.color, palette.teal);
	assert.deepEqual(ORBS.researching.color, palette.lilac);
	assert.deepEqual(ORBS.authorizing.color, palette.coral);
	assert.deepEqual(ORBS.deciding.color, palette.pink);
	assert.deepEqual(ORBS.planning.color, palette.blue);
	assert.deepEqual(ORBS.implementing.color, [255, 118, 195]);
	assert.deepEqual(ORBS.checking.color, palette.amber);
	assert.deepEqual(ORBS.closing.color, palette.green);
});

test("orbFrame walks the frames in order, one per interval, deterministic from the clock", () => {
	for (const [phase, orb] of Object.entries(ARTBOARD)) {
		const seen = orb.frames.map((_, index) => orbFrame(phase, index * orb.ms).trimEnd());
		assert.deepEqual(seen, orb.frames.map((frame) => frame.trimEnd()), phase);
		assert.equal(orbFrame(phase, orb.frames.length * orb.ms), orbFrame(phase, 0), `${phase} wraps`);
		assert.equal(orbFrame(phase, orb.ms - 1), orbFrame(phase, 0), `${phase} holds a frame for its interval`);
		assert.equal(orbFrame(phase, 12_345), orbFrame(phase, 12_345), `${phase} same clock, same frame`);
	}
});

test("every frame of a phase has the phase's visible width", () => {
	for (const phase of Object.keys(ARTBOARD)) {
		const width = orbWidth(phase);
		assert.ok(width >= 1 && width <= 3, phase);
		for (const frame of ORBS[phase as keyof typeof ORBS].frames) assert.equal(visibleWidth(frame), width, `${phase} ${JSON.stringify(frame)}`);
	}
	assert.equal(orbWidth("checking"), 1);
	assert.equal(orbWidth("researching"), 2);
	assert.equal(orbWidth("planning"), 3);
});

test("an unknown phase falls back to a static dot", () => {
	assert.equal(STATIC_ORB, "●");
	assert.equal(orbFrame("dancing", 0), "●");
	assert.equal(orbFrame("dancing", 999_999), "●");
	assert.equal(orbWidth("dancing"), 1);
	assert.equal(orbInterval("dancing", "quality"), 1000);
});

test("motion: quality and performance run at the designed rate (S29), potato the still middle frame", () => {
	assert.equal(orbInterval("checking", "quality"), 90);
	assert.equal(orbInterval("checking", "performance"), 90);
	assert.equal(orbInterval("checking", "potato"), 1000);
	assert.equal(orbFrameIndex("checking", 90, "quality"), 1);
	assert.equal(orbFrameIndex("checking", 90, "performance"), 1);
	assert.equal(orbFrameIndex("checking", 180, "performance"), 2);
	for (const now of [0, 90, 5_000]) assert.equal(orbFrame("checking", now, "potato"), "⡿", "middle of 8 frames is index 4");
});

test("readOrbMotion reads Gentle Shell's animations.json and honours FISI_DOCK_ORBS=off", () => {
	const files = new Map<string, string>();
	const read = (path: string) => {
		const text = files.get(path);
		if (text === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
		return text;
	};
	const home = join("/", "home", "u");
	const defaultFile = join(home, ".pi", "gentle-ai", "animations.json");
	assert.equal(readOrbMotion({}, home, read), "quality", "no file: quality");
	files.set(defaultFile, JSON.stringify({ schema: "gentle-pi.animations/v1", policy: "potato" }));
	assert.equal(readOrbMotion({}, home, read), "potato");
	files.set(defaultFile, JSON.stringify({ schema: "gentle-pi.animations/v1", policy: "performance" }));
	assert.equal(readOrbMotion({}, home, read), "performance");
	files.set(defaultFile, "{not json");
	assert.equal(readOrbMotion({}, home, read), "quality", "malformed: quality, like Gentle Shell");
	const custom = join("/", "cfg");
	files.set(join(custom, "animations.json"), JSON.stringify({ schema: "gentle-pi.animations/v1", policy: "potato" }));
	assert.equal(readOrbMotion({ GENTLE_PI_CONFIG_HOME: custom }, home, read), "potato", "GENTLE_PI_CONFIG_HOME wins");
	assert.equal(readOrbMotion({ GENTLE_SHELL_CONFIG_HOME: custom }, home, read), "potato", "launcher marker");
	assert.equal(readOrbMotion({ FISI_DOCK_ORBS: "off" }, home, () => { throw new Error("never read"); }), "potato");
});

test("the running spinner (S31): classic braille dots, 80 ms a frame, one column each, from the clock", () => {
	assert.deepEqual([...SPINNER_FRAMES], ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);
	assert.equal(SPINNER_MS, 80);
	for (const frame of SPINNER_FRAMES) assert.equal(visibleWidth(frame), 1, frame);
	const seen = SPINNER_FRAMES.map((_, index) => spinnerAt(spinnerFrameIndex(index * 80)));
	assert.deepEqual(seen, [...SPINNER_FRAMES], "one frame per 80 ms, in order");
	assert.equal(spinnerFrameIndex(79), 0, "holds a frame for its interval");
	assert.equal(spinnerFrameIndex(800), 0, "wraps after 10 frames");
	assert.equal(spinnerFrameIndex(160, "performance"), 2, "performance runs at full rate");
	assert.equal(spinnerFrameIndex(-5), 0, "a clock before 0 stays on the first frame");
});

test("the running spinner holds the still ⠹ under potato motion and when no frame is given", () => {
	for (const now of [0, 80, 5_000]) assert.equal(spinnerFrameIndex(now, "potato"), 2);
	assert.equal(spinnerAt(), "⠹", "the glyph the panel showed before it moved");
	assert.equal(spinnerAt(Number.NaN), "⠹");
	assert.equal(spinnerAt(12), "⠹", "indexes wrap");
	assert.equal(spinnerAt(-1), "⠏");
});

// --- ODD label shimmer (S49): Gentle Shell's prompt scanner ---------------------

/** The foreground color of each visible character, as "r;g;b". */
function charColors(text: string): [string, string][] {
	const out: [string, string][] = [];
	let color = "";
	for (const token of text.match(/\x1b\[[0-9;]*m|[^\x1b]/gu) ?? []) {
		const code = /^\x1b\[38;2;([0-9;]+)m$/.exec(token);
		if (code) color = code[1];
		else if (token === "\x1b[39m") color = "";
		else if (!token.startsWith("\x1b")) out.push([token, color]);
	}
	return out;
}

const MUTED = palette.muted.join(";");
const WHITE = "255;255;255";
const LIGHT = "200;200;200";
const SOFT = "154;154;154";

test("shimmer step: one letter every 75 ms from the clock; none under potato", () => {
	assert.equal(SHIMMER_STEP_MS, 75);
	assert.equal(shimmerStepIndex(0, "quality"), 0);
	assert.equal(shimmerStepIndex(74, "quality"), 0);
	assert.equal(shimmerStepIndex(75 * 7 + 10, "performance"), 7);
	assert.equal(shimmerStepIndex(-500, "quality"), 0);
	assert.equal(shimmerStepIndex(9999, "potato"), undefined);
});

test("shimmerText: a white head with two lighter grays sweeps a muted label, entering before it and leaving after it", () => {
	const colors = (step?: number) => charColors(shimmerText("abc", step)).map(([, color]) => color);
	// cycle = 3 + 6 = 9, head = (step mod 9) - 3
	assert.deepEqual(colors(0), [MUTED, MUTED, MUTED], "entry: head 3 cells before the first letter");
	assert.deepEqual(colors(2), [LIGHT, SOFT, MUTED]);
	assert.deepEqual(colors(3), [WHITE, LIGHT, SOFT], "head on the first letter");
	assert.deepEqual(colors(5), [SOFT, LIGHT, WHITE], "head on the last letter");
	assert.deepEqual(colors(7), [MUTED, MUTED, SOFT]);
	assert.deepEqual(colors(8), [MUTED, MUTED, MUTED], "exit: head past the last letter");
	assert.deepEqual(colors(12), colors(3), "the cycle repeats");
	assert.deepEqual(colors(undefined), [MUTED, MUTED, MUTED], "no step: all muted");
	assert.deepEqual(colors(Number.NaN), [MUTED, MUTED, MUTED]);
	for (let step = 0; step < 20; step++) {
		assert.equal(charColors(shimmerText("exploring", step)).map(([char]) => char).join(""), "exploring");
		assert.equal(visibleWidth(shimmerText("exploring", step)), "exploring".length);
	}
});
