import { bold, fg, type Rgb } from "./palette.ts";

// A new row's entrance (S54), from artboard 16
// (design/gentle-shell-redesign/16-agents-entrance.html, paint): the row
// flashes bold in its section color, fading to its own colors over 3 steps,
// then one white shine crosses it once, one char per step, and it settles into
// its normal look. Colors only, so the row keeps its width. Steps are 75 ms
// (SHIMMER_STEP_MS) since the row appeared.

export const ENTRANCE_FLASH_STEPS = 3;
/** Where the shine head is on the first step after the flash. */
const HEAD_START = -2;
/** Cells the head travels past the last char before the entrance ends. */
const HEAD_EXIT = 2;
/** Head, then its neighbours at distance 1 and 2; same shades as the ODD label shine. */
const SHINE: readonly Rgb[] = [[0xff, 0xff, 0xff], [0xc8, 0xc8, 0xc8], [0x9a, 0x9a, 0x9a]];

/** One styled run of a row's text: its normal color and weight. */
export interface EntrancePiece {
	text: string;
	color: Rgb;
	bold?: boolean;
}

/** `from` moved `t` of the way to `to`, per channel, rounded like the artboard. */
export function mixColor(from: Rgb, to: Rgb, t: number): Rgb {
	return from.map((channel, index) => Math.round(channel * (1 - t) + to[index] * t)) as unknown as Rgb;
}

/** Steps the entrance of `text` lasts: the flash, then the head from -2 to 2 past the end. */
export function entranceSteps(text: string): number {
	return ENTRANCE_FLASH_STEPS + Array.from(text).length + HEAD_EXIT - HEAD_START + 1;
}

/** True during the flash, when the row's glyph wears the section color too. */
export function entranceFlash(step: number | undefined): boolean {
	return step !== undefined && Number.isFinite(step) && step >= 0 && step < ENTRANCE_FLASH_STEPS;
}

/** `pieces` at entrance `step`; undefined without a step or once it is over, and the caller draws the normal row. */
export function entranceText(pieces: readonly EntrancePiece[], sectionColor: Rgb, step: number | undefined): string | undefined {
	if (step === undefined || !Number.isFinite(step) || step < 0) return undefined;
	const at = Math.floor(step);
	const chars = pieces.flatMap((piece) => Array.from(piece.text).map((char) => ({ char, color: piece.color, bold: piece.bold === true })));
	if (at >= entranceSteps(chars.map((entry) => entry.char).join(""))) return undefined;
	const flash = at < ENTRANCE_FLASH_STEPS;
	const head = at - ENTRANCE_FLASH_STEPS + HEAD_START;
	let out = "";
	let run = "";
	let runColor: Rgb | undefined;
	let runBold = false;
	const flush = () => {
		if (run && runColor) out += runBold ? bold(fg(runColor, run)) : fg(runColor, run);
		run = "";
	};
	chars.forEach((entry, index) => {
		const color = flash ? mixColor(sectionColor, entry.color, at / ENTRANCE_FLASH_STEPS) : (SHINE[Math.abs(index - head)] ?? entry.color);
		const heavy = flash || entry.bold;
		if (!runColor || color.join() !== runColor.join() || heavy !== runBold) {
			flush();
			runColor = color;
			runBold = heavy;
		}
		run += entry.char;
	});
	flush();
	return out;
}
