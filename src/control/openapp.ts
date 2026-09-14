/**
 * "Open <app>": the action behind the logo and menu-bar keys.
 *
 * While the app answers on its control endpoint, it is asked to show itself
 * through its catalogue's `<app>.show` control, if it has one. The module
 * never starts an app: that would take Companion's child-process permission,
 * which marks a module as dangerous to its users. A key pressed while the app
 * is down says in the log to start it on this Mac.
 */

import type { buildControlActions } from './definitions.js'
import { CONTROL_APPS, type AppId } from './registry.js'
import type { Catalogue } from './types.js'

export const OPEN_APP_ACTION = 'open_app'

export interface OpenAppContext {
	app: AppId
	/** The app is answering on its control endpoint */
	running(): boolean
	/** The app's catalogue, for its show control */
	catalogue(): Catalogue | null
	press(control: string): Promise<void>
	log(level: 'info' | 'warn', message: string): void
}

/** The catalogue's `<app>.show` action, if the app offers one. */
export function showControlOf(cat: Catalogue | null, app: AppId): string | null {
	return cat?.controls.find((c) => c.id === `${app}.show` && c.kind === 'action')?.id ?? null
}

export async function openApp(ctx: OpenAppContext): Promise<void> {
	const name = CONTROL_APPS[ctx.app].name
	if (!ctx.running()) {
		ctx.log('warn', `${name} isn't running. Start it on this Mac, then press again.`)
		return
	}
	const show = showControlOf(ctx.catalogue(), ctx.app)
	if (show) await ctx.press(show)
	else
		ctx.log('info', `${name} is already running. Companion can bring it forward once ${name} offers a "show" control.`)
}

export function openAppActions(ctx: OpenAppContext): ReturnType<typeof buildControlActions> {
	const name = CONTROL_APPS[ctx.app].name
	return {
		[OPEN_APP_ACTION]: {
			name: `Open ${name}`,
			description: `Brings ${name} to the front. If it isn't running, the log says so: start it on this Mac first.`,
			options: [],
			callback: async () => openApp(ctx),
		},
	}
}
