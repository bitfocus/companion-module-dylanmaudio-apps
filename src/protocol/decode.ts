/**
 * Decoder — byte stream → ConsoleEvents. docs/protocol.md §4–5. Proven by
 * fixtures/rx.json.
 *
 * TCP hands us arbitrary chunks, so this is a byte-at-a-time state machine
 * with two layers: a raw MIDI parser (running status, real-time bytes
 * anywhere, SysEx across chunks, bounded accumulator) and a semantic layer
 * on top that assembles NRPN triples and reads the console's broadcast.
 *
 * **The console broadcasts, and it relays raw.** Every client sees every
 * other client's writes, and it sees them as the *bytes that client sent* —
 * not as a re-encoded message (session 5 Sep 2026, §3.2). A partial NRPN
 * from another controller therefore arrives here verbatim, missing its
 * select leg. A decoder that keeps a latch across messages will combine that
 * orphan data entry with its own stale address and invent a value for a
 * channel nobody touched; that is exactly what happened on the desk, and it
 * produced a phantom "Input 128 → LV 107".
 *
 * So the rule is **contiguity**: a data entry counts only when its `63`
 * select and `62` parameter arrived as the immediately preceding messages,
 * with nothing in between. Any other message — any kind, any channel —
 * abandons the sequence. This also happens to agree with the desk when two
 * clients interleave: on 2.12 the console applied client B's data entry to
 * client A's selection (§3.4), and those legs are contiguous on the wire.
 *
 * The decoder is pure: no timers. A lone `63` only becomes visible as a ping
 * when the next message arrives or when `flush()` is called.
 */

import { colourFromByte, resolveAddress, resolveSocket, type ChannelRef } from './channels.js'
import {
	OP_MIX_ASSIGN,
	OP_PREAMP_48V,
	OP_PREAMP_PAD,
	OP_REPLY_PREAMP_48V,
	OP_REPLY_PREAMP_PAD,
	OP_REPLY_COLOUR,
	OP_REPLY_NAME,
	OP_SEND_LEVEL,
	SYSEX_HEADER,
} from './encode.js'
import { PARAM_FADER, type ConsoleEvent } from './intents.js'

const VOICE_LEN: Record<number, number> = { 0x80: 2, 0x90: 2, 0xa0: 2, 0xb0: 2, 0xc0: 1, 0xd0: 1, 0xe0: 2 }
/** The three CCs that may continue an NRPN run: select, parameter, data entry. */
const NRPN_LEGS = new Set([0x63, 0x62, 0x06])
/**
 * MIDI Strips — the factory template's default messages (Firmware Reference
 * V2.1 §10.2, confirmed on the socket 5 Sep 2026 §3.5). Channel numbers here
 * are MIDI channels 2 and 3 as `n` (zero-based), and they are FIXED: whether
 * they follow the Global base channel is untested, so the module must not
 * assume they move with it.
 *
 * Keys (`9n`, channel 2):   note 0x00–0x1F mute, 0x20–0x3F mix, 0x40–0x5F PAFL
 * Fader (`Bn`, channel 2):  cc   0x00–0x1F
 * Rotaries (`Bn`, ch 3):    cc   0x00–0x1F gain, 0x20–0x3F pan,
 *                                0x40–0x5F custom 1, 0x60–0x7F custom 2
 *
 * All of it is user-editable per strip, so this decodes the factory defaults
 * only — a rig that has retyped the strings will not match, by design.
 */
const STRIP_CH_KEYS = 1
const STRIP_CH_ROTARY = 2
const STRIP_KEYS = ['mute', 'mix', 'pafl'] as const
const STRIP_ROTARIES = ['gain', 'pan', 'custom1', 'custom2'] as const
const COMMON_LEN: Record<number, number> = { 0xf1: 1, 0xf2: 2, 0xf3: 1, 0xf6: 0 }
export const SYSEX_MAX = 256

interface RawMessage {
	status: number
	data: number[]
}

/** Raw MIDI layer: bytes → complete messages. Independent of dLive. */
export class MidiParser {
	private status: number | null = null
	private running: number | null = null
	private need = 0
	private data: number[] = []
	private sysex: number[] | null = null
	/** count of SysEx messages dropped for exceeding SYSEX_MAX */
	public sysexOverruns = 0

	feed(chunk: ArrayLike<number>, out: RawMessage[]): void {
		for (let i = 0; i < chunk.length; i++) this.byte(chunk[i], out)
	}

	private byte(b: number, out: RawMessage[]): void {
		if (b >= 0xf8) return // system real-time: dropped, disturbs nothing

		if (this.sysex !== null) {
			if (b === 0xf7) {
				out.push({ status: 0xf0, data: this.sysex })
				this.sysex = null
				return
			}
			if (b >= 0x80) {
				// a status byte aborts an unterminated SysEx; reprocess it
				this.sysex = null
				this.byte(b, out)
				return
			}
			if (this.sysex.length >= SYSEX_MAX) {
				this.sysexOverruns++
				this.sysex = null // drop it; the stream continues
				return
			}
			this.sysex.push(b)
			return
		}

		if (b === 0xf0) {
			this.sysex = []
			this.status = null
			this.running = null
			this.need = 0
			this.data = []
			return
		}

		if (b >= 0x80) {
			const hi = b & 0xf0
			if (hi in VOICE_LEN) {
				this.status = b
				this.running = b
				this.need = VOICE_LEN[hi]
				this.data = []
			} else {
				this.status = b
				this.running = null
				this.need = COMMON_LEN[b] ?? 0
				this.data = []
				if (this.need === 0) this.emit(out)
			}
			return
		}

		// data byte
		if (this.status === null) {
			if (this.running === null) return // stray data byte with no context
			this.status = this.running
			this.need = VOICE_LEN[this.running & 0xf0]
			this.data = []
		}
		this.data.push(b)
		if (this.data.length >= this.need) this.emit(out)
	}

	private emit(out: RawMessage[]): void {
		if (this.status === null) return
		const hi = this.status & 0xf0
		out.push({ status: this.status, data: this.data })
		if (hi in VOICE_LEN) {
			// re-arm for running status on the same status byte
			this.status = null
			this.need = VOICE_LEN[hi]
		} else {
			this.status = null
			this.need = 0
		}
		this.data = []
	}
}

/**
 * An NRPN triple being assembled. Exists only while the run is unbroken: see
 * the contiguity rule in this file's header.
 */
interface NrpnRun {
	n: number
	msb: number
	lsb: number | null
	/** true once a data entry has been decoded, so repeats on the same run still count */
	complete: boolean
}

export interface DecoderOptions {
	/**
	 * Decode MIDI channels 2 and 3 as MIDI Strip traffic (§3.5). Off by
	 * default because it is a console-side feature the operator has to set up,
	 * and because on base channel 1–3 those channels are also the group and
	 * aux channels of the protocol table — see `stripsShadowProtocol()`.
	 */
	midiStrips?: boolean
}

export class DliveDecoder {
	private readonly parser = new MidiParser()
	private readonly bank: number[] = new Array<number>(16).fill(0)
	/** the NRPN run in progress, or null if the last message broke it */
	private nrpn: NrpnRun | null = null
	/** a `63` that has not yet been followed by `62` — a fader ping in waiting */
	private pendingPing: { n: number; addr: number } | null = null
	private readonly midiStrips: boolean

	constructor(
		public baseN: number,
		opts: DecoderOptions = {},
	) {
		this.midiStrips = opts.midiStrips ?? false
	}

	get sysexOverruns(): number {
		return this.parser.sysexOverruns
	}

	feed(chunk: ArrayLike<number>): ConsoleEvent[] {
		const raw: RawMessage[] = []
		this.parser.feed(chunk, raw)
		const out: ConsoleEvent[] = []
		for (const m of raw) this.message(m, out)
		return out
	}

	/** Emit any pending fader ping. Call when the stream goes quiet. */
	flush(): ConsoleEvent[] {
		const out: ConsoleEvent[] = []
		this.flushPing(out)
		return out
	}

	private flushPing(out: ConsoleEvent[]): void {
		if (!this.pendingPing) return
		const ref = resolveAddress(this.baseN, this.pendingPing.n, this.pendingPing.addr)
		this.pendingPing = null
		if (ref) out.push({ kind: 'fader_ping', ...ref })
	}

	private message(m: RawMessage, out: ConsoleEvent[]): void {
		const hi = m.status & 0xf0
		const n = m.status & 0x0f

		// Contiguity (see header). Only the three NRPN legs continue a run, and
		// only messages this decoder emits *nothing* for are transparent to it:
		// a note off, the velocity-0 terminator of a mute pair, a foreign SysEx.
		// (Real-time bytes never reach here — the parser drops them.) Anything
		// that carries meaning ends the run, so the next data entry has to bring
		// its own select rather than borrowing a stale one.
		//
		// The report's wording is stricter — "only trust contiguous complete
		// triples" — but the failure it describes is an *orphan* data entry, and
		// admitting these three no-ops cannot manufacture one: none of them can
		// come from another controller's NRPN. Refusing them instead would drop
		// real fader moves whenever a mute pair lands mid-triple, which on a
		// broadcast desk is ordinary traffic.
		const transparent = hi === 0x80 || (hi === 0x90 && m.data[1] === 0) || (m.status === 0xf0 && !isAhSysex(m.data))
		if (!transparent && !(hi === 0xb0 && NRPN_LEGS.has(m.data[0]))) this.nrpn = null

		// MIDI Strips transmit on channels 2 and 3, which on base channel 1–3
		// are also protocol channels. They are decoded first and unconditionally
		// (§3.5): a strip fader is `b1 00 <v>`, indistinguishable from Bank
		// Select MSB on the groups channel, and silently swallowed by the
		// protocol path.
		if (this.midiStrips && (n === STRIP_CH_KEYS || n === STRIP_CH_ROTARY)) {
			this.flushPing(out)
			this.strip(hi, n, m.data, out)
			return
		}

		if (m.status === 0xf0) {
			if (!isAhSysex(m.data)) return // foreign SysEx: ignored, transparent to a pending ping
			this.flushPing(out)
			this.sysex(m.data, out)
			return
		}
		if (hi === 0xb0) {
			this.cc(n, m.data[0], m.data[1], out)
			return
		}
		if (hi === 0x80) return // note off: ignored, transparent to a pending ping
		// A Note On with velocity 0 is the same message in MIDI's
		// running-status idiom, and it is how the console writes the
		// terminator of its own mute pair ("9N CH 7F, [9N] CH 00",
		// spec p.2). The spec's receive table is explicit — "Velocity
		// 00 and NOTE OFF messages are ignored", OFF starting at 0x01 —
		// so reading it as a mute-off would make every mute-on from the
		// surface arrive as on-then-immediately-off.
		if (hi === 0x90 && m.data[1] === 0) return
		this.flushPing(out)
		switch (hi) {
			case 0x90: {
				const ref = resolveAddress(this.baseN, n, m.data[0])
				if (ref) out.push({ kind: 'mute', ...ref, on: m.data[1] >= 0x40 })
				else out.push({ kind: 'unknown', status: m.status, data: [...m.data] })
				return
			}
			case 0xc0: {
				const offset = (n - this.baseN + 16) & 0x0f
				if (offset > 4) {
					out.push({ kind: 'unknown', status: m.status, data: [...m.data] })
					return
				}
				out.push({ kind: 'scene', scene: this.bank[n] * 128 + m.data[0] + 1 })
				return
			}
			case 0xe0: {
				if (n !== (this.baseN & 0x0f)) {
					out.push({ kind: 'unknown', status: m.status, data: [...m.data] })
					return
				}
				const sock = resolveSocket(m.data[0])
				if (sock) out.push({ kind: 'preamp_gain', ...sock, value: m.data[1] })
				return
			}
			default:
				if (hi < 0xf0) out.push({ kind: 'unknown', status: m.status, data: [...m.data] })
		}
	}

	private cc(n: number, cc: number, value: number, out: ConsoleEvent[]): void {
		const offset = (n - this.baseN + 16) & 0x0f
		if (offset > 4) {
			this.flushPing(out)
			out.push({ kind: 'unknown', status: 0xb0 | n, data: [cc, value] })
			return
		}
		switch (cc) {
			case 0x63: // NRPN MSB = channel address — starts a run
				this.flushPing(out)
				this.nrpn = { n, msb: value, lsb: null, complete: false }
				this.pendingPing = { n, addr: value }
				return
			case 0x62: // NRPN LSB = parameter
				if (this.pendingPing && this.pendingPing.n === n) this.pendingPing = null
				else this.flushPing(out)
				// Only valid directly after this channel's own select. An orphan
				// `62` is another controller's relayed partial (§3.2): drop it.
				if (this.nrpn && this.nrpn.n === n && this.nrpn.lsb === null) this.nrpn.lsb = value
				else this.nrpn = null
				return
			case 0x06: {
				// Data Entry MSB — completes the triple, and may repeat while the
				// run is unbroken (the desk streams a fader move that way).
				if (this.pendingPing && this.pendingPing.n === n) this.pendingPing = null
				else this.flushPing(out)
				const run = this.nrpn
				if (!run || run.n !== n || run.lsb === null) {
					this.nrpn = null
					return
				}
				run.complete = true
				const ref = resolveAddress(this.baseN, n, run.msb)
				if (!ref) return
				this.param(ref, run.lsb, value, out)
				return
			}
			case 0x00: // Bank Select MSB
				this.flushPing(out)
				this.bank[n] = value
				return
			case 0x20: // Bank Select LSB: ignored (always 0)
				this.flushPing(out)
				return
			default:
				this.flushPing(out)
				// Everything else on a protocol channel: Actions echo, UFX, Scene
				// Go/Next/Prev, a SoftKey's Custom MIDI string, one of our own
				// apps' signalling CCs. None of it is channel state, but a
				// controller above us can trigger on it, so it is surfaced rather
				// than dropped. Note the range 0x78–0x7F is NOT treated as MIDI
				// channel mode: the desk's own SoftKey example is `B0 7F 01`
				// (session §3.5), which a channel-mode reading would swallow.
				out.push({ kind: 'cc', channel: n, cc, value })
				return
		}
	}

	/**
	 * Channels 2–3 as MIDI Strips. Anything outside the factory ranges is
	 * reported as `unknown` rather than guessed at — a rig with custom strings
	 * should look unrecognised, not mis-attributed to strip 1.
	 */
	private strip(hi: number, n: number, data: number[], out: ConsoleEvent[]): void {
		const [a, b] = data
		if (hi === 0x90 && n === STRIP_CH_KEYS) {
			if (b === 0) return // note-off terminator, as with console mutes
			const key = STRIP_KEYS[a >> 5]
			if (key) out.push({ kind: 'strip_key', strip: (a & 0x1f) + 1, key, on: b >= 0x40 })
			else out.push({ kind: 'unknown', status: hi | n, data: [...data] })
			return
		}
		if (hi === 0xb0 && n === STRIP_CH_KEYS) {
			if (a <= 0x1f) out.push({ kind: 'strip_fader', strip: a + 1, value: b })
			else out.push({ kind: 'unknown', status: hi | n, data: [...data] })
			return
		}
		if (hi === 0xb0 && n === STRIP_CH_ROTARY) {
			out.push({ kind: 'strip_rotary', strip: (a & 0x1f) + 1, rotary: STRIP_ROTARIES[a >> 5], value: b })
			return
		}
		if (hi === 0x80) return
		out.push({ kind: 'unknown', status: hi | n, data: [...data] })
	}

	private param(ref: ChannelRef, param: number, value: number, out: ConsoleEvent[]): void {
		if (param === PARAM_FADER) out.push({ kind: 'fader', ...ref, level: value })
		else out.push({ kind: 'param', ...ref, param, value })
	}

	private sysex(body: number[], out: ConsoleEvent[]): void {
		// body excludes F0/F7. A&H header is 7 bytes after F0.
		const p = body.slice(SYSEX_HEADER.length - 1)
		if (p.length < 2) return
		const n = p[0] & 0x0f
		const op = p[1]
		switch (op) {
			case OP_REPLY_NAME: {
				const ref = resolveAddress(this.baseN, n, p[2])
				if (!ref) return
				const name = decodeName(p.slice(3))
				out.push({ kind: 'name', ...ref, name })
				return
			}
			case OP_REPLY_COLOUR: {
				const ref = resolveAddress(this.baseN, n, p[2])
				if (!ref || p.length < 4) return
				out.push({ kind: 'colour', ...ref, colour: colourFromByte(p[3]) })
				return
			}
			case OP_SEND_LEVEL: {
				if (p.length < 6) return
				const src = resolveAddress(this.baseN, n, p[2])
				const dst = resolveAddress(this.baseN, p[3] & 0x0f, p[4])
				if (!src || !dst) return
				out.push({ kind: 'send_level', ...src, dest_type: dst.type, dest_index: dst.index, level: p[5] })
				return
			}
			case OP_MIX_ASSIGN: {
				if (p.length < 6) return
				const src = resolveAddress(this.baseN, n, p[2])
				const dst = resolveAddress(this.baseN, p[3] & 0x0f, p[4])
				if (!src || src.type !== 'input' || !dst) return
				out.push({ kind: 'mix_assign', index: src.index, dest_type: dst.type, dest_index: dst.index, on: p[5] >= 0x40 })
				return
			}
			// The spec gives pad and 48 V dedicated REPLY ops (08 / 0B)
			// distinct from their set ops (09 / 0C). Accept both: the
			// reply op is what the PDF documents, the set op is what a
			// pure echo would look like, and which one the console
			// actually emits is a capture item.
			case OP_REPLY_PREAMP_PAD:
			case OP_REPLY_PREAMP_48V:
			case OP_PREAMP_PAD:
			case OP_PREAMP_48V: {
				if (p.length < 4) return
				const sock = resolveSocket(p[2])
				if (!sock) return
				const isPad = op === OP_PREAMP_PAD || op === OP_REPLY_PREAMP_PAD
				out.push({ kind: isPad ? 'preamp_pad' : 'preamp_48v', ...sock, on: p[3] >= 0x40 })
				return
			}
			default:
				return // unknown A&H op (including echoed sets/gets): ignored
		}
	}
}

function isAhSysex(body: number[]): boolean {
	for (let i = 1; i < SYSEX_HEADER.length; i++) {
		if (body[i - 1] !== SYSEX_HEADER[i]) return false
	}
	return true
}

export function decodeName(bytes: number[]): string {
	let s = ''
	for (const b of bytes) {
		if (b === 0) break
		s += b < 0x80 ? String.fromCharCode(b) : '�'
	}
	return s.trim()
}
