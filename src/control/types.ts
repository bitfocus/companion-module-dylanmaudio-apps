/**
 * Wire shapes of the `/ctl/v1/` control API. The authority is
 * fixtures/control/exchanges.json, vendored from the monorepo, whose
 * shared/control_api.py serves it.
 */

export type ControlKind = 'action' | 'toggle' | 'choice' | 'number' | 'text'
export type StateType = 'bool' | 'enum' | 'number' | 'string'
export type StateValue = boolean | number | string | null
export type Safety = 'normal' | 'critical'

export interface ControlDef {
	id: string
	label: string
	kind: ControlKind
	/** the state key this control drives, when it has one */
	state?: string
	/** choice only: [id, label] pairs */
	choices?: [string, string][]
	min?: number
	max?: number
	step?: number
	/** text only: the whole value must match */
	pattern?: string
	/** "critical", or per value — {"off": "critical"} for a toggle, {<choice>: …} for a choice */
	safety?: Safety | Record<string, Safety>
	/**
	 * A bool state key. Advisory only: the server does not enforce it, and an
	 * app that cannot act refuses the press itself, with its own reason.
	 */
	enabled_when?: string
	group?: string
}

export interface StateKeyDef {
	key: string
	label: string
	type: StateType
	/** enum only */
	values?: string[]
	unit?: string
	max_rate_hz?: number
}

export interface Catalogue {
	v?: number
	app: string
	name: string
	version?: string
	hash: string
	controls: ControlDef[]
	state: StateKeyDef[]
}

export interface CtlInfo {
	v: number
	/** the control API version — must equal CTL_API_VERSION */
	ctl: number
	app: string
	name: string
	version: string
	catalogue_hash: string
	/** the app's "Allow Companion control" switch */
	allowed: boolean
	/** the app's "Lock show-critical controls" switch */
	locked: boolean
	seq: number
}

/**
 * The value a /cmd body carries, by kind (shared/control_api.py `_resolve`):
 * nothing for an action; "on" / "off" / "toggle" for a toggle; a choice id
 * or "next" for a choice; a number or {"nudge": steps} for a number; a
 * string for text.
 */
export type CmdValue = 'on' | 'off' | 'toggle' | string | number | { nudge: number }

/** What a press came back with. When refused, `code` is the server's error code. */
export interface CmdResult {
	ok: boolean
	/** HTTP status, or 0 when nothing answered */
	status: number
	value?: unknown
	code?: string
	message?: string
}
