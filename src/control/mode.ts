/**
 * A connection that controls one of the non-console apps — Talk Light,
 * Pilot Tone, Time Code Tool, Console Control — through its `/ctl/v1/`
 * endpoint (brief-companion-control.md §3). Everything Companion shows is
 * rebuilt from the app's catalogue, whenever the catalogue changes.
 *
 * The MIDI Bridge's own start/stop endpoint is the same shape and joins
 * the existing dLive connection type in a later step (brief §6, step 2).
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

export class ControlAppMode {
	readonly client: ControlClient
	private catalogue: Catalogue | null = null
	private readonly name: string

	constructor(
		private readonly host: ControlHost,
		readonly app: AppId,
		address: string,
		port: number,
	) {
		this.name = CONTROL_APPS[app].name
		this.client = new ControlClient({ host: address, port: port || CONTROL_APPS[app].port, appName: this.name })
		this.client.on('status', (s, message) => {
			this.host.updateStatus(STATUS[s], message || null)
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
			Object.fromEntries(Object.entries(META_VARIABLES).map(([id, name]) => [id, { name }])),
		)
		this.host.setPresetDefinitions([], {})
		this.host.updateStatus(InstanceStatus.Connecting, `Looking for ${this.name}`)
		this.client.start()
	}

	stop(): void {
		this.client.stop()
		this.client.removeAllListeners()
	}

	private define(cat: Catalogue): void {
		this.catalogue = cat
		this.host.setActionDefinitions(buildControlActions(cat, async (control, value) => this.press(control, value)))
		this.host.setFeedbackDefinitions(buildControlFeedbacks(cat, (key) => this.client.get(key)))
		this.host.setVariableDefinitions(buildControlVariables(cat))
		const { sections, presets } = buildControlPresets(cat, this.host.label)
		this.host.setPresetDefinitions(sections, presets)
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
