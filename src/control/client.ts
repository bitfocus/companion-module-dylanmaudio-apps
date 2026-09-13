/**
 * ControlClient — one dylanmaudio app's `/ctl/v1/` control endpoint
 * (brief-companion-control.md §2–3). The wire shapes are pinned by
 * fixtures/control/exchanges.json, which the monorepo's server replays.
 *
 * Connecting is /info (API version, catalogue hash, the app's two
 * switches), then /catalogue when the hash is new, then /state for every
 * value and the seq it is consistent with, then the SSE stream from that
 * seq. The stream carries `state` deltas, `catalogue` (the hash changed:
 * refetch, and the module redefines its buttons), `info` (a switch was
 * flipped) and `ack`. A cursor that has fallen off the server's ring gets a
 * 409, and the answer is to start again from /state. Anything else that
 * ends the stream reconnects after a short wait.
 *
 * Commands are POSTs that answer for themselves. The app's own refusals —
 * "Signal is still below threshold — stay on backup" — come back in the
 * reply for the caller to show.
 */

import { EventEmitter } from 'node:events'
import type { LogLevel } from '@companion-module/base'
import { sseFrames } from '../util/sse.js'
import { CTL_API_VERSION } from './registry.js'
import type { Catalogue, CmdResult, CmdValue, CtlInfo, StateValue } from './types.js'

export type ControlStatus = 'connecting' | 'ok' | 'not_running' | 'not_allowed' | 'mismatch' | 'failure'

export interface ControlClientOptions {
	host: string
	port: number
	/** used in status messages — "Pilot Tone Trigger isn't running" */
	appName: string
	/** wait before reconnecting after a failure (default 2 s) */
	retryMs?: number
	/** wait before retrying an API version mismatch (default 10 s) */
	mismatchRetryMs?: number
}

export interface ControlClientEvents {
	status: [status: ControlStatus, message: string]
	catalogue: [catalogue: Catalogue]
	values: [changed: Record<string, StateValue>]
	info: [info: CtlInfo]
	log: [level: LogLevel, message: string]
}

class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message)
	}
}
/** A stale cursor: go round again from /state, straight away. */
class Resync extends Error {}
/** The app speaks a different control API version. */
class Mismatch extends Error {}

export class ControlClient extends EventEmitter<ControlClientEvents> {
	info: CtlInfo | null = null
	catalogue: Catalogue | null = null
	readonly values = new Map<string, StateValue>()
	status: ControlStatus = 'connecting'
	statusMessage = ''
	private seq = 0
	/** stream frames at or below this seq are already in the last /state snapshot */
	private floor = 0
	private started = false
	private generation = 0
	private streamAbort: AbortController | null = null
	private retryTimer: NodeJS.Timeout | null = null
	private cidCounter = 0

	constructor(readonly opts: ControlClientOptions) {
		super()
	}

	get baseUrl(): string {
		const h = this.opts.host.includes(':') && !this.opts.host.startsWith('[') ? `[${this.opts.host}]` : this.opts.host
		return `http://${h}:${this.opts.port}/ctl/v1`
	}

	/** Current value of a state key; null when unknown. */
	get(key: string): StateValue {
		return this.values.get(key) ?? null
	}

	start(): void {
		if (this.started) return
		this.started = true
		void this.run(++this.generation)
	}

	stop(): void {
		this.started = false
		this.generation++
		this.streamAbort?.abort()
		this.streamAbort = null
		if (this.retryTimer) clearTimeout(this.retryTimer)
		this.retryTimer = null
	}

	/** Press a control. Never throws: a failure is `{ ok: false, code }`. */
	async cmd(control: string, value?: CmdValue): Promise<CmdResult> {
		const cid = `c${++this.cidCounter}`
		const body: Record<string, unknown> = { v: CTL_API_VERSION, cid, control }
		if (value !== undefined) body.value = value
		let res: Response
		try {
			res = await fetch(`${this.baseUrl}/cmd`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			})
		} catch (e) {
			return {
				ok: false,
				status: 0,
				code: 'not_running',
				message: `${this.opts.appName} isn't answering (${(e as Error).message})`,
			}
		}
		let json: Record<string, unknown> = {}
		try {
			json = (await res.json()) as Record<string, unknown>
		} catch {
			// not JSON — reported below by status alone
		}
		if (json.ok === true) return { ok: true, status: res.status, value: json.value }
		const err = (json.error ?? {}) as { code?: unknown; message?: unknown }
		return {
			ok: false,
			status: res.status,
			code: typeof err.code === 'string' ? err.code : `http_${res.status}`,
			message: typeof err.message === 'string' ? err.message : undefined,
		}
	}

	// ---------------------------------------------------------------- connection

	private async run(gen: number): Promise<void> {
		while (this.live(gen)) {
			let wait = this.opts.retryMs ?? 2000
			try {
				await this.connectOnce(gen)
				wait = 250 // the stream closed cleanly — come straight back
			} catch (e) {
				if (!this.live(gen)) return
				if (e instanceof Resync) wait = 0
				else if (e instanceof Mismatch) wait = this.opts.mismatchRetryMs ?? 10_000
				else this.onError(e as Error)
			}
			if (!this.live(gen)) return
			if (wait > 0) await new Promise<void>((r) => (this.retryTimer = setTimeout(r, wait)))
		}
	}

	private live(gen: number): boolean {
		return this.started && gen === this.generation
	}

	private async connectOnce(gen: number): Promise<void> {
		const info = (await this.getJson('/info')) as unknown as CtlInfo
		if (info.ctl !== CTL_API_VERSION) {
			this.setStatus(
				'mismatch',
				`${this.opts.appName} speaks control API v${String(info.ctl)} and this module speaks v${CTL_API_VERSION} — update whichever is older`,
			)
			throw new Mismatch()
		}
		this.info = info
		this.emit('info', info)
		if (!this.catalogue || this.catalogue.hash !== info.catalogue_hash) await this.loadCatalogue()
		await this.loadState()
		if (!this.live(gen)) return
		this.statusFromInfo()
		await this.consumeStream(gen)
	}

	private async loadCatalogue(): Promise<void> {
		const cat = (await this.getJson('/catalogue')) as unknown as Catalogue
		this.catalogue = { ...cat, controls: cat.controls ?? [], state: cat.state ?? [] }
		this.emit('catalogue', this.catalogue)
	}

	private async loadState(): Promise<void> {
		const snap = await this.getJson('/state')
		const values = (snap.values ?? {}) as Record<string, StateValue>
		this.values.clear()
		for (const [k, v] of Object.entries(values)) this.values.set(k, v ?? null)
		this.seq = typeof snap.seq === 'number' ? snap.seq : 0
		this.floor = this.seq
		this.emit('values', { ...values })
	}

	private async consumeStream(gen: number): Promise<void> {
		const abort = new AbortController()
		this.streamAbort = abort
		const res = await fetch(`${this.baseUrl}/stream`, {
			headers: { 'Last-Event-ID': String(this.seq) },
			signal: abort.signal,
		})
		if (res.status === 409) throw new Resync()
		if (res.status !== 200 || !res.body) throw await httpError(res)
		for await (const frame of sseFrames(res.body)) {
			if (!this.live(gen)) return
			const id = frame.id !== undefined && frame.id !== '' ? Number(frame.id) : undefined
			if (id !== undefined) {
				if (id <= this.floor) continue // already in the snapshot we started from
				this.seq = id
			}
			let payload: Record<string, unknown>
			try {
				payload = JSON.parse(frame.data) as Record<string, unknown>
			} catch {
				continue
			}
			await this.handleEvent(frame.event, payload)
		}
	}

	private async handleEvent(kind: string, p: Record<string, unknown>): Promise<void> {
		switch (kind) {
			case 'state': {
				if (typeof p.key !== 'string') return
				const v = (p.value ?? null) as StateValue
				this.values.set(p.key, v)
				this.emit('values', { [p.key]: v })
				return
			}
			case 'catalogue':
				if (typeof p.hash === 'string' && p.hash !== this.catalogue?.hash) {
					this.emit('log', 'info', `${this.opts.appName} changed its controls — rebuilding them`)
					await this.loadCatalogue()
					await this.loadState()
				}
				return
			case 'info':
				if (!this.info) return
				if (typeof p.allowed === 'boolean') this.info.allowed = p.allowed
				if (typeof p.locked === 'boolean') this.info.locked = p.locked
				this.emit('info', this.info)
				this.statusFromInfo()
				return
			default:
				return // 'ack', and anything a newer server adds: commands answer for themselves
		}
	}

	private statusFromInfo(): void {
		const info = this.info
		if (!info) return
		if (!info.allowed) {
			this.setStatus(
				'not_allowed',
				`Companion control is switched off in ${this.opts.appName}. Its state still shows here, but presses are refused — turn on "Allow Companion control" in the app.`,
			)
		} else {
			this.setStatus('ok', info.locked ? `Show-critical controls are locked in ${this.opts.appName}` : '')
		}
	}

	private onError(e: Error): void {
		if (e instanceof HttpError) {
			this.setStatus('failure', `${this.opts.appName}: ${e.message}`)
			return
		}
		// fetch() rejects with a TypeError whose cause is the socket error
		const where = `${this.opts.host}:${this.opts.port}`
		this.setStatus('not_running', `${this.opts.appName} isn't running — nothing is answering on ${where}`)
	}

	private setStatus(status: ControlStatus, message: string): void {
		if (status === this.status && message === this.statusMessage) return
		this.status = status
		this.statusMessage = message
		this.emit('status', status, message)
	}

	private async getJson(path: string): Promise<Record<string, unknown>> {
		const res = await fetch(this.baseUrl + path)
		if (res.status !== 200) throw await httpError(res)
		return (await res.json()) as Record<string, unknown>
	}
}

async function httpError(res: Response): Promise<HttpError> {
	let code = `http_${res.status}`
	let message = `HTTP ${res.status}`
	try {
		const j = (await res.json()) as { error?: { code?: string; message?: string } }
		if (j.error?.code) code = j.error.code
		if (j.error?.message) message = j.error.message
	} catch {
		// not JSON
	}
	return new HttpError(res.status, code, message)
}
