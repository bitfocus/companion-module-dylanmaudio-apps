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
		mode = new ControlAppMode(host as never, 'tlt', '127.0.0.1', mock.port, { talkFlashHz: 2, talkFlashCooldownS: 10 })
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
		expect(Object.keys(host.variableDefs)).toEqual(expect.arrayContaining(['talk_active', 'talk_flash_armed', 'talk']))
		expect(host.presets[TALK_FLASH_PRESET]).toBeDefined()
		expect(host.vars).toMatchObject({ talk_active: false, talk_flash_armed: true })
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

	it('EXIT disarms the next takeover', async () => {
		await host.actions[TALK_FLASH_EXIT]?.callback()
		expect(host.vars.talk_flash_armed).toBe(false)
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

describe('a Pilot Tone Trigger connection', () => {
	it('has no talk flash', async () => {
		const mock = new CtlMock(load('ptt.json'))
		await mock.start()
		const host = fakeHost('ptt')
		const mode = new ControlAppMode(host as never, 'ptt', '127.0.0.1', mock.port, {
			talkFlashHz: 2,
			talkFlashCooldownS: 10,
		})
		mode.start()
		await waitFor(() => 'ctl_ptt__failback_mode' in host.actions, 'catalogue defined')
		expect(mode.flash).toBeNull()
		expect(host.actions[TALK_FLASH_EXIT]).toBeUndefined()
		expect(host.variableDefs).not.toHaveProperty('talk_active')
		mode.stop()
		await mock.stop()
	})
})
