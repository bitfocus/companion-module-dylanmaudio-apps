import { describe, expect, it } from 'vitest'
import { load } from '../../test/ctlmock.js'
import { APP_BUNDLE_IDS, openApp, openAppActions, type OpenAppContext } from './openapp.js'
import type { Catalogue } from './types.js'

const tlt = (): Catalogue => {
	const fx = load('tlt.json')
	return { app: 'tlt', name: 'Talk Light Trigger', version: 'x', hash: 'h', ...fx.catalogue } as Catalogue
}

function context(over: Partial<OpenAppContext>) {
	const calls = { launched: [] as string[], pressed: [] as string[], logs: [] as string[] }
	const ctx: OpenAppContext = {
		app: 'tlt',
		running: () => false,
		catalogue: () => null,
		press: async (c) => void calls.pressed.push(c),
		log: (_level, m) => void calls.logs.push(m),
		launch: async (id) => void calls.launched.push(id),
		...over,
	}
	return { ctx, calls }
}

describe('Open <app>', () => {
	it('starts the installed app when it is not running', async () => {
		const { ctx, calls } = context({})
		await openApp(ctx)
		expect(calls.launched).toEqual([APP_BUNDLE_IDS.tlt])
		expect(calls.logs).toEqual(['Starting Talk Light Trigger'])
	})

	it('asks a running app to show itself, when it offers a show control', async () => {
		const { ctx, calls } = context({ running: () => true, catalogue: tlt })
		await openApp(ctx)
		expect(calls.pressed).toEqual(['tlt.show'])
		expect(calls.launched).toEqual([])
	})

	it('never starts a running app a second time, even one without a show control', async () => {
		const older = { ...tlt(), controls: tlt().controls.filter((c) => c.id !== 'tlt.show') }
		const { ctx, calls } = context({ running: () => true, catalogue: () => older })
		await openApp(ctx)
		expect(calls.launched).toEqual([])
		expect(calls.pressed).toEqual([])
		expect(calls.logs[0]).toMatch(/already running/)
	})

	it("says so when the app isn't installed", async () => {
		const { ctx, calls } = context({ launch: async () => Promise.reject(new Error('not found')) })
		await openApp(ctx)
		expect(calls.logs[0]).toMatch(/isn't installed on this Mac/)
	})

	it('is one action, named for the app', () => {
		const { ctx } = context({})
		expect(Object.keys(openAppActions(ctx))).toEqual(['open_app'])
		expect(openAppActions(ctx).open_app?.name).toBe('Open Talk Light Trigger')
	})
})
