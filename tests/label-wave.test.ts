import assert from "node:assert/strict";
import test from "node:test";
import { createWaveClock, WAVE_STEP_MS, WAVE_STILL_AT, waveLabel, wavePetal } from "../lib/label-wave.ts";
import { fgCode, palette, vivid } from "../lib/palette.ts";
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

test("the wave passes in the soft pastel tones, never the vivid ones: the box's text stays calm", () => {
	// "en la caja de texto esta muy fuerte los colores que psan con el efeto"
	const painted = Array.from({ length: 15 }, (_, step) => waveLabel("exploring…", step * WAVE_STEP_MS)).join("");
	assert.ok(painted.includes(fgCode(palette.pink)), "the head in the pastel pink");
	assert.ok(painted.includes(fgCode(palette.lilac)), "its softer tone in the pastel lilac");
	assert.ok(!painted.includes(fgCode(vivid(palette.pink))), "no vivid pink");
	assert.ok(!painted.includes(fgCode(vivid(palette.lilac))), "no vivid lilac");
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
	assert.ok(waveLabel("ODD implementing…", WAVE_STEP_MS * 3).startsWith(fgCode(palette.pink) + "O"), "the head lights `ODD` too, vivid");
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
	// The vivid theme's tones (S4): the petal matches the one Gentle Shell paints from the Fisi-Dock theme.
	const tones = [palette.deepPink, palette.lilac, palette.pink, palette.pink, palette.pink, palette.lilac, palette.deepPink, palette.deepPink].map(vivid);
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

// Look settings S4, S6: soft turns the petal in the theme's pastels of before 0.3.0; no mode is vivid, byte for byte.
test("S4 soft colors: the petal in the pastel tones, the wave unchanged; omitting the mode equals vivid (S6)", () => {
	const tones = [palette.deepPink, palette.lilac, palette.pink, palette.pink, palette.pink, palette.lilac, palette.deepPink, palette.deepPink];
	for (let step = 0; step < 16; step++) {
		const at = step * WAVE_STEP_MS + 5;
		const soft = wavePetal(at, "soft");
		assert.equal(soft, `${fgCode(tones[step % 8])}\x1b[1m${plain(soft)}\x1b[22m\x1b[39m`, `step ${step}`);
		assert.equal(plain(soft), plain(wavePetal(at)), "the same flower");
		assert.equal(wavePetal(at), wavePetal(at, "vivid"));
	}
	// The wave already passes in pastel in vivid (0.3.1): soft paints it the same.
	assert.equal(waveLabel("ODD checking…", WAVE_STEP_MS * 5), waveLabel("ODD checking…", WAVE_STEP_MS * 5));
});

test("look-more S2 motion off: the clock paints one fixed moment, starts no timer and stops a running one; the label and petal stand still", () => {
	const { state, clock } = fakeClockStill();
	state.still = true;
	assert.equal(clock.at(), WAVE_STILL_AT);
	state.now += 777;
	assert.equal(clock.at(), WAVE_STILL_AT, "the clock does not move it");
	clock.report(true);
	assert.equal(state.tick, undefined, "no timer while motion is off");
	state.still = false;
	assert.equal(clock.at(), state.now, "motion on again: the clock");
	clock.report(true);
	assert.ok(state.tick, "and the timer starts with the next scan");
	state.still = true;
	state.tick!();
	assert.equal(state.tick, undefined, "motion off stops a running timer at its next tick");
	assert.equal(state.renders, 0, "without asking for a frame");
	// The fixed moment: the label all muted and the first petal, the same at every clock.
	const words = "exploring…";
	assert.equal(waveLabel(words, WAVE_STILL_AT), Array.from(words).map((char) => `${fgCode(palette.muted)}${char}\x1b[39m`).join(""));
	assert.equal(wavePetal(WAVE_STILL_AT), wavePetal(0));
	clock.dispose();
});

function fakeClockStill() {
	const state = { now: 1000, renders: 0, tick: undefined as (() => void) | undefined, still: false };
	const clock = createWaveClock({
		now: () => state.now,
		motion: () => "quality",
		still: () => state.still,
		requestRender: () => void state.renders++,
		setInterval: (tick) => ((state.tick = tick), 1),
		clearInterval: () => void (state.tick = undefined),
	});
	return { state, clock };
}

// look-more S4, S7: the wave head and the petal's pink tones follow the accent; lilac stays lilac; omitting it is pink.
test("look-more S4 the wave head in the accent's base tone and the petal's pink tones on the accent; lilac stays; omitting the accent is pink (S7)", async () => {
	const { accentBase, accentLabel, accentTone, labelAccent } = await import("../lib/palette.ts");
	const label = "ODD checking…";
	for (let step = 0; step < 16; step++) {
		const at = step * WAVE_STEP_MS + 5;
		assert.equal(waveLabel(label, at, "pink"), waveLabel(label, at), `step ${step}: pink wave`);
		for (const colors of ["vivid", "soft"] as const) assert.equal(wavePetal(at, colors, "pink"), wavePetal(at, colors), `step ${step} ${colors}: pink petal`);
	}
	for (const accent of ["teal", "lilac", "amber", "green"] as const) {
		const wave = waveLabel(label, WAVE_STEP_MS * 6, accent);
		assert.equal(plain(wave), label);
		assert.ok(wave.includes(fgCode(accentBase(accent))), `${accent}: the head`);
		assert.ok(!wave.includes(fgCode(palette.pink)), `${accent}: no pink head`);
		assert.equal(wave.replaceAll(fgCode(accentBase(accent)), fgCode(palette.pink)), waveLabel(label, WAVE_STEP_MS * 6), `${accent}: only the head's color changes`);
		for (const colors of ["vivid", "soft"] as const) {
			const deep = accentTone(labelAccent(palette.deepPink, colors), accent, colors);
			const tones = [deep, labelAccent(palette.lilac, colors), accentLabel(accent, colors), accentLabel(accent, colors), accentLabel(accent, colors), labelAccent(palette.lilac, colors), deep, deep];
			for (let step = 0; step < 8; step++) {
				const at = step * WAVE_STEP_MS + 5;
				const petal = wavePetal(at, colors, accent);
				assert.equal(petal, `${fgCode(tones[step])}\x1b[1m${plain(petal)}\x1b[22m\x1b[39m`, `${accent} ${colors} step ${step}`);
			}
		}
	}
});
