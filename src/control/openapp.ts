/**
 * "Open <app>": the action behind the logo and menu-bar keys.
 *
 * While the app answers on its control endpoint, it is asked to show itself
 * through its catalogue's `<app>.show` control, if it has one. It is never
 * launched a second time: a copy run from source, or an older install,
 * would clash with the running one on its ports. While it doesn't answer,
 * macOS starts the installed app by its bundle id (`open -b`), which is why
 * the module declares the child-process permission.
 */

import { execFile } from 'node:child_process'
import type { buildControlActions } from './definitions.js'
import { CONTROL_APPS, type AppId } from './registry.js'
import type { Catalogue } from './types.js'

export const OPEN_APP_ACTION = 'open_app'

/** CFBundleIdentifier in each app's setup.py */
export const APP_BUNDLE_IDS: Record<AppId, string> = {
	bridge: 'com.dylanmaudio.dlive-midi-bridge',
	tlt: 'com.dylanmaudio.talk-light-trigger',
	ptt: 'com.dylanmaudio.pilot-tone-trigger',
	tct: 'com.dylanmaudio.time-code-tool',
	cxc: 'com.dylanmaudio.console-control',
}

export interface OpenAppContext {
	app: AppId
	/** The app is answering on its control endpoint */
	running(): boolean
	/** The app's catalogue, for its show control */
	catalogue(): Catalogue | null
	press(control: string): Promise<void>
	log(level: 'info' | 'warn', message: string): void
	/** Start the installed app. Tests replace it. */
	launch?(bundleId: string): Promise<void>
}

export async function launchApp(bundleId: string): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile('open', ['-b', bundleId], (err) => (err ? reject(new Error(err.message)) : resolve()))
	})
}

/** The catalogue's `<app>.show` action, if the app offers one. */
export function showControlOf(cat: Catalogue | null, app: AppId): string | null {
	return cat?.controls.find((c) => c.id === `${app}.show` && c.kind === 'action')?.id ?? null
}

export async function openApp(ctx: OpenAppContext): Promise<void> {
	const name = CONTROL_APPS[ctx.app].name
	if (ctx.running()) {
		const show = showControlOf(ctx.catalogue(), ctx.app)
		if (show) await ctx.press(show)
		else
			ctx.log(
				'info',
				`${name} is already running. Companion can bring it forward once ${name} offers a "show" control.`,
			)
		return
	}
	try {
		await (ctx.launch ?? launchApp)(APP_BUNDLE_IDS[ctx.app])
		ctx.log('info', `Starting ${name}`)
	} catch {
		ctx.log('warn', `Couldn't start ${name}: it isn't installed on this Mac (${APP_BUNDLE_IDS[ctx.app]})`)
	}
}

export function openAppActions(ctx: OpenAppContext): ReturnType<typeof buildControlActions> {
	const name = CONTROL_APPS[ctx.app].name
	return {
		[OPEN_APP_ACTION]: {
			name: `Open ${name}`,
			description: `Brings ${name} up, or starts it if it isn't running. A running app is never started twice.`,
			options: [],
			callback: async () => openApp(ctx),
		},
	}
}
