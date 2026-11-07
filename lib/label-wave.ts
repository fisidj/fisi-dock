// The working label's color wave in the prompt box (S90). Gentle Shell moves its
// wave one step per render, so it races while text streams and nearly stops during
// a quiet tool run. The box repaints the same words by the clock instead, with the
// same shape: the head and its two neighbors in the theme's accent, its
// softer tone one further out, muted elsewhere; both tones pastel, not vivid, so
// the passing color stays calm inside the box (vivid labels S3, L9).
// Only while Gentle Shell itself scans, in quality and performance (S93: there
// Gentle Shell steps its wave once a second).
// The petal before the label turns on the same clock (S97).
import type { OrbMotion } from "./orbs.ts";
import { bold, fg, palette, vivid } from "./palette.ts";

export const WAVE_STEP_MS = 120;
const WAVE_HEAD = palette.pink;
const WAVE_SOFT = palette.lilac;
/** Gentle Shell's wave enters three columns before the label; a short label rests between sweeps. */
const ENTRY_STEPS = 3;
const MIN_STEPS = 15;
/** Gentle Shell repaints a silent working phase once a second, so a frame always arrives within this while the editor is drawn. */
const FRAME_WINDOW_MS = 2000;

/** `label` with the wave at the moment `now`. */
export function waveLabel(label: string, now: number): string {
	const chars = Array.from(label);
	const steps = Math.max(MIN_STEPS, chars.length + ENTRY_STEPS * 2);
	const head = (Math.floor(now / WAVE_STEP_MS) % steps) - ENTRY_STEPS;
	return chars
		.map((char, index) => {
			const distance = Math.abs(head - index);
			return fg(distance <= 1 ? WAVE_HEAD : distance === 2 ? WAVE_SOFT : palette.muted, char);
		})
		.join("");
}

/** Gentle Shell's working petal (lib/shell-prompt.ts PETAL_FRAMES): four flowers, one column each. */
const PETAL_FRAMES = ["✿", "❀", "❁", "✾"] as const;
/** Its tones (PETAL_TONE_FRAMES: mdQuoteBorder, thinkingHigh, accent, borderAccent, accent, thinkingHigh, mdQuoteBorder twice) in the Fisi-Dock theme's vivid colors. */
const PETAL_TONES = [palette.deepPink, palette.lilac, palette.pink, palette.pink, palette.pink, palette.lilac, palette.deepPink, palette.deepPink].map(vivid);

/** Gentle Shell's working petal at the moment `now`. Gentle Shell turns the petal and the wave on one tick, so one frame per wave step. */
export function wavePetal(now: number): string {
	const step = Math.floor(now / WAVE_STEP_MS);
	return fg(PETAL_TONES[step % PETAL_TONES.length], bold(PETAL_FRAMES[step % PETAL_FRAMES.length]));
}

export interface WaveClockOptions {
	now(): number;
	motion(): OrbMotion;
	requestRender(): void;
	setInterval?(tick: () => void, ms: number): unknown;
	clearInterval?(handle: unknown): void;
}

export interface WaveClock {
	/** The moment to paint the wave at; undefined leaves Gentle Shell's own label (potato). */
	at(): number | undefined;
	/** After each frame: whether its label scans. Starts and stops the timer. */
	report(scanning: boolean): void;
	dispose(): void;
}

/**
 * A timer only while a scanning label is drawn, never in potato motion. The
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
	return {
		at: () => (motion === "potato" ? undefined : options.now()),
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
			if (timer !== undefined || motion === "potato") return;
			timer = startTimer(() => {
				if (options.now() - lastFrame > FRAME_WINDOW_MS) return stop();
				options.requestRender();
			}, WAVE_STEP_MS);
		},
		dispose() {
			disposed = true;
			stop();
		},
	};
}
