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

/**
 * The control presets: what a key's colour means when it lights, and each
 * app menu's tint (Console Control's groups). White text reads on them all.
 */
export const KEY = {
	/** a key outside any menu */
	base: hex('#262626'),
	/** a readout */
	tile: hex('#333333'),
	/** on, or going well: a toggle that's on, playing, chase */
	on: hex('#1f8f4e'),
	/** the chosen option: the app's selected segment */
	chosen: PALETTE.accent,
	/** needs a look: available, armed, unsaved, Show mode */
	attention: hex('#b36b00'),
	/** stop and look: recording, offline, Panic */
	alarm: hex('#b3261e'),
	/** the bar across a show-critical key */
	critical: PALETTE.red,
} as const

export const GROUP_TINT: Record<string, number> = {
	transport: hex('#14213d'),
	cue: hex('#173a2a'),
	navigate: hex('#1d2f4a'),
	markers: hex('#2d1f47'),
	edit: hex('#3a2a14'),
	audio: hex('#123636'),
	track: hex('#2b2340'),
	view: hex('#22303a'),
}

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
