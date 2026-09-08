/**
 * Control changes our own apps use to signal the console, and each other.
 *
 * These are ordinary user-assigned CCs on the console's base MIDI channel —
 * the console attaches no meaning to them. They are listed here so that the
 * module can label what it sees rather than reporting "CC 85 = 127", and so
 * that nothing else in the family claims the same number by accident.
 *
 * The console broadcasts every client's writes to every other client
 * (§3.2), which is what makes this work at all: Pilot Tone Trigger writes
 * CC 85 to the desk, and Companion sees it without either app knowing about
 * the other.
 */

export interface AppCc {
	app: string
	label: string
	/** what the two values mean, in the app's own words */
	on: string
	off: string
}

export const APP_CC: Record<number, AppCc> = {
	85: { app: 'ptt', label: 'Pilot Tone Trigger', on: 'tone present', off: 'tone lost' },
	86: { app: 'tlt', label: 'Talk Light Trigger', on: 'talking', off: 'clear' },
}

/** The app signal a CC carries, or undefined — base channel only. */
export function appCc(cc: number): AppCc | undefined {
	return APP_CC[cc]
}

/** "Pilot Tone Trigger: tone lost" — for logs and variables. */
export function describeAppCc(cc: number, value: number): string | undefined {
	const a = APP_CC[cc]
	return a ? `${a.label}: ${value >= 0x40 ? a.on : a.off}` : undefined
}
