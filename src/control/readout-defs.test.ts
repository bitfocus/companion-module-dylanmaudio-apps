/**
 * The TCT readouts' expressions, evaluated the way Companion 5 evaluates
 * them: its substr() is `String(v).slice(start, end)`, and a variable with no
 * value reads as "" (both copied from Companion's expression functions).
 */
import { describe, expect, it } from 'vitest'
import { load } from '../../test/ctlmock.js'
import { READOUT_FIELDS, READOUT_PAIRS, readoutExpression, timecodeReadoutPresets } from './readout-defs.js'
import type { Catalogue } from './types.js'

const fx = load('tct.json')
const cat = { app: 'tct', name: 'Time Code Tool', version: 'x', hash: 'h', ...fx.catalogue } as Catalogue

const substr = (v: string | undefined, a: number, b: number): string => (v ?? '').slice(a, b)

function show(expr: string, timecode: string | undefined): string {
	const m = /^substr\(\$\(tct:timecode\), (\d+), (\d+)\) \|\| '([-:]+)'$/.exec(expr)
	if (!m) throw new Error(`unexpected expression: ${expr}`)
	return substr(timecode, Number(m[1]), Number(m[2])) || m[3]
}

type El = {
	id: string
	font?: string
	weight?: string
	height: number
	fontsize: number
	text: string | { value: string }
}
type Preset = { type: string; elements: El[]; feedbacks: { options: { value: string } }[] }
const r = timecodeReadoutPresets(cat, 'tct')
const keysOf = (ids: readonly { id: string }[]) =>
	ids.map((f) => r?.presets[`p_tct__readout__${f.id}`] as unknown as Preset)
const el = (k: Preset, id: string) => k.elements.find((e) => e.id === id) as El
const exprOf = (k: Preset) => (el(k, 'digits').text as { value: string }).value
/** Companion draws text at fontsize% of the element's own height, over 1.2 */
const percentOfKey = (e: El) => (e.fontsize * e.height) / 100 / 1.2

describe('Time Code Tool timecode readout: four keys', () => {
	const keys = keysOf(READOUT_FIELDS)

	it('a small field label over large, monospaced, zero-padded digits', () => {
		expect(keys.every((k) => k.type === 'layered')).toBe(true)
		expect(keys.map((k) => el(k, 'field').text)).toEqual(['HH', 'MM', 'SS', 'FF'])
		expect(keys.every((k) => el(k, 'digits').font === 'companion-mono' && el(k, 'digits').weight === 'bold')).toBe(true)
		expect(percentOfKey(el(keys[0], 'digits'))).toBeGreaterThan(65)
		expect(percentOfKey(el(keys[0], 'field'))).toBeLessThan(15)
		expect(keys.map((k) => show(exprOf(k), '09:05:00:07'))).toEqual(['09', '05', '00', '07'])
		expect(keys.map((k) => show(exprOf(k), '10:00:00;12'))).toEqual(['10', '00', '00', '12'])
	})

	it('shows -- with no signal, and before the app has answered', () => {
		expect(keys.map((k) => show(exprOf(k), fx.initial_state['tct.timecode'] as string))).toEqual([
			'--',
			'--',
			'--',
			'--',
		])
		expect(keys.map((k) => show(exprOf(k), undefined))).toEqual(['--', '--', '--', '--'])
	})

	it('lights while locked or generating, and in freewheel, from the state feedback', () => {
		expect(keys[0].feedbacks.map((f) => f.options.value)).toEqual(['locked', 'generating', 'freewheel'])
	})
})

describe('Time Code Tool timecode readout: two keys', () => {
	const keys = keysOf(READOUT_PAIRS)

	it('HH:MM and SS:FF, with drop-frame shown as the app shows it', () => {
		expect(keys.map((k) => el(k, 'field').text)).toEqual(['HH:MM', 'SS:FF'])
		expect(keys.map((k) => show(exprOf(k), '09:05:00:07'))).toEqual(['09:05', '00:07'])
		expect(keys.map((k) => show(exprOf(k), '10:00:00;12'))).toEqual(['10:00', '00;12'])
	})

	it('shows --:-- with no signal, and before the app has answered', () => {
		expect(keys.map((k) => show(exprOf(k), '--:--:--:--'))).toEqual(['--:--', '--:--'])
		expect(keys.map((k) => show(exprOf(k), undefined))).toEqual(['--:--', '--:--'])
	})
})

describe('Time Code Tool timecode readout presets', () => {
	it('one section holding both layouts', () => {
		expect(r?.section).toMatchObject({ id: 'tct_readout', definitions: Object.keys(r?.presets ?? {}) })
		expect(Object.keys(r?.presets ?? {})).toHaveLength(6)
	})

	it('follows the connection label, and needs a timecode in the catalogue', () => {
		expect(readoutExpression('tc2', 3)).toBe("substr($(tc2:timecode), 3, 5) || '--'")
		expect(readoutExpression('tc2', 6, 5)).toBe("substr($(tc2:timecode), 6, 11) || '--:--'")
		expect(timecodeReadoutPresets({ ...cat, state: [] }, 'tct')).toBeNull()
	})
})
