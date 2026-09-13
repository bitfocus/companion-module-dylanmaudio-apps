/**
 * Talk flash (brief-companion-control.md §5).
 *
 * While Talk Light Trigger reports talk, every key carrying the Talk flash
 * feedback blinks in phase. They blink in phase because one module timer
 * drives them all rather than each key keeping its own. EXIT on a deck sends
 * that deck back to its page, and starts a cooldown during which a new talk
 * does not take the decks over again (`talk_flash_armed` is false).
 *
 * The page switching itself is Companion's own — two triggers and a TALK
 * page, shipped as an importable file. This class only owns the blink, the
 * cooldown and the two variables the triggers read.
 *
 * Defaults are decided (brief §9): 2 Hz and 10 s, both adjustable. The rate
 * is capped at 3 Hz, the photosensitivity guidance's limit of three flashes
 * a second. A deck full of saturated red blinking in a dark booth is the
 * case that guidance was written for.
 */

export const TALK_FLASH_DEFAULT_HZ = 2
export const TALK_FLASH_MAX_HZ = 3
export const TALK_FLASH_MIN_HZ = 0.5
export const TALK_FLASH_DEFAULT_COOLDOWN_S = 10
export const TALK_FLASH_MAX_COOLDOWN_S = 120

export function clampTalkFlashHz(hz: unknown): number {
	const n = Number(hz)
	if (!Number.isFinite(n)) return TALK_FLASH_DEFAULT_HZ
	return Math.min(TALK_FLASH_MAX_HZ, Math.max(TALK_FLASH_MIN_HZ, n))
}

export function clampTalkFlashCooldown(s: unknown): number {
	const n = Number(s)
	if (!Number.isFinite(n)) return TALK_FLASH_DEFAULT_COOLDOWN_S
	return Math.min(TALK_FLASH_MAX_COOLDOWN_S, Math.max(0, n))
}

interface Timers {
	setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>
	clearInterval(t: ReturnType<typeof setInterval>): void
	setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>
	clearTimeout(t: ReturnType<typeof setTimeout>): void
}

export interface TalkFlashOptions {
	hz: number
	cooldownS: number
	/** The lit state changed — a blink, or talk starting or stopping. Re-check the feedback. */
	onLit(): void
	/** `talk_flash_armed` changed. */
	onArmed(armed: boolean): void
	timers?: Timers
}

export class TalkFlash {
	private talking = false
	private phaseOn = false
	private blink: ReturnType<typeof setInterval> | null = null
	private cooldown: ReturnType<typeof setTimeout> | null = null
	private hz: number
	private cooldownS: number
	private readonly timers: Timers

	constructor(private readonly opts: TalkFlashOptions) {
		this.hz = clampTalkFlashHz(opts.hz)
		this.cooldownS = clampTalkFlashCooldown(opts.cooldownS)
		this.timers = opts.timers ?? { setInterval, clearInterval, setTimeout, clearTimeout }
	}

	/** Talk Light reports talk. */
	get active(): boolean {
		return this.talking
	}

	/** A new talk may take the decks over — no EXIT cooldown running. */
	get armed(): boolean {
		return this.cooldown === null
	}

	/** The feedback's value: the lit half of each blink, while talk is active. */
	get lit(): boolean {
		return this.talking && this.phaseOn
	}

	get rateHz(): number {
		return this.hz
	}

	setTalk(active: boolean): void {
		if (active === this.talking) return
		this.talking = active
		if (active) {
			this.phaseOn = true // the first frame of a talk is lit, not dark
			this.startBlink()
		} else {
			this.stopBlink()
			this.phaseOn = false
		}
		this.opts.onLit()
	}

	/** EXIT pressed: hold off the next takeover for the cooldown. A second press restarts it. */
	exit(): void {
		const wasArmed = this.armed
		if (this.cooldown) this.timers.clearTimeout(this.cooldown)
		this.cooldown = null
		if (this.cooldownS > 0) {
			this.cooldown = this.timers.setTimeout(() => {
				this.cooldown = null
				this.opts.onArmed(true)
			}, this.cooldownS * 1000)
		}
		if (wasArmed !== this.armed) this.opts.onArmed(this.armed)
	}

	/** New settings from the connection config; a running blink picks up the new rate at once. */
	configure(hz: number, cooldownS: number): void {
		this.hz = clampTalkFlashHz(hz)
		this.cooldownS = clampTalkFlashCooldown(cooldownS)
		if (this.blink) {
			this.stopBlink()
			this.startBlink()
		}
	}

	stop(): void {
		this.stopBlink()
		if (this.cooldown) this.timers.clearTimeout(this.cooldown)
		this.cooldown = null
	}

	private startBlink(): void {
		// One full blink — lit then dark — per 1/hz seconds.
		this.blink = this.timers.setInterval(() => {
			this.phaseOn = !this.phaseOn
			this.opts.onLit()
		}, 500 / this.hz)
	}

	private stopBlink(): void {
		if (this.blink) this.timers.clearInterval(this.blink)
		this.blink = null
	}
}
