/**
 * A Talk Light connection end to end, minus Companion: the mode against a
 * server built from Talk Light's real catalogue, with a fake host standing in
 * for the instance. This is where the talk flash meets the app's talk state.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CtlMock, load, waitFor } from '../../test/ctlmock.js'
import { ControlAppMode } from './mode.js'
import { TALK_FLASH_EXIT, TALK_FLASH_FEEDBACK, TALK_FLASH_PRESET } from './talkflash-defs.js'

type Defs = Record<string, { callback: (...a: never[]) => unknown } | undefined>

function fakeHost(label: string) {
	const h = {
		label,
		actions: {} as Defs,
		feedbacks: {} as Defs,
		variableDefs: {} as Record<string, unknown>,
		vars: {} as Record<string, unknown>,
		presets: {} as Record<string, unknown>,
		checked: [] as string[],
		statuses: [] as string[],
		logs: [] as string[],
		log: (_l: string, m: string) => h.logs.push(m),
		updateStatus: (s: string) => h.statuses.push(s),
		setActionDefinitions: (d: Defs) => (h.actions = d),
		setFeedbackDefinitions: (d: Defs) => (h.feedbacks = d),
		setVariableDefinitions: (d: Record<string, unknown>) => (h.variableDefs = d),
		setVariableValues: (v: Record<string, unknown>) => Object.assign(h.vars, v),
		setPresetDefinitions: (_s: unknown, p: Record<string, unknown>) => (h.presets = p),
		checkFeedbacks: (...ids: string[]) => h.checked.push(...ids),
	}
	return h
}

describe('a Talk Light Trigger connection', () => {
	let mock: CtlMock
	let host: ReturnType<typeof fakeHost>
	let mode: ControlAppMode

	beforeEach(async () => {
		mock = new CtlMock(load('tlt.json'))
		await mock.start()
		host = fakeHost('tlt')
		mode = new ControlAppMode(host as never, 'tlt', '127.0.0.1', mock.port, {
			talkFlashHz: 2,
			talkFlashCooldownS: 10,
			talkFlashPage: 99,
		})
		mode.start()
		await waitFor(() => 'ctl_tlt__run' in host.actions, 'catalogue defined')
	})
	afterEach(async () => {
		mode.stop()
		await mock.stop()
	})

	it('defines the talk flash alongside the app catalogue', () => {
		expect(host.actions[TALK_FLASH_EXIT]).toBeDefined()
		expect(host.feedbacks[TALK_FLASH_FEEDBACK]).toBeDefined()
		expect(host.feedbacks.st_tlt__talk__is).toBeDefined()
		expect(Object.keys(host.variableDefs)).toEqual(
			expect.arrayContaining(['talk_active', 'talk_flash_armed', 'talk_flash_exited', 'talk']),
		)
		expect(host.presets[TALK_FLASH_PRESET]).toBeDefined()
		expect(host.vars).toMatchObject({
			talk_active: false,
			talk_flash_armed: true,
			talk_flash_exited: false,
			talk_flash_took_over: false,
			talk_page: 99,
		})
	})

	it('flashes while Talk Light reports talk, and stops when it goes quiet', async () => {
		await waitFor(() => mock.requests.some((r) => r.path === '/ctl/v1/stream'), 'stream')
		mock.publish('tlt.talk', 'active')
		await waitFor(() => host.vars.talk_active === true, 'talk_active')
		expect(mode.flash?.lit).toBe(true)
		const before = host.checked.filter((id) => id === TALK_FLASH_FEEDBACK).length
		await waitFor(() => host.checked.filter((id) => id === TALK_FLASH_FEEDBACK).length >= before + 2, 'blinking')
		mock.publish('tlt.talk', 'quiet')
		await waitFor(() => host.vars.talk_active === false, 'quiet')
		expect(mode.flash?.lit).toBe(false)
	})

	it('EXIT disarms the next takeover and marks the talk as exited', async () => {
		expect(host.vars.talk_flash_exited).toBe(false)
		await host.actions[TALK_FLASH_EXIT]?.callback()
		expect(host.vars.talk_flash_armed).toBe(false)
		expect(host.vars.talk_flash_exited).toBe(true)
	})

	it('stops flashing when Talk Light goes away mid-talk', async () => {
		await waitFor(() => mock.requests.some((r) => r.path === '/ctl/v1/stream'), 'stream')
		mock.publish('tlt.talk', 'active')
		await waitFor(() => host.vars.talk_active === true, 'talk_active')
		await mock.stop()
		await waitFor(() => host.vars.talk_active === false, 'flash stopped with the app')
		expect(mode.flash?.lit).toBe(false)
	})
})

const OPTS = { talkFlashHz: 2, talkFlashCooldownS: 10, talkFlashPage: 0 }

describe('a Pilot Tone Trigger connection', () => {
	it('has no talk flash', async () => {
		const mock = new CtlMock(load('ptt.json'))
		await mock.start()
		const host = fakeHost('ptt')
		const mode = new ControlAppMode(host as never, 'ptt', '127.0.0.1', mock.port, OPTS)
		mode.start()
		await waitFor(() => 'ctl_ptt__failback_mode' in host.actions, 'catalogue defined')
		expect(mode.flash).toBeNull()
		expect(host.actions[TALK_FLASH_EXIT]).toBeUndefined()
		expect(host.variableDefs).not.toHaveProperty('talk_active')
		mode.stop()
		await mock.stop()
	})
})

describe('a Time Code Tool connection', () => {
	it('follows the timecode, digit by digit, into variables', async () => {
		const mock = new CtlMock(load('tct.json'))
		await mock.start()
		const host = fakeHost('tct')
		const mode = new ControlAppMode(host as never, 'tct', '127.0.0.1', mock.port, OPTS)
		mode.start()
		await waitFor(() => mock.requests.some((r) => r.path === '/ctl/v1/stream'), 'stream')
		mock.publish('tct.state', 'locked')
		mock.publish('tct.tc_h', 10)
		mock.publish('tct.tc_f', 12)
		mock.publish('tct.timecode', '10:00:00:12')
		await waitFor(() => host.vars.timecode === '10:00:00:12', 'timecode')
		expect(host.vars).toMatchObject({ state: 'locked', tc_h: 10, tc_f: 12 })
		expect(host.checked).toContain('st_tct__state__is')
		mode.stop()
		await mock.stop()
	})
})

describe('a Console Control connection', () => {
	it("logs the app's own reason when it refuses, word for word", async () => {
		const mock = new CtlMock(load('cxc.json'))
		await mock.start()
		const host = fakeHost('cxc')
		const mode = new ControlAppMode(host as never, 'cxc', '127.0.0.1', mock.port, OPTS)
		mode.start()
		await waitFor(() => 'ctl_cxc__go-to-marker' in host.actions, 'catalogue defined')
		await host.actions['ctl_cxc__go-to-marker']?.callback({ options: { mode: 'set', value: 9 } } as never)
		const reason = 'Show Mode: Go to Marker is not available with no markers.'
		await waitFor(() => host.logs.some((m) => m.includes(reason)), 'refusal logged')
		mode.stop()
		await mock.stop()
	})
})
