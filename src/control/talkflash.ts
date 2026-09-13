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
/**
 * The TALK page number until the user sets it: 0, off. Companion numbers
 * pages 1…n as they are added, so no default could be right for everyone —
 * and with the page unset, a talk takes no deck over, so "Talk end" never
 * sends a deck "back" from a page it didn't leave.
 */
export const TALK_FLASH_DEFAULT_PAGE = 0

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
	/** `talk_flash_exited` changed. */
	onExited?(exited: boolean): void
	/** `talk_flash_took_over` changed. */
	onTookOver?(tookOver: boolean): void
	/** Whether a talk may take the decks over at all (the TALK page is set). Default yes. */
	canTakeOver?(): boolean
	timers?: Timers
}

export class TalkFlash {
	private talking = false
	private phaseOn = false
	private exitedThisTalk = false
	private tookOverThisTalk = false
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

	/**
	 * EXIT was pressed during this talk. The "Talk end" trigger reads it so a
	 * deck that already went back is not sent back a second page. It covers one
	 * deck exactly; with several, one EXIT stands for all of them — Companion's
	 * per-deck "on page" condition needs a deck serial, which an importable file
	 * cannot carry.
	 */
	get exited(): boolean {
		return this.exitedThisTalk
	}

	/**
	 * The talk that started most recently found the flash armed, so the "Talk
	 * start" trigger took the decks over. "Talk end" requires it: without it, a
	 * deck the cooldown left alone would be sent back a page it never left.
	 */
	get tookOver(): boolean {
		return this.tookOverThisTalk
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
			this.setExited(false) // a new talk takes every deck again
			this.setTookOver(this.armed && (this.opts.canTakeOver?.() ?? true))
			this.startBlink()
		} else {
			this.stopBlink()
			this.phaseOn = false
		}
		this.opts.onLit()
	}

	/** EXIT pressed: hold off the next takeover for the cooldown. A second press restarts it. */
	exit(): void {
		this.setExited(true)
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

	private setTookOver(v: boolean): void {
		if (v === this.tookOverThisTalk) return
		this.tookOverThisTalk = v
		this.opts.onTookOver?.(v)
	}

	private setExited(exited: boolean): void {
		if (exited === this.exitedThisTalk) return
		this.exitedThisTalk = exited
		this.opts.onExited?.(exited)
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
