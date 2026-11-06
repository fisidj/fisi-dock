import assert from "node:assert/strict";
import test from "node:test";
import { createWaveClock, WAVE_STEP_MS, waveLabel, wavePetal } from "../lib/label-wave.ts";
import { fgCode, palette } from "../lib/palette.ts";
import { boxPromptRows, PROMPT_OWNER, wrapPromptFactory } from "../lib/prompt-box.ts";
import { visibleWidth } from "../lib/text.ts";

// S90: "pasan coloretes pero pasan no fluido es como si se trabara". Gentle Shell moves its label's
// color one step per render, and renders come in bursts. The box moves it by the clock instead;
// the words stay Gentle Shell's.

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const LABELS = { mode: "SUPER-YOLO", model: "opus-5.5", effort: "high" } as never;

/** Gentle Shell's scanWorkingText, restated: every character wrapped on its own, the head at `tick`. */
function gentleScan(label: string, tick: number): string {
	const head = (tick % 15) - 3;
	return Array.from(label, (char, index) => `\x1b[${Math.abs(head - index) === 0 ? "95" : "90"}m${char}\x1b[39m`).join("");
}

/** Gentle Shell's panel-chrome rows: the rule with `painted` as its label, a text row and the blank row. */
function gentleRows(width: number, label: string, painted: string): string[] {
	const fill = Math.max(0, width - (2 + 1 + 1 + visibleWidth(label) + 1) - 1);
	return [
		`\x1b[38;2;80;80;80m─ \x1b[39m\x1b[35m✿\x1b[39m ${painted} \x1b[38;2;80;80;80m${"─".repeat(fill)}─\x1b[39m`,
		"› ".padEnd(width),
		" ".repeat(width),
	];
}

const scanned = (width: number, label: string, tick: number) => gentleRows(width, label, gentleScan(label, tick));
const idle = (width: number, label: string) => gentleRows(width, label, `\x1b[2m${label}\x1b[22m`);

test("waveLabel keeps the words, and the color depends only on the time (S90)", () => {
	const at = WAVE_STEP_MS * 7;
	assert.equal(plain(waveLabel("exploring…", at)), "exploring…");
	assert.equal(waveLabel("exploring…", at), waveLabel("exploring…", at), "the same moment paints the same");
	assert.equal(waveLabel("exploring…", at), waveLabel("exploring…", at + WAVE_STEP_MS - 1), "within a step nothing moves");
	assert.notEqual(waveLabel("exploring…", at), waveLabel("exploring…", at + WAVE_STEP_MS), "the next step moves it");
});

test("waveLabel moves its head one character per step, and it reaches the end of a long label (S90)", () => {
	const label = "x".repeat(40);
	const headAt = (time: number) => waveLabel(label, time).split(fgCode(palette.pink)).length - 1;
	const seen = new Set<number>();
	const brightest: number[] = [];
	for (let step = 0; step < 60; step++) {
		const painted = waveLabel(label, step * WAVE_STEP_MS);
		const cells = painted.split("\x1b[39m").slice(0, 40);
		const lit = cells.flatMap((cell, index) => (cell.includes(fgCode(palette.pink)) ? [index] : []));
		for (const index of lit) seen.add(index);
		if (lit.length) brightest.push(lit[lit.length - 1]);
		assert.ok(headAt(step * WAVE_STEP_MS) <= 3);
	}
	assert.equal(seen.size, 40, "every character is lit at some point");
	assert.equal(brightest[1] - brightest[0], 1, "one character per step");
});

test("the box paints a scanning label by the time, whatever step Gentle Shell's render reached (S90)", () => {
	const at = WAVE_STEP_MS * 5;
	const one = boxPromptRows(scanned(76, "exploring…", 3), 80, 0, LABELS, at);
	const other = boxPromptRows(scanned(76, "exploring…", 11), 80, 0, LABELS, at);
	assert.equal(one.boxed, true);
	assert.equal(one.scanning, true);
	assert.equal(one.rows[0], other.rows[0], "only the time decides the color");
	assert.ok(one.rows[0].includes(waveLabel("ODD exploring…", at)), "S96: the wave sweeps `ODD exploring…`");
	assert.ok(plain(one.rows[0]).includes(" ODD exploring… "), "Gentle Shell's words stay, after `ODD `");
	assert.equal(visibleWidth(one.rows[0]), 80);
	assert.notEqual(boxPromptRows(scanned(76, "exploring…", 3), 80, 0, LABELS, at + WAVE_STEP_MS).rows[0], one.rows[0]);
});

test("the box leaves an idle label as Gentle Shell painted it, and any label without a time (S90)", () => {
	const quiet = boxPromptRows(idle(76, "waiting for input"), 80, 0, LABELS, WAVE_STEP_MS);
	assert.equal(quiet.scanning, false);
	assert.ok(quiet.rows[0].includes("\x1b[2mwaiting for input"), "carried over as painted");
	const short = boxPromptRows(idle(76, "queued"), 80, 0, LABELS, WAVE_STEP_MS);
	assert.equal(short.scanning, false, "a short idle label is not a scan");
	const timeless = boxPromptRows(scanned(76, "exploring…", 3), 80, 0, LABELS);
	assert.equal(timeless.scanning, true);
	assert.ok(timeless.rows[0].includes(gentleScan("exploring…", 3)), "no time: Gentle Shell's own colors");
});

test("the wrapper asks the time once per frame, renders once and reports whether the label scans (S90)", () => {
	const reports: boolean[] = [];
	let renders = 0;
	let working = true;
	const factory = wrapPromptFactory(
		() => ({
			render(width: number) {
				renders += 1;
				return working ? scanned(width, "exploring…", renders) : idle(width, "waiting for input");
			},
		}),
		{ painting: () => true, labels: () => LABELS, waveAt: () => WAVE_STEP_MS * 2, onScanning: (scanning) => reports.push(scanning) },
	);
	assert.equal((factory as never)[PROMPT_OWNER], true);
	const editor = factory({}, {}, {});
	const row = editor.render(80)[0];
	assert.ok(row.includes(waveLabel("ODD exploring…", WAVE_STEP_MS * 2)));
	assert.equal(renders, 1, "Gentle Shell's render advances its tick, so one frame renders once");
	working = false;
	editor.render(80);
	assert.deepEqual(reports, [true, false]);
	editor.render(10);
	assert.deepEqual(reports, [true, false, false], "an unboxed frame reports no scan");
});

function fakeClock(motion: string) {
	const state = { now: 1000, renders: 0, tick: undefined as (() => void) | undefined, ms: 0, motion, reads: 0 };
	const clock = createWaveClock({
		now: () => state.now,
		motion: () => {
			state.reads += 1;
			return state.motion as never;
		},
		requestRender: () => {
			state.renders += 1;
		},
		setInterval: (tick, ms) => {
			state.tick = tick;
			state.ms = ms;
			return 1;
		},
		clearInterval: () => {
			state.tick = undefined;
		},
	});
	return { state, clock };
}

test("the clock repaints at the wave step only while the label scans (S90)", () => {
	const { state, clock } = fakeClock("quality");
	assert.equal(state.tick, undefined, "no timer before a scan");
	assert.equal(clock.at(), 1000);
	clock.report(true);
	assert.equal(state.ms, WAVE_STEP_MS);
	state.tick!();
	state.tick!();
	assert.equal(state.renders, 2);
	clock.report(false);
	assert.equal(state.tick, undefined, "the timer stops with the scan");
	clock.report(true);
	assert.ok(state.tick, "and starts with the next one");
	clock.dispose();
	assert.equal(state.tick, undefined);
	clock.report(true);
	assert.equal(state.tick, undefined, "nothing starts after dispose");
	assert.equal(state.renders, 2);
});

test("with no frame reported the clock stops asking for frames; the next scan starts it again (S90)", () => {
	const { state, clock } = fakeClock("quality");
	clock.report(true);
	state.now += 1000;
	state.tick!();
	assert.equal(state.renders, 1, "a second without a frame is still inside the window");
	state.now += 2000;
	state.tick!();
	assert.equal(state.renders, 1, "the editor is not being drawn: no more frames");
	assert.equal(state.tick, undefined);
	clock.report(true);
	assert.ok(state.tick);
});

test("S93 performance moves the wave by the clock like quality: Gentle Shell's own label there steps once a second", () => {
	const { state, clock } = fakeClock("performance");
	assert.equal(clock.at(), 1000, "the box paints the wave at the clock's moment");
	clock.report(true);
	assert.equal(state.ms, WAVE_STEP_MS, "the same steady step as quality");
	state.tick!();
	state.tick!();
	assert.equal(state.renders, 2);
	clock.report(false);
	assert.equal(state.tick, undefined, "the timer stops with the scan");
});

test("potato keeps Gentle Shell's own label and no timer; the setting is read when a scan starts (S90, S93)", () => {
	{
		const { state, clock } = fakeClock("potato");
		assert.equal(clock.at(), undefined);
		clock.report(true);
		assert.equal(state.tick, undefined);
	}
	const { state, clock } = fakeClock("quality");
	const before = state.reads;
	clock.report(true);
	for (let frame = 0; frame < 20; frame++) {
		clock.at();
		clock.report(true);
	}
	assert.ok(state.reads <= before + 1, "a frame reads no file");
	clock.report(false);
	state.motion = "potato";
	clock.report(true);
	assert.equal(clock.at(), undefined, "a changed setting applies at the next scan");
	assert.equal(state.tick, undefined);
});

// S96: "ODD dentro de la ola": the wave sweeps the whole `ODD <phase>`, `ODD` included.

test("S96 the clock wave sweeps `ODD ` and the phase as one text", () => {
	const at = WAVE_STEP_MS * 4;
	const box = boxPromptRows(scanned(76, "implementing…", 9), 80, 0, LABELS, at);
	assert.equal(box.scanning, true);
	assert.ok(box.rows[0].includes(` ${waveLabel("ODD implementing…", at)} `), "one wave over `ODD implementing…`");
	assert.ok(waveLabel("ODD implementing…", WAVE_STEP_MS * 3).startsWith(fgCode(palette.pink) + "O"), "the head lights `ODD` too");
	assert.equal(visibleWidth(box.rows[0]), 80);
});

test("S90 preserved: a scanning label that is no ODD phase (`working…`) still waves by the clock, with no prefix", () => {
	const at = WAVE_STEP_MS * 6;
	const box = boxPromptRows(scanned(76, "working…", 2), 80, 0, LABELS, at);
	assert.equal(box.scanning, true);
	assert.ok(box.rows[0].includes(` ${waveLabel("working…", at)} `));
	assert.ok(!plain(box.rows[0]).includes("ODD"));
});

// S97: "la rosita en el cuadro de texto ... debe estar como que vaya fluido constante". Gentle Shell
// turns its petal one frame per tick (lib/shell-prompt.ts petalGlyph, petalTone); the box turns it by the clock.

/** Gentle Shell's working petal at `tick`, restated with its own codes: four flowers, bold. */
const gentlePetal = (tick: number) => `\x1b[35m\x1b[1m${["✿", "❀", "❁", "✾"][tick % 4]}\x1b[22m\x1b[39m`;
const working = (width: number, label: string, tick: number) => {
	const rows = scanned(width, label, tick);
	rows[0] = rows[0].replace("\x1b[35m✿\x1b[39m", gentlePetal(tick));
	return rows;
};
const petalOf = (row: string) => plain(row).slice(3, 4);

test("S97 wavePetal turns through Gentle Shell's four flowers and its tones, one frame per wave step", () => {
	const tones = [palette.deepPink, palette.lilac, palette.pink, palette.pink, palette.pink, palette.lilac, palette.deepPink, palette.deepPink];
	for (let step = 0; step < 16; step++) {
		const petal = wavePetal(step * WAVE_STEP_MS + 5);
		assert.equal(plain(petal), ["✿", "❀", "❁", "✾"][step % 4]);
		assert.equal(visibleWidth(petal), 1, "every frame one column: no jitter");
		assert.equal(petal, `${fgCode(tones[step % 8])}\x1b[1m${plain(petal)}\x1b[22m\x1b[39m`, `step ${step}`);
	}
	assert.equal(wavePetal(WAVE_STEP_MS * 2), wavePetal(WAVE_STEP_MS * 3 - 1), "within a step nothing moves");
});

test("S97 the box paints the petal from the clock, not from Gentle Shell's tick or the render count", () => {
	const at = WAVE_STEP_MS * 5;
	const rows = [1, 2, 3, 7].map((tick) => boxPromptRows(working(76, "exploring…", tick), 80, 0, LABELS, at).rows[0]);
	for (const row of rows) assert.equal(row, rows[0], "Gentle Shell's tick changes nothing");
	assert.ok(rows[0].startsWith(`${fgCode(palette.frame)}╭─ \x1b[39m${wavePetal(at)} `));
	assert.equal(petalOf(rows[0]), "❀");
	const next = boxPromptRows(working(76, "exploring…", 1), 80, 0, LABELS, at + WAVE_STEP_MS).rows[0];
	assert.equal(petalOf(next), "❁", "the next step turns it");
	assert.equal(visibleWidth(next), 80);

	let renders = 0;
	let now = at;
	const editor = wrapPromptFactory(
		() => ({ render: (width: number) => working(width, "exploring…", ++renders) }),
		{ painting: () => true, labels: () => LABELS, waveAt: () => now },
	)({}, {}, {});
	const frames = [0, 1, 2].map(() => petalOf(editor.render(80)[0]));
	assert.deepEqual(frames, ["❀", "❀", "❀"], "three renders at one moment: one petal");
	now += WAVE_STEP_MS * 2;
	assert.equal(petalOf(editor.render(80)[0]), "✾");
});

test("S97 potato (no clock) and an idle label keep Gentle Shell's own petal", () => {
	const potato = boxPromptRows(working(76, "exploring…", 2), 80, 0, LABELS);
	assert.ok(potato.rows[0].includes(gentlePetal(2)), "Gentle Shell's petal as it painted it");
	const quiet = boxPromptRows(idle(76, "waiting for input"), 80, 0, LABELS, WAVE_STEP_MS);
	assert.ok(quiet.rows[0].includes("\x1b[35m✿\x1b[39m"), "idle: Gentle Shell's still petal");
});
