/**
 * Catalogue → Companion definitions. The shipping apps' real catalogues come
 * first; the demo contract below them covers the kinds no shipping app uses
 * yet (a text control). The important tests are the wire ones: each kind of
 * action must put exactly the value on the wire that fixtures/control pins.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	actionId,
	boolFeedbackId,
	buildControlActions,
	buildControlFeedbacks,
	buildControlPresets,
	buildControlVariables,
	controlVariableValues,
	enumFeedbackId,
	feedbackIdsForKey,
	variableId,
} from './definitions.js'
import type { Catalogue, CmdValue, StateValue } from './types.js'

const here = dirname(fileURLToPath(import.meta.url))
const fx = JSON.parse(readFileSync(join(here, '..', '..', 'fixtures', 'control', 'exchanges.json'), 'utf8')) as {
	app: { id: string; name: string; version: string }
	catalogue: Pick<Catalogue, 'controls' | 'state'>
	initial_state: Record<string, StateValue>
	cases: { id: string; request: { body?: { control?: string; value?: CmdValue } } }[]
}
const cat: Catalogue = { app: fx.app.id, name: fx.app.name, version: fx.app.version, hash: 'h', ...fx.catalogue }

function wire(caseId: string): { control?: string; value?: CmdValue } {
	const c = fx.cases.find((x) => x.id === caseId)
	if (!c?.request.body) throw new Error(`no body for ${caseId}`)
	return { control: c.request.body.control, value: c.request.body.value }
}

/** Run an action's callback with these options and return what it sent. */
async function press(id: string, options: Record<string, unknown>): Promise<{ control: string; value?: CmdValue }> {
	const sent: { control: string; value?: CmdValue }[] = []
	const defs = buildControlActions(cat, async (control, value) => {
		sent.push({ control, value })
	})
	const def = defs[id]
	if (!def) throw new Error(`no action ${id}`)
	await def.callback({ options } as never, {} as never)
	return sent[0]
}

function options(id: string): { id: string; [k: string]: unknown }[] {
	const def = buildControlActions(cat, async () => undefined)[id]
	if (!def) throw new Error(`no action ${id}`)
	return def.options as unknown as { id: string; [k: string]: unknown }[]
}

describe('actions', () => {
	it('each kind puts on the wire exactly what the fixture pins', async () => {
		expect(await press(actionId('demo.run'), { mode: 'on' })).toEqual(wire('cmd.toggle.on'))
		expect(await press(actionId('demo.run'), { mode: 'toggle' })).toEqual(wire('cmd.toggle.flip'))
		expect(await press(actionId('demo.run'), { mode: 'off' })).toEqual(wire('cmd.locked.toggle_off_refused'))
		expect(await press(actionId('demo.mode'), { value: 'next' })).toEqual(wire('cmd.choice.next'))
		expect(await press(actionId('demo.mode'), { value: 'auto' })).toEqual(wire('cmd.locked.critical'))
		expect(await press(actionId('demo.threshold'), { mode: 'nudge', steps: 1 })).toEqual(wire('cmd.number.nudge'))
		expect(await press(actionId('demo.threshold'), { mode: 'set', value: 5 })).toEqual(wire('cmd.number.out_of_range'))
		expect(await press(actionId('demo.start_tc'), { value: '01:00:00:00' })).toEqual(wire('cmd.text.ok'))
		expect(await press(actionId('demo.reset'), {})).toEqual(wire('cmd.action.refused'))
	})

	it('one action per control, with ids that survive an app update', () => {
		expect(Object.keys(buildControlActions(cat, async () => undefined)).sort()).toEqual(
			['ctl_demo__mode', 'ctl_demo__reset', 'ctl_demo__run', 'ctl_demo__start_tc', 'ctl_demo__threshold'].sort(),
		)
	})

	it('offers each kind the choices its wire format accepts', () => {
		expect((options(actionId('demo.run'))[0].choices as { id: string }[]).map((c) => c.id)).toEqual([
			'toggle',
			'on',
			'off',
		])
		expect(options(actionId('demo.mode'))[0].choices).toEqual([
			{ id: 'auto', label: 'Automatic' },
			{ id: 'latch', label: 'Latch until Reset' },
			{ id: 'next', label: 'Next (cycles through them)' },
		])
		const [mode, value, steps] = options(actionId('demo.threshold'))
		expect(mode).toMatchObject({ id: 'mode', default: 'nudge', disableAutoExpression: true })
		expect(value).toMatchObject({
			id: 'value',
			min: -60,
			max: 0,
			step: 1,
			isVisibleExpression: "$(options:mode) == 'set'",
		})
		expect(steps).toMatchObject({ id: 'steps', isVisibleExpression: "$(options:mode) == 'nudge'" })
	})

	it("checks a text value against the app's own pattern", () => {
		const rx = options(actionId('demo.start_tc'))[0].regex as string
		const re = new RegExp(rx.slice(1, -1))
		expect(re.test(wire('cmd.text.ok').value as string)).toBe(true)
		expect(re.test(wire('cmd.text.bad_value').value as string)).toBe(false)
	})

	it('says which controls are show-critical, and which the app may refuse', () => {
		const defs = buildControlActions(cat, async () => undefined)
		expect(defs[actionId('demo.mode')]?.description).toMatch(/^Show-critical:/)
		expect(defs[actionId('demo.run')]?.description).toMatch(/Show-critical when set to Off/)
		expect(defs[actionId('demo.reset')]?.description).toMatch(/"Reset available"/)
		expect(defs[actionId('demo.threshold')]?.description).toBeUndefined()
	})
})

describe('feedbacks', () => {
	const values: Record<string, StateValue> = { ...fx.initial_state }
	const defs = buildControlFeedbacks(cat, (k) => values[k] ?? null)

	it('one per bool and enum state key; numbers and text become variables only', () => {
		expect(Object.keys(defs).sort()).toEqual(
			[
				boolFeedbackId('demo.running'),
				boolFeedbackId('demo.reset_available'),
				enumFeedbackId('demo.mode'),
				enumFeedbackId('demo.state'),
			].sort(),
		)
	})

	it('names enum values the way the choice control that sets them does', () => {
		const opts = defs[enumFeedbackId('demo.mode')]?.options as unknown as { choices: unknown }[]
		expect(opts[0].choices).toEqual([
			{ id: 'auto', label: 'Automatic' },
			{ id: 'latch', label: 'Latch until Reset' },
		])
	})

	it('reads the current value', () => {
		const run = defs[boolFeedbackId('demo.running')]
		const mode = defs[enumFeedbackId('demo.mode')]
		if (run?.type !== 'boolean' || mode?.type !== 'boolean') throw new Error('expected boolean feedbacks')
		expect(run.callback({ options: {} }, {})).toBe(false)
		values['demo.running'] = true
		expect(run.callback({ options: {} }, {})).toBe(true)
		expect(mode.callback({ options: { value: 'auto' } }, {})).toBe(true)
		expect(mode.callback({ options: { value: 'latch' } }, {})).toBe(false)
	})

	it('knows which feedbacks a changed key touches', () => {
		expect(feedbackIdsForKey(cat, 'demo.running')).toEqual([boolFeedbackId('demo.running')])
		expect(feedbackIdsForKey(cat, 'demo.state')).toEqual([enumFeedbackId('demo.state')])
		expect(feedbackIdsForKey(cat, 'demo.level_db')).toEqual([])
		expect(feedbackIdsForKey(cat, 'demo.nope')).toEqual([])
	})
})

describe('variables', () => {
	it('one per state key, named without the app prefix, plus the connection meta', () => {
		const defs = buildControlVariables(cat) as Record<string, { name: string }>
		expect(Object.keys(defs).sort()).toEqual(
			[
				'ctl_allowed',
				'ctl_connected',
				'ctl_locked',
				'ctl_version',
				'level_db',
				'mode',
				'reset_available',
				'running',
				'state',
				'threshold_db',
			].sort(),
		)
		expect(defs.threshold_db.name).toBe('Threshold (dB)')
		expect(variableId('ptt', 'ptt.state')).toBe('state')
		expect(variableId('tct', 'tct.tc.hours')).toBe('tc_hours')
	})

	it('shows unknown as empty and a level to two decimals', () => {
		expect(
			controlVariableValues(cat, {
				'demo.level_db': null,
				'demo.threshold_db': -44.123456,
				'demo.mode': 'latch',
				'demo.running': true,
			}),
		).toEqual({
			level_db: undefined,
			threshold_db: -44.12,
			mode: 'latch',
			running: true,
		})
	})
})

describe('presets', () => {
	const { sections, presets } = buildControlPresets(cat, 'demo')

	it('a button per control, lit by its own state', () => {
		const run = presets['p_demo__run']
		expect(run).toMatchObject({ type: 'simple', name: 'Run' })
		expect(JSON.stringify(run)).toContain(boolFeedbackId('demo.running'))
		for (const v of ['auto', 'latch']) {
			const p = presets[`p_demo__mode__${v}`]
			expect(JSON.stringify(p)).toContain(enumFeedbackId('demo.mode'))
			expect(JSON.stringify(p)).toContain(`"value":"${v}"`)
		}
		expect(JSON.stringify(presets['p_demo__reset'])).toContain(boolFeedbackId('demo.reset_available'))
	})

	it("numbers get a readout of the app's value and nudges both ways", () => {
		expect(JSON.stringify(presets['p_demo__threshold__show'])).toContain('$(demo:threshold_db)')
		expect(JSON.stringify(presets['p_demo__threshold__up'])).toContain('"steps":1')
		expect(JSON.stringify(presets['p_demo__threshold__down'])).toContain('"steps":-1')
	})

	it('no preset for free text, and one section holding the rest', () => {
		expect(Object.keys(presets).some((k) => k.startsWith('p_demo__start_tc'))).toBe(false)
		expect(sections).toEqual([{ id: 'ctl_demo', name: 'Demo App', definitions: Object.keys(presets) }])
	})
})

// ------------------------------------------------------- the shipping apps

type Fx = typeof fx
function loadFx(file: string): { fx: Fx; cat: Catalogue } {
	const f = JSON.parse(readFileSync(join(here, '..', '..', 'fixtures', 'control', file), 'utf8')) as Fx
	return { fx: f, cat: { app: f.app.id, name: f.app.name, version: f.app.version, hash: 'h', ...f.catalogue } }
}
function wireIn(f: Fx, caseId: string): { control?: string; value?: CmdValue } {
	const c = f.cases.find((x) => x.id === caseId)
	if (!c?.request.body) throw new Error(`no body for ${caseId}`)
	return { control: c.request.body.control, value: c.request.body.value }
}
async function pressIn(
	c: Catalogue,
	id: string,
	opts: Record<string, unknown>,
): Promise<{ control: string; value?: CmdValue }> {
	const sent: { control: string; value?: CmdValue }[] = []
	const def = buildControlActions(c, async (control, value) => {
		sent.push({ control, value })
	})[id]
	if (!def) throw new Error(`no action ${id}`)
	await def.callback({ options: opts } as never, {} as never)
	return sent[0]
}

describe('Pilot Tone Trigger (fixtures/control/ptt.json)', () => {
	const { fx: pf, cat: pc } = loadFx('ptt.json')

	it('each control puts on the wire exactly what the fixture pins', async () => {
		expect(await pressIn(pc, 'ctl_ptt__run', { mode: 'on' })).toEqual(wireIn(pf, 'cmd.run.on'))
		expect(await pressIn(pc, 'ctl_ptt__failback_mode', { value: 'next' })).toEqual(wireIn(pf, 'cmd.failback_mode.next'))
		expect(await pressIn(pc, 'ctl_ptt__failback_mode', { value: 'auto' })).toEqual(
			wireIn(pf, 'cmd.failback_mode.locked'),
		)
		expect(await pressIn(pc, 'ctl_ptt__reset', {})).toEqual(wireIn(pf, 'cmd.reset.noop_when_stopped'))
		expect(await pressIn(pc, 'ctl_ptt__tone', { mode: 'toggle' })).toEqual(wireIn(pf, 'cmd.tone.toggle'))
	})

	it('Automatic and Latch are named as the app names them, and the mode is marked show-critical', () => {
		const a = buildControlActions(pc, async () => undefined)
		const opts = a.ctl_ptt__failback_mode?.options as unknown as { choices: unknown }[]
		expect(opts[0].choices).toEqual([
			{ id: 'auto', label: 'Automatic' },
			{ id: 'latch', label: 'Latch until Reset' },
			{ id: 'next', label: 'Next (cycles through them)' },
		])
		expect(a.ctl_ptt__failback_mode?.description).toMatch(/^Show-critical:/)
		expect(a.ctl_ptt__run?.description).toMatch(/Show-critical when set to Off/)
		expect(a.ctl_ptt__reset?.description).toMatch(/"Reset available"/)
	})

	it('feedbacks, variables and presets for the state it reports', () => {
		expect(Object.keys(buildControlFeedbacks(pc, () => null)).sort()).toEqual(
			[
				'st_ptt__failback_mode__is',
				'st_ptt__reset_available',
				'st_ptt__running',
				'st_ptt__state__is',
				'st_ptt__tone_running',
			].sort(),
		)
		const vars = Object.keys(buildControlVariables(pc)).filter((k) => !k.startsWith('ctl_'))
		expect(vars.sort()).toEqual(
			['failback_mode', 'level_db', 'reset_available', 'running', 'state', 'tone_running'].sort(),
		)
		const { presets } = buildControlPresets(pc, 'ptt')
		expect(Object.keys(presets).sort()).toEqual(
			['p_ptt__failback_mode__auto', 'p_ptt__failback_mode__latch', 'p_ptt__reset', 'p_ptt__run', 'p_ptt__tone'].sort(),
		)
	})
})

describe('Talk Light Trigger (fixtures/control/tlt.json)', () => {
	const { fx: tf, cat: tc } = loadFx('tlt.json')

	it('each control puts on the wire exactly what the fixture pins', async () => {
		expect(await pressIn(tc, 'ctl_tlt__run', { mode: 'on' })).toEqual(wireIn(tf, 'cmd.toggle.on'))
		expect(await pressIn(tc, 'ctl_tlt__run', { mode: 'toggle' })).toEqual(wireIn(tf, 'cmd.toggle.flip'))
		expect(await pressIn(tc, 'ctl_tlt__run', { mode: 'off' })).toEqual(wireIn(tf, 'cmd.locked.toggle_off_refused'))
		expect(await pressIn(tc, 'ctl_tlt__threshold', { mode: 'nudge', steps: 1 })).toEqual(wireIn(tf, 'cmd.number.nudge'))
		expect(await pressIn(tc, 'ctl_tlt__threshold', { mode: 'set', value: 10 })).toEqual(
			wireIn(tf, 'cmd.number.out_of_range'),
		)
	})

	it('talk state is a feedback, and the threshold a readout with ±1 dB nudges', () => {
		expect(Object.keys(buildControlFeedbacks(tc, () => null)).sort()).toEqual(['st_tlt__running', 'st_tlt__talk__is'])
		const { presets } = buildControlPresets(tc, 'tlt')
		expect(JSON.stringify(presets.p_tlt__threshold__show)).toContain('$(tlt:threshold_db)')
		expect(Object.keys(presets)).toEqual(
			expect.arrayContaining(['p_tlt__run', 'p_tlt__threshold__up', 'p_tlt__threshold__down']),
		)
	})
})
