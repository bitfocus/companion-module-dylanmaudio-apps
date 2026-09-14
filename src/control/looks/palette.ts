/**
 * The apps' own colours, so keys read like the popovers they mirror. From
 * the monorepo's shared/ui/design-system.css and each app's ui/app.css.
 * Gradients are flattened to their leading colour: a key is one fill.
 */

const hex = (s: string): number => parseInt(s.replace('#', ''), 16)

export const PALETTE = {
	/** --bg-window */
	window: hex('#12121a'),
	/** --control-bg */
	control: hex('#1a1a26'),
	/** --text-secondary */
	textSecondary: hex('#b7b7c4'),
	/** --text-muted */
	textMuted: hex('#6b6b78'),
	/** --accent: the selected segment of a segmented control */
	accent: hex('#2e80f2'),
	/** --good */
	good: hex('#4ec972'),
	/** --amber: Pilot Tone's latched state */
	amber: hex('#e8a94a'),
	/** --red */
	red: hex('#e85c5c'),
	white: hex('#ffffff'),
	/** dark text on a lit shape */
	ink: hex('#12121a'),
} as const

/** Pilot Tone's status tile, per state (apps/pilot-tone-trigger/ui/app.css, app.js STATE_COPY). */
export const PTT_TILE = {
	stopped: { fill: hex('#1c1c28'), text: hex('#8a8a99'), label: 'Stopped' },
	ok: { fill: hex('#1c2a3f'), text: hex('#8fb3e0'), label: 'Signal Present' },
	lost: { fill: PALETTE.red, text: PALETTE.white, label: 'Signal Lost' },
	latched: { fill: PALETTE.amber, text: PALETTE.white, label: 'Restored — Latched' },
} as const

/** Level-meter fill per app and state, from each app's menu-bar ICON_COLOURS. */
export const METER = {
	tlt: { base: hex('#5c8fd6'), states: { key: 'tlt.talk', colours: { active: hex('#e8f0ff') } } },
	ptt: {
		base: hex('#5c8fd6'),
		states: { key: 'ptt.state', colours: { lost: hex('#e85c5c'), latched: hex('#e8a94a') } },
	},
	tct: {
		base: hex('#3fb65c'),
		states: { key: 'tct.state', colours: { freewheel: hex('#e0a93f'), clip: hex('#e8503f') } },
	},
} as const
