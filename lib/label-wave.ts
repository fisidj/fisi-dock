// The working label's color wave in the prompt box (S90). Gentle Shell moves its
// wave one step per render, so it races while text streams and nearly stops during
// a quiet tool run. The box repaints the same words by the clock instead, with the
// same shape: the head and its two neighbors in the theme's accent, its
// softer tone one further out, muted elsewhere; both tones pastel, not vivid, so
// the passing color stays calm inside the box (vivid labels S3, L9).
// Only while Gentle Shell itself scans, in quality and performance (S93: there
// Gentle Shell steps its wave once a second).
// The petal before the label turns on the same clock (S97). With motion off (look-more
// S2) both stand still on the moment WAVE_STILL_AT. The head and the petal's pink tones
// take the accent (look-more S4); its lilac tones stay.
import type { OrbMotion } from "./orbs.ts";
import type { Accent, ColorMode } from "./look.ts";
import { accentBase, accentLabel, accentTone, bold, fg, labelAccent, palette, type Rgb } from "./palette.ts";

export const WAVE_STEP_MS = 120;
const WAVE_SOFT = palette.lilac;
/** Gentle Shell's wave enters three columns before the label; a short label rests between sweeps. */
const ENTRY_STEPS = 3;
const MIN_STEPS = 15;
/** Gentle Shell repaints a silent working phase once a second, so a frame always arrives within this while the editor is drawn. */
const FRAME_WINDOW_MS = 2000;

/** The fixed moment motion off paints (look-more S2): the wave not yet on the label, all muted, and the first petal. */
export const WAVE_STILL_AT = 0;

/** `label` with the wave at the moment `now`, its head in `accent`'s pastel (pink by default). */
export function waveLabel(label: string, now: number, accent: Accent = "pink"): string {
	const head = accentBase(accent);
	const chars = Array.from(label);
	const steps = Math.max(MIN_STEPS, chars.length + ENTRY_STEPS * 2);
	const at = (Math.floor(now / WAVE_STEP_MS) % steps) - ENTRY_STEPS;
	return chars
		.map((char, index) => {
			const distance = Math.abs(at - index);
			return fg(distance <= 1 ? head : distance === 2 ? WAVE_SOFT : palette.muted, char);
		})
		.join("");
}

/** Gentle Shell's working petal (lib/shell-prompt.ts PETAL_FRAMES): four flowers, one column each. */
const PETAL_FRAMES = ["✿", "❀", "❁", "✾"] as const;
/**
 * Its tones (PETAL_TONE_FRAMES: mdQuoteBorder, thinkingHigh, accent, borderAccent, accent, thinkingHigh,
 * mdQuoteBorder twice) in the colors of the Fisi Dock theme for color mode `mode` (look settings S4)
 * and `accent` (look-more S4): the vivid theme's or the soft pastels, deepPink and pink on the accent.
 */
function petalTones(mode: ColorMode, accent: Accent): Rgb[] {
	const deep = accentTone(labelAccent(palette.deepPink, mode), accent, mode);
	const pink = accentLabel(accent, mode);
	const lilac = labelAccent(palette.lilac, mode);
	return [deep, lilac, pink, pink, pink, lilac, deep, deep];
}

const PETAL_TONES = new Map<string, Rgb[]>();

/** Gentle Shell's working petal at the moment `now`, in `colors` (vivid by default) and `accent` (pink by default). Gentle Shell turns the petal and the wave on one tick, so one frame per wave step. */
export function wavePetal(now: number, colors: ColorMode = "vivid", accent: Accent = "pink"): string {
	const step = Math.floor(now / WAVE_STEP_MS);
	const mode = colors === "soft" ? "soft" : "vivid";
	const key = `${mode}/${accent}`;
	const tones = PETAL_TONES.get(key) ?? petalTones(mode, accent);
	PETAL_TONES.set(key, tones);
	return fg(tones[step % tones.length], bold(PETAL_FRAMES[step % PETAL_FRAMES.length]));
}

export interface WaveClockOptions {
	now(): number;
	motion(): OrbMotion;
	/** True while Fisi Dock's motion is off (look-more S2), read per frame: one fixed moment and no timer. */
	still?(): boolean;
	requestRender(): void;
	setInterval?(tick: () => void, ms: number): unknown;
	clearInterval?(handle: unknown): void;
}

export interface WaveClock {
	/** The moment to paint the wave at; WAVE_STILL_AT with motion off; undefined leaves Gentle Shell's own label (potato). */
	at(): number | undefined;
	/** After each frame: whether its label scans. Starts and stops the timer. */
	report(scanning: boolean): void;
	dispose(): void;
}

/**
 * A timer only while a scanning label is drawn, never in potato motion or with
 * Fisi Dock's motion off, which stops a running one at its next tick. The
 * motion setting is a file, so it is read when a scan starts, never per frame.
 * When no frame reports for FRAME_WINDOW_MS (the editor is not being drawn) it stops
 * asking for frames; the next reported scan starts it again.
 */
export function createWaveClock(options: WaveClockOptions): WaveClock {
	const startTimer = options.setInterval ?? ((tick: () => void, ms: number) => {
		const handle = setInterval(tick, ms);
		(handle as { unref?(): void }).unref?.();
		return handle;
	});
	const stopTimer = options.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
	const readMotion = (): OrbMotion => {
		try {
			return options.motion();
		} catch {
			return "quality";
		}
	};
	let motion = readMotion();
	let timer: unknown;
	let scanning = false;
	let lastFrame = 0;
	let disposed = false;
	const stop = () => {
		if (timer !== undefined) stopTimer(timer);
		timer = undefined;
	};
	const still = () => {
		try {
			return options.still?.() === true;
		} catch {
			return false;
		}
	};
	return {
		at: () => (still() ? WAVE_STILL_AT : motion === "potato" ? undefined : options.now()),
		report(next) {
			if (disposed) return;
			if (!next) {
				scanning = false;
				stop();
				return;
			}
			lastFrame = options.now();
			if (!scanning) motion = readMotion();
			scanning = true;
			if (timer !== undefined || motion === "potato" || still()) return;
			timer = startTimer(() => {
				if (still() || options.now() - lastFrame > FRAME_WINDOW_MS) return stop();
				options.requestRender();
			}, WAVE_STEP_MS);
		},
		dispose() {
			disposed = true;
			stop();
		},
	};
}
