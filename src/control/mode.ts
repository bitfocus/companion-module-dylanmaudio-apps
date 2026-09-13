/**
 * A connection that controls one of the non-console apps — Talk Light,
 * Pilot Tone, Time Code Tool, Console Control — through its `/ctl/v1/`
 * endpoint (brief-companion-control.md §3). Everything Companion shows is
 * rebuilt from the app's catalogue, whenever the catalogue changes.
 *
 * The MIDI Bridge's own endpoint is the same shape, but it lives inside the
 * MIDI Bridge connection beside the console link: see bridgectl.ts.
 */

import { InstanceBase, InstanceStatus, type CompanionVariableValues, type LogLevel } from '@companion-module/base'
import type { ModuleSchema } from '../main.js'
import { ControlClient, type ControlStatus } from './client.js'
import {
	buildControlActions,
	buildControlFeedbacks,
	buildControlPresets,
	buildControlVariables,
	controlVariableValues,
	feedbackIdsForKey,
	META_VARIABLES,
} from './definitions.js'
import { CONTROL_APPS, type AppId } from './registry.js'
import { TalkFlash } from './talkflash.js'
import {
	TALK_FLASH_FEEDBACK,
	TALK_FLASH_PRESET,
	TALK_FLASH_VARIABLES,
	talkFlashActions,
	talkFlashFeedbacks,
	talkFlashPresets,
} from './talkflash-defs.js'
import type { Catalogue, CmdValue, StateValue } from './types.js'

/** The slice of the instance a control connection drives. */
export type ControlHost = Pick<
	InstanceBase<ModuleSchema>,
	| 'label'
	| 'updateStatus'
	| 'setActionDefinitions'
	| 'setFeedbackDefinitions'
	| 'setVariableDefinitions'
	| 'setVariableValues'
	| 'setPresetDefinitions'
	| 'checkFeedbacks'
> & { log(level: LogLevel, message: string): void }

const STATUS: Record<ControlStatus, InstanceStatus> = {
	connecting: InstanceStatus.Connecting,
	ok: InstanceStatus.Ok,
	not_running: InstanceStatus.Disconnected,
	not_allowed: InstanceStatus.UnknownWarning,
	mismatch: InstanceStatus.BadConfig,
	failure: InstanceStatus.ConnectionFailure,
}

export interface ControlModeOptions {
	talkFlashHz: number
	talkFlashCooldownS: number
	talkFlashPage: number
}

/** The Talk Light state key the talk flash follows, and the value that means talking. */
const TALK_KEY = 'tlt.talk'
const TALKING = 'active'

export class ControlAppMode {
	readonly client: ControlClient
	/** Talk Light connections only (brief §5) */
	readonly flash: TalkFlash | null
	private catalogue: Catalogue | null = null
	private readonly name: string
	private talkPage: number

	constructor(
		private readonly host: ControlHost,
		readonly app: AppId,
		address: string,
		port: number,
		opts: ControlModeOptions,
	) {
		this.name = CONTROL_APPS[app].name
		this.talkPage = opts.talkFlashPage
		this.flash =
			app === 'tlt'
				? new TalkFlash({
						hz: opts.talkFlashHz,
						cooldownS: opts.talkFlashCooldownS,
						onLit: () => this.host.checkFeedbacks(TALK_FLASH_FEEDBACK),
						onArmed: (armed) => this.host.setVariableValues({ talk_flash_armed: armed }),
						onExited: (exited) => this.host.setVariableValues({ talk_flash_exited: exited }),
						onTookOver: (v) => this.host.setVariableValues({ talk_flash_took_over: v }),
						canTakeOver: () => this.talkPage > 0,
					})
				: null
		this.client = new ControlClient({ host: address, port: port || CONTROL_APPS[app].port, appName: this.name })
		this.client.on('status', (s, message) => {
			this.host.updateStatus(STATUS[s], message || null)
			// Talk Light gone means no talk to show — never leave the decks blinking.
			if (s !== 'ok' && s !== 'not_allowed') this.setTalk(false)
			this.publishMeta()
		})
		this.client.on('log', (level, message) => this.host.log(level, message))
		this.client.on('catalogue', (cat) => this.define(cat))
		this.client.on('info', () => this.publishMeta())
		this.client.on('values', (changed) => this.onValues(changed))
	}

	start(): void {
		// Clear whatever the previous app type defined; the catalogue refills it.
		this.host.setActionDefinitions({})
		this.host.setFeedbackDefinitions({})
		this.host.setVariableDefinitions(
			Object.fromEntries(Object.entries(this.extraVariables()).map(([id, name]) => [id, { name }])),
		)
		this.host.setPresetDefinitions([], {})
		this.host.updateStatus(InstanceStatus.Connecting, `Looking for ${this.name}`)
		this.client.start()
	}

	stop(): void {
		this.client.stop()
		this.client.removeAllListeners()
		this.flash?.stop()
	}

	/** New blink rate / cooldown from the connection settings, applied without reconnecting. */
	configureTalkFlash(hz: number, cooldownS: number, page: number): void {
		this.flash?.configure(hz, cooldownS)
		this.talkPage = page
		if (this.flash) this.host.setVariableValues({ talk_page: page })
	}

	private extraVariables(): Record<string, string> {
		return this.flash ? { ...META_VARIABLES, ...TALK_FLASH_VARIABLES } : META_VARIABLES
	}

	private setTalk(active: boolean): void {
		if (!this.flash || this.flash.active === active) return
		this.flash.setTalk(active)
		this.host.setVariableValues({ talk_active: active })
	}

	private define(cat: Catalogue): void {
		this.catalogue = cat
		const flash = this.flash
		this.host.setActionDefinitions({
			...buildControlActions(cat, async (control, value) => this.press(control, value)),
			...(flash ? talkFlashActions(flash) : {}),
		})
		this.host.setFeedbackDefinitions({
			...buildControlFeedbacks(cat, (key) => this.client.get(key)),
			...(flash ? talkFlashFeedbacks(flash) : {}),
		})
		const variables = buildControlVariables(cat) as Record<string, { name: string }>
		for (const [id, name] of Object.entries(this.extraVariables())) variables[id] = { name }
		this.host.setVariableDefinitions(variables)
		const built = buildControlPresets(cat, this.host.label)
		if (flash) {
			Object.assign(built.presets, talkFlashPresets())
			built.sections.push({ id: 'talk_flash', name: 'Talk flash', definitions: [TALK_FLASH_PRESET] })
		}
		this.host.setPresetDefinitions(built.sections, built.presets)
		if (flash)
			this.host.setVariableValues({
				talk_active: flash.active,
				talk_flash_armed: flash.armed,
				talk_flash_exited: flash.exited,
				talk_flash_took_over: flash.tookOver,
				talk_page: this.talkPage,
			})
		this.host.log(
			'info',
			`${cat.name}${cat.version ? ` ${cat.version}` : ''}: ${cat.controls.length} controls, ${cat.state.length} state values`,
		)
		this.publishMeta()
	}

	/** A refusal is the app's own sentence (brief §2.3 rule 4) — pass it on, don't paraphrase it. */
	private async press(control: string, value?: CmdValue): Promise<void> {
		const r = await this.client.cmd(control, value)
		if (!r.ok) this.host.log('warn', `${this.name}: ${r.message ?? r.code ?? 'refused'}`)
	}

	private onValues(changed: Record<string, StateValue>): void {
		const cat = this.catalogue
		if (!cat) return
		this.host.setVariableValues(controlVariableValues(cat, changed))
		if (TALK_KEY in changed) this.setTalk(changed[TALK_KEY] === TALKING)
		const ids = [...new Set(Object.keys(changed).flatMap((k) => feedbackIdsForKey(cat, k)))]
		if (ids.length) this.host.checkFeedbacks(ids[0], ...ids.slice(1))
	}

	private publishMeta(): void {
		const info = this.client.info
		const values: CompanionVariableValues = {
			ctl_connected: this.client.status === 'ok' || this.client.status === 'not_allowed',
			ctl_allowed: info?.allowed ?? false,
			ctl_locked: info?.locked ?? false,
			ctl_version: info?.version ?? '',
		}
		this.host.setVariableValues(values)
	}
}
