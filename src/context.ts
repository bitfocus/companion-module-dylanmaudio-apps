import type { LogLevel } from '@companion-module/base'
import type { ActionMapEntry, ModuleConfig } from './config.js'
import type { LinkApi } from './link-api.js'

/** What actions/feedbacks/presets need from the instance — keeps them testable without Companion. */
export interface ModuleContext {
	readonly link: LinkApi
	readonly config: ModuleConfig
	readonly actionsMap: ActionMapEntry[]
	/** The connection's label: the prefix of its variables in button text, $(<label>:scene_current) */
	readonly label: string
	log(level: LogLevel, message: string): void
	reloadShowFile(): Promise<void>
	resync(): void
}
