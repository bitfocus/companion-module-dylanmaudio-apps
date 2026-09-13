/**
 * The control client against a server built from fixtures/control — the
 * same files the monorepo replays its real ControlServer against, so both
 * sides are held to one contract. Never edit a case to make this green.
 *
 * The connection tests run against Pilot Tone Trigger's real catalogue. The
 * /cmd replay runs over every fixture file: the two shipping apps, and the
 * demo contract, which still pins wire cases no shipping app exercises yet
 * (text controls, the browser protections, every error code).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ControlClient } from './client.js'
import type { CmdValue } from './types.js'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'control')

interface FxCase {
	id: string
	setup?: { allowed?: boolean; locked?: boolean }
	request: { method: string; path: string; body?: Record<string, unknown>; content_type?: string }
	response: { status: number; body: Record<string, unknown> }
}
interface Fixture {
	app: { id: string; name: string; version: string }
	catalogue: { controls: { id: string }[]; state: { key: string }[] }
	initial_state: Record<string, unknown>
	cases: FxCase[]
}
const load = (file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as Fixture
const FILES = readdirSync(dir).filter((f) => f.endsWith('.json'))
const demo = load('exchanges.json')
const ptt = load('ptt.json')

/** `<str>` / `<int>` in a fixture mean "any value of that type". */
const ANY_STR = '<str>'
const concrete = (v: unknown): unknown => (v === ANY_STR ? 'fixture placeholder' : v)

/** A /ctl/v1/ server from one fixture's app, catalogue, initial state and cases. */
class CtlMock {
	private server: Server | null = null
	port = 0
	allowed = true
	locked = false
	ctl = 1
	hash = 'h1'
	catalogue: Fixture['catalogue']
	values: Record<string, unknown>
	seq = 0
	resyncOnce = false
	resyncs = 0
	private ring: { seq: number; frame: string }[] = []
	private streams = new Set<ServerResponse>()
	requests: { method: string; path: string; headers: IncomingMessage['headers']; body?: Record<string, unknown> }[] = []

	constructor(readonly fx: Fixture) {
		this.catalogue = fx.catalogue
		this.values = { ...fx.initial_state }
	}

	async start(): Promise<void> {
		this.server = createServer((req, res) => void this.handle(req, res))
		await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r))
		this.port = (this.server.address() as { port: number }).port
	}

	async stop(): Promise<void> {
		this.dropStreams()
		const s = this.server
		this.server = null
		if (!s) return
		s.closeAllConnections()
		await new Promise<void>((r) => s.close(() => r()))
	}

	dropStreams(): void {
		for (const s of this.streams) s.end()
		this.streams.clear()
	}

	emit(kind: string, payload: Record<string, unknown>): void {
		this.seq++
		const frame = `id: ${this.seq}\nevent: ${kind}\ndata: ${JSON.stringify({ ...payload, v: 1, seq: this.seq, ts: Date.now() })}\n\n`
		this.ring.push({ seq: this.seq, frame })
		for (const s of this.streams) s.write(frame)
	}

	publish(key: string, value: unknown): void {
		this.values[key] = value
		this.emit('state', { key, value })
	}

	private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const fx = this.fx
		const [path, query = ''] = (req.url ?? '').split('?')
		let body: Record<string, unknown> | undefined
		if (req.method === 'POST') {
			const chunks: Buffer[] = []
			for await (const chunk of req) chunks.push(chunk as Buffer)
			body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
		}
		this.requests.push({ method: req.method ?? '', path, headers: req.headers, body })
		const json = (status: number, obj: unknown) => {
			res.writeHead(status, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify(obj))
		}
		switch (`${req.method} ${path}`) {
			case 'GET /ctl/v1/info':
				return json(200, {
					v: 1,
					ctl: this.ctl,
					app: fx.app.id,
					name: fx.app.name,
					version: concrete(fx.app.version),
					catalogue_hash: this.hash,
					allowed: this.allowed,
					locked: this.locked,
					seq: this.seq,
				})
			case 'GET /ctl/v1/catalogue':
				return json(200, {
					v: 1,
					app: fx.app.id,
					name: fx.app.name,
					version: concrete(fx.app.version),
					hash: this.hash,
					...this.catalogue,
				})
			case 'GET /ctl/v1/state':
				return json(200, { v: 1, seq: this.seq, values: this.values })
			case 'GET /ctl/v1/stream': {
				if (this.resyncOnce) {
					this.resyncOnce = false
					this.resyncs++
					return json(409, { ok: false, error: { code: 'resync' } })
				}
				const header = req.headers['last-event-id']
				const q = new URLSearchParams(query).get('cursor')
				const cursor = typeof header === 'string' ? Number(header) : q !== null ? Number(q) : null
				res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
				for (const r of this.ring) if (cursor !== null && r.seq > cursor) res.write(r.frame)
				res.write(': keepalive\n\n')
				this.streams.add(res)
				req.on('close', () => this.streams.delete(res))
				return
			}
			case 'POST /ctl/v1/cmd': {
				const c = fx.cases.find(
					(x) =>
						x.request.path === '/ctl/v1/cmd' &&
						x.request.body?.control === body?.control &&
						JSON.stringify(x.request.body?.value) === JSON.stringify(body?.value) &&
						(x.setup?.allowed ?? true) === this.allowed &&
						(x.setup?.locked ?? false) === this.locked,
				)
				if (!c) return json(500, { ok: false, error: { code: 'no_fixture_case', message: JSON.stringify(body) } })
				const rb = { ...c.response.body, cid: body?.cid }
				const err = rb.error as { code: string; message?: unknown } | undefined
				if (err) rb.error = { ...err, ...(err.message !== undefined ? { message: concrete(err.message) } : {}) }
				return json(c.response.status, rb)
			}
			default:
				return json(404, { ok: false, error: { code: 'not_found' } })
		}
	}
}

async function waitFor(cond: () => boolean, what: string, ms = 3000): Promise<void> {
	const start = Date.now()
	while (!cond()) {
		if (Date.now() - start > ms) throw new Error(`timeout: ${what}`)
		await new Promise((r) => setTimeout(r, 10))
	}
}

describe("ControlClient against Pilot Tone Trigger's real catalogue", () => {
	let mock: CtlMock
	let client: ControlClient
	const streaming = () => client.status === 'ok' && mock.requests.some((r) => r.path === '/ctl/v1/stream')

	beforeEach(async () => {
		mock = new CtlMock(ptt)
		await mock.start()
		client = new ControlClient({
			host: '127.0.0.1',
			port: mock.port,
			appName: 'Pilot Tone Trigger',
			retryMs: 30,
			mismatchRetryMs: 30,
		})
	})
	afterEach(async () => {
		client.stop()
		await mock.stop()
	})

	it('connects as the brief says: info, catalogue, state, then the stream from that seq', async () => {
		mock.publish('ptt.state', 'ok') // so the snapshot has a seq worth resuming from
		client.start()
		await waitFor(streaming, 'stream opened')
		expect(mock.requests.map((r) => r.path).slice(0, 4)).toEqual([
			'/ctl/v1/info',
			'/ctl/v1/catalogue',
			'/ctl/v1/state',
			'/ctl/v1/stream',
		])
		expect(mock.requests[3].headers['last-event-id']).toBe(String(mock.seq))
		expect(client.catalogue?.controls).toEqual(ptt.catalogue.controls)
		expect(client.catalogue?.state).toEqual(ptt.catalogue.state)
		expect(client.get('ptt.state')).toBe('ok')
		expect(client.get('ptt.failback_mode')).toBe('auto')
		expect(client.get('ptt.level_db')).toBeNull()
	})

	it('sends no Origin and a loopback Host — the server refuses anything else', async () => {
		client.start()
		await waitFor(streaming, 'stream')
		for (const r of mock.requests) {
			expect(r.headers.origin).toBeUndefined()
			expect(r.headers.host).toBe(`127.0.0.1:${mock.port}`)
		}
	})

	it('applies state deltas from the stream', async () => {
		const seen: Record<string, unknown>[] = []
		client.on('values', (v) => seen.push(v))
		client.start()
		await waitFor(streaming, 'stream')
		mock.publish('ptt.state', 'lost')
		mock.publish('ptt.reset_available', true)
		mock.publish('ptt.level_db', -12.5)
		await waitFor(() => client.get('ptt.level_db') === -12.5, 'level delta')
		expect(client.get('ptt.state')).toBe('lost')
		expect(client.get('ptt.reset_available')).toBe(true)
		expect(seen).toContainEqual({ 'ptt.state': 'lost' })
	})

	it('rebuilds when the app changes its catalogue', async () => {
		const lengths: number[] = []
		client.on('catalogue', (c) => lengths.push(c.controls.length))
		client.start()
		await waitFor(streaming, 'stream')
		mock.catalogue = { ...ptt.catalogue, controls: [...ptt.catalogue.controls, { id: 'ptt.extra' }] }
		mock.hash = 'h2'
		mock.emit('catalogue', { hash: 'h2' })
		await waitFor(() => client.catalogue?.hash === 'h2', 'refetched catalogue')
		expect(lengths).toEqual([ptt.catalogue.controls.length, ptt.catalogue.controls.length + 1])
	})

	it('says when Companion control is switched off in the app, and when it is back', async () => {
		mock.allowed = false
		client.start()
		await waitFor(() => client.status === 'not_allowed', 'not_allowed from /info')
		expect(client.statusMessage).toMatch(/Allow Companion control/)
		await waitFor(() => mock.requests.some((r) => r.path === '/ctl/v1/stream'), 'stream still opens')
		mock.allowed = true
		mock.emit('info', { allowed: true, locked: true })
		await waitFor(() => client.status === 'ok', 'ok after the switch')
		expect(client.statusMessage).toMatch(/locked/)
	})

	it('starts again from /state when its cursor has fallen off the ring (409 resync)', async () => {
		client.start()
		await waitFor(streaming, 'stream')
		mock.values['ptt.state'] = 'latched' // changed while the client was away, with no event it will see
		mock.resyncOnce = true
		mock.dropStreams()
		await waitFor(() => mock.resyncs === 1, '409 served')
		await waitFor(() => client.get('ptt.state') === 'latched', 'refetched state')
		expect(client.status).toBe('ok')
	})

	it('reports an API version mismatch instead of guessing', async () => {
		mock.ctl = 2
		client.start()
		await waitFor(() => client.status === 'mismatch', 'mismatch')
		expect(client.statusMessage).toMatch(/v2/)
		expect(mock.requests.some((r) => r.path === '/ctl/v1/catalogue')).toBe(false)
	})

	it('reports an app that is not running, and a press comes back ok:false rather than throwing', async () => {
		await mock.stop()
		client.start()
		await waitFor(() => client.status === 'not_running', 'not_running')
		expect(client.statusMessage).toMatch(/Pilot Tone Trigger isn't running/)
		const r = await client.cmd('ptt.run', 'on')
		expect(r).toMatchObject({ ok: false, status: 0, code: 'not_running' })
	})
})

// cmd.bad_request (no "control") and cmd.bad_content_type (text/plain) are
// server-side protections this client can't trigger: it always names a
// control and always sends JSON. Each file's guard test makes sure those are
// the only cases left out, so a new /cmd case can't be skipped by accident.
const UNSENDABLE = ['cmd.bad_content_type', 'cmd.bad_request']

for (const file of FILES) {
	const fx = load(file)
	const cases = fx.cases.filter(
		(c) => c.request.path === '/ctl/v1/cmd' && typeof c.request.body?.control === 'string' && !c.request.content_type,
	)

	describe(`/cmd: every case in fixtures/control/${file} that a client can send`, () => {
		let mock: CtlMock
		let client: ControlClient
		beforeEach(async () => {
			mock = new CtlMock(fx)
			await mock.start()
			client = new ControlClient({ host: '127.0.0.1', port: mock.port, appName: fx.app.name })
		})
		afterEach(async () => {
			await mock.stop()
		})

		for (const c of cases) {
			it(c.id, async () => {
				mock.allowed = c.setup?.allowed ?? true
				mock.locked = c.setup?.locked ?? false
				const { control, value } = c.request.body as { control: string; value?: CmdValue }
				const r = await client.cmd(control, value)

				const sent = mock.requests[mock.requests.length - 1]
				const { cid, ...rest } = sent.body ?? {}
				const { cid: _fixtureCid, ...want } = c.request.body ?? {}
				expect(rest).toEqual(want)
				expect(typeof cid).toBe('string')
				expect(sent.headers['content-type']).toBe('application/json')

				const rb = c.response.body as { ok: boolean; value?: unknown; error?: { code: string; message?: string } }
				expect(r.ok).toBe(rb.ok)
				expect(r.status).toBe(c.response.status)
				if (rb.ok) {
					if ('value' in rb) expect(r.value).toEqual(rb.value)
				} else {
					expect(r.code).toBe(rb.error?.code)
					const m = rb.error?.message
					if (m === ANY_STR) expect(typeof r.message).toBe('string')
					else if (m !== undefined) expect(r.message).toBe(m)
				}
			})
		}

		it('leaves out only the cases a client cannot produce', () => {
			const skipped = fx.cases.filter((c) => c.request.path === '/ctl/v1/cmd' && !cases.includes(c)).map((c) => c.id)
			for (const id of skipped) expect(UNSENDABLE).toContain(id)
		})
	})
}

describe('fixtures/control', () => {
	it('has the demo contract and both shipping apps', () => {
		expect(FILES.sort()).toEqual(['exchanges.json', 'ptt.json', 'tlt.json'])
		expect(demo.cases.length).toBeGreaterThan(20)
	})
})
