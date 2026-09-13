/**
 * Catalogue → Companion definitions (brief-companion-control.md §2.2).
 *
 * Every control becomes an action, every bool and enum state key a
 * feedback, and every state key a variable, with presets built from the same
 * list. Nothing here knows any particular app: a control an app adds in an
 * update arrives in its catalogue and appears in Companion without a module
 * release.
 *
 * Ids come from the catalogue's own ids, which are stable across app
 * versions, so buttons built on them survive an app update. Dots become a
 * double underscore, which cannot collide with an id that already contains
 * an underscore.
 */

import {
	combineRgb,
	type CompanionActionDefinitions,
	type CompanionFeedbackDefinitions,
	type CompanionOptionValues,
	type CompanionPresetDefinitions,
	type CompanionPresetSection,
	type CompanionVariableDefinitions,
	type CompanionVariableValues,
} from '@companion-module/base'
import type { ActionsSchema } from '../actions.js'
import type { FeedbacksSchema } from '../feedbacks.js'
import type { ModuleSchema } from '../main.js'
import type { VariablesSchema } from '../variables.js'
import type { Catalogue, CmdValue, ControlDef, StateValue } from './types.js'

const WHITE = combineRgb(255, 255, 255)
const DARK = combineRgb(24, 24, 28)
const ON = combineRgb(0, 150, 60)
const CHOSEN = combineRgb(30, 90, 200)

/** Sends a press. The connection logs the app's own reason when it refuses. */
export type Send = (control: string, value?: CmdValue) => Promise<void>

const slug = (id: string): string => id.replace(/\./g, '__')

export const actionId = (control: string): string => `ctl_${slug(control)}`
export const boolFeedbackId = (key: string): string => `st_${slug(key)}`
export const enumFeedbackId = (key: string): string => `st_${slug(key)}__is`

/**
 * A state key's variable id. The app prefix goes, because the connection
 * label already names the app: `ptt.state` reads as $(ptt:state) on a
 * connection labelled ptt.
 */
export function variableId(app: string, key: string): string {
	const local = key.startsWith(`${app}.`) ? key.slice(app.length + 1) : key
	return local.replace(/[^A-Za-z0-9_]/g, '_')
}

/** Connection-level variables, prefixed so no app's state key can collide with them. */
export const META_VARIABLES: Record<string, string> = {
	ctl_connected: 'Connected to the app',
	ctl_allowed: 'Companion control allowed in the app',
	ctl_locked: 'Show-critical controls locked in the app',
	ctl_version: 'App version',
}

// ------------------------------------------------------------------ actions

export function buildControlActions(cat: Catalogue, send: Send): CompanionActionDefinitions<ActionsSchema> {
	const defs: CompanionActionDefinitions<ActionsSchema> = {}
	for (const c of cat.controls) {
		const id = actionId(c.id)
		const description = describeControl(c, cat)
		switch (c.kind) {
			case 'action':
				defs[id] = { name: c.label, description, options: [], callback: async () => send(c.id) }
				break
			case 'toggle':
				defs[id] = {
					name: c.label,
					description,
					options: [
						{
							type: 'dropdown',
							id: 'mode',
							label: 'Set',
							default: 'toggle',
							choices: [
								{ id: 'toggle', label: 'Toggle' },
								{ id: 'on', label: 'On' },
								{ id: 'off', label: 'Off' },
							],
						},
					],
					callback: async (a) => send(c.id, str(a.options, 'mode', 'toggle')),
				}
				break
			case 'choice': {
				const choices = (c.choices ?? []).map(([value, label]) => ({ id: value, label }))
				defs[id] = {
					name: c.label,
					description,
					options: [
						{
							type: 'dropdown',
							id: 'value',
							label: 'Set to',
							default: choices[0]?.id ?? 'next',
							choices: [...choices, { id: 'next', label: 'Next (cycles through them)' }],
						},
					],
					callback: async (a) => send(c.id, str(a.options, 'value', 'next')),
				}
				break
			}
			case 'number': {
				const min = c.min ?? -1_000_000
				const max = c.max ?? 1_000_000
				const nudge = nudgeable(c)
				defs[id] = {
					name: c.label,
					description,
					options: [
						{
							type: 'dropdown',
							id: 'mode',
							label: 'Action',
							default: nudge ? 'nudge' : 'set',
							disableAutoExpression: true,
							choices: [
								{ id: 'set', label: 'Set to a value' },
								...(nudge ? [{ id: 'nudge', label: `Nudge by steps of ${c.step}` }] : []),
							],
						},
						{
							type: 'number',
							id: 'value',
							label: 'Value',
							default: Math.min(max, Math.max(min, 0)),
							min,
							max,
							step: c.step,
							isVisibleExpression: "$(options:mode) == 'set'",
						},
						{
							type: 'number',
							id: 'steps',
							label: 'Steps (negative goes down)',
							default: 1,
							min: -100,
							max: 100,
							step: 1,
							isVisibleExpression: "$(options:mode) == 'nudge'",
						},
					],
					callback: async (a) => {
						if (a.options.mode === 'nudge') await send(c.id, { nudge: num(a.options, 'steps', 1) })
						else await send(c.id, num(a.options, 'value', 0))
					},
				}
				break
			}
			case 'text':
				defs[id] = {
					name: c.label,
					description,
					options: [
						{
							type: 'textinput',
							id: 'value',
							label: 'Value',
							default: '',
							...(c.pattern ? { regex: `/^(?:${c.pattern})$/` } : {}),
						},
					],
					callback: async (a) => send(c.id, str(a.options, 'value', '')),
				}
				break
		}
	}
	return defs
}

/**
 * A nudge moves from the app's current value, so it needs a step and a state
 * key to read that value from. Console Control's marker and region numbers
 * have a step but no state — there is no "current marker" to nudge from —
 * so they are only ever set.
 */
function nudgeable(c: ControlDef): boolean {
	return Boolean(c.step && c.state)
}

/** What makes a control special, for the action's description. */
function describeControl(c: ControlDef, cat: Catalogue): string | undefined {
	const parts: string[] = []
	const LOCK = "refused while the app's Lock show-critical controls switch is on"
	if (c.safety === 'critical') parts.push(`Show-critical: ${LOCK}.`)
	else if (c.safety && typeof c.safety === 'object') {
		const when = Object.entries(c.safety)
			.filter(([, s]) => s === 'critical')
			.map(([v]) => valueLabel(c, v))
		if (when.length) parts.push(`Show-critical when set to ${when.join(' or ')}: ${LOCK}.`)
	}
	if (c.enabled_when) {
		const k = cat.state.find((s) => s.key === c.enabled_when)
		parts.push(`Only acts while "${k?.label ?? c.enabled_when}" is on; otherwise the app refuses it and says why.`)
	}
	return parts.length ? parts.join(' ') : undefined
}

function valueLabel(c: ControlDef, value: string): string {
	if (c.kind === 'toggle') return value === 'on' ? 'On' : value === 'off' ? 'Off' : value
	return c.choices?.find(([v]) => v === value)?.[1] ?? value
}

function str(o: CompanionOptionValues, key: string, dflt: string): string {
	const v = o[key]
	return typeof v === 'string' ? v : dflt
}

function num(o: CompanionOptionValues, key: string, dflt: number): number {
	const v = Number(o[key])
	return Number.isFinite(v) ? v : dflt
}

// ---------------------------------------------------------------- feedbacks

export function buildControlFeedbacks(
	cat: Catalogue,
	get: (key: string) => StateValue,
): CompanionFeedbackDefinitions<FeedbacksSchema> {
	const defs: CompanionFeedbackDefinitions<FeedbacksSchema> = {}
	for (const s of cat.state) {
		if (s.type === 'bool') {
			defs[boolFeedbackId(s.key)] = {
				type: 'boolean',
				name: s.label,
				description: `On while ${s.label} is on, as ${cat.name} reports it`,
				defaultStyle: { bgcolor: ON, color: WHITE },
				options: [],
				callback: () => get(s.key) === true,
			}
		} else if (s.type === 'enum') {
			const labels = valueLabels(cat, s.key)
			const values = s.values ?? []
			defs[enumFeedbackId(s.key)] = {
				type: 'boolean',
				name: `${s.label} is…`,
				description: `On while ${s.label} has the chosen value, as ${cat.name} reports it`,
				defaultStyle: { bgcolor: CHOSEN, color: WHITE },
				options: [
					{
						type: 'dropdown',
						id: 'value',
						label: 'Value',
						default: values[0] ?? '',
						choices: values.map((v) => ({ id: v, label: labels.get(v) ?? v })),
					},
				],
				callback: (fb) => get(s.key) === fb.options.value,
			}
		}
	}
	return defs
}

/** The feedbacks that depend on a state key, for re-checking when it changes. */
export function feedbackIdsForKey(cat: Catalogue, key: string): string[] {
	const s = cat.state.find((k) => k.key === key)
	if (s?.type === 'bool') return [boolFeedbackId(key)]
	if (s?.type === 'enum') return [enumFeedbackId(key)]
	return []
}

/** Readable labels for an enum's values, from a choice control that sets it when there is one. */
function valueLabels(cat: Catalogue, key: string): Map<string, string> {
	const m = new Map<string, string>()
	for (const c of cat.controls)
		if (c.kind === 'choice' && c.state === key) for (const [v, l] of c.choices ?? []) m.set(v, l)
	return m
}

// ---------------------------------------------------------------- variables

export function buildControlVariables(cat: Catalogue): CompanionVariableDefinitions<VariablesSchema> {
	const defs: Record<string, { name: string }> = {}
	for (const [id, name] of Object.entries(META_VARIABLES)) defs[id] = { name }
	for (const s of cat.state) defs[variableId(cat.app, s.key)] = { name: s.unit ? `${s.label} (${s.unit})` : s.label }
	return defs
}

/** State values as variable values: unknown is empty, and a level reads to two decimals. */
export function controlVariableValues(cat: Catalogue, values: Record<string, StateValue>): CompanionVariableValues {
	const out: CompanionVariableValues = {}
	for (const [k, v] of Object.entries(values)) {
		out[variableId(cat.app, k)] =
			v === null ? undefined : typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v
	}
	return out
}

// ------------------------------------------------------------------ presets

export function buildControlPresets(
	cat: Catalogue,
	label: string,
): { sections: CompanionPresetSection<ModuleSchema>[]; presets: CompanionPresetDefinitions<ModuleSchema> } {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const ids: string[] = []
	const variable = (key: string) => `$(${label}:${variableId(cat.app, key)})`
	const style = (text: string) => ({ text, textExpression: false, size: 'auto' as const, color: WHITE, bgcolor: DARK })
	const add = (id: string, p: CompanionPresetDefinitions<ModuleSchema>[string]) => {
		presets[id] = p
		ids.push(id)
	}

	for (const c of cat.controls) {
		const aid = actionId(c.id)
		const pid = `p_${slug(c.id)}`
		switch (c.kind) {
			case 'action':
				add(pid, {
					type: 'simple',
					name: c.label,
					style: style(c.label),
					feedbacks: c.enabled_when
						? [{ feedbackId: boolFeedbackId(c.enabled_when), options: {}, style: { bgcolor: ON, color: WHITE } }]
						: [],
					steps: [{ down: [{ actionId: aid, options: {} }], up: [] }],
				})
				break
			case 'toggle':
				add(pid, {
					type: 'simple',
					name: c.label,
					style: style(c.label),
					feedbacks: c.state
						? [{ feedbackId: boolFeedbackId(c.state), options: {}, style: { bgcolor: ON, color: WHITE } }]
						: [],
					steps: [{ down: [{ actionId: aid, options: { mode: 'toggle' } }], up: [] }],
				})
				break
			case 'choice':
				for (const [value, vlabel] of c.choices ?? []) {
					add(`${pid}__${value}`, {
						type: 'simple',
						name: `${c.label}: ${vlabel}`,
						style: style(vlabel),
						feedbacks: c.state
							? [{ feedbackId: enumFeedbackId(c.state), options: { value }, style: { bgcolor: CHOSEN, color: WHITE } }]
							: [],
						steps: [{ down: [{ actionId: aid, options: { value } }], up: [] }],
					})
				}
				break
			case 'number':
				if (c.state) {
					add(`${pid}__show`, {
						type: 'simple',
						name: `${c.label} (shows the value)`,
						style: style(`${c.label}\n${variable(c.state)}`),
						feedbacks: [],
						steps: [{ down: [], up: [] }],
					})
				}
				if (nudgeable(c)) {
					for (const [dir, steps] of [
						['down', -1],
						['up', 1],
					] as const) {
						add(`${pid}__${dir}`, {
							type: 'simple',
							name: `${c.label} ${steps > 0 ? '+' : '−'}${c.step}`,
							style: style(`${c.label}\n${steps > 0 ? '+' : '−'}${c.step}`),
							feedbacks: [],
							steps: [{ down: [{ actionId: aid, options: { mode: 'nudge', steps, value: 0 } }], up: [] }],
						})
					}
				}
				break
			case 'text':
				break // a value typed per button: no sensible ready-made preset
		}
	}
	const sections: CompanionPresetSection<ModuleSchema>[] = ids.length
		? [{ id: `ctl_${cat.app}`, name: cat.name, definitions: ids }]
		: []
	return { sections, presets }
}
