/**
 * The TCT readout's expressions, evaluated the way Companion 5 evaluates
 * them: its substr() is `String(v).slice(start, end)`, and a variable with no
 * value reads as "" (both copied from Companion's expression functions).
 */
import { describe, expect, it } from 'vitest'
import { load } from '../../test/ctlmock.js'
import { READOUT_FIELDS, readoutExpression, timecodeReadoutPresets } from './readout-defs.js'
import type { Catalogue } from './types.js'

const fx = load('tct.json')
const cat = { app: 'tct', name: 'Time Code Tool', version: 'x', hash: 'h', ...fx.catalogue } as Catalogue

const substr = (v: string | undefined, a: number, b: number): string => (v ?? '').slice(a, b)

function show(expr: string, timecode: string | undefined): string {
	const m = /^substr\(\$\(tct:timecode\), (\d+), (\d+)\) \|\| '--'$/.exec(expr)
	if (!m) throw new Error(`unexpected expression: ${expr}`)
	return substr(timecode, Number(m[1]), Number(m[2])) || '--'
}

type El = { id: string; font?: string; weight?: string; text: string | { value: string; isExpression: boolean } }
type Preset = { type: string; elements: El[]; feedbacks: { options: { value: string } }[] }

describe('Time Code Tool timecode readout', () => {
	const r = timecodeReadoutPresets(cat, 'tct')
	const keys = READOUT_FIELDS.map((f) => r?.presets[`p_tct__readout__${f.id}`] as unknown as Preset)
	const digits = keys.map((k) => k.elements.find((e) => e.id === 'digits') as El)
	const texts = digits.map((d) => (d.text as { value: string }).value)

	it('four layered keys: a field label over monospaced, zero-padded digits', () => {
		expect(keys.every((k) => k.type === 'layered')).toBe(true)
		expect(keys.map((k) => k.elements.find((e) => e.id === 'field')?.text)).toEqual(['HH', 'MM', 'SS', 'FF'])
		expect(digits.every((d) => d.font === 'companion-mono' && d.weight === 'bold')).toBe(true)
		expect(texts.map((e) => show(e, '09:05:00:07'))).toEqual(['09', '05', '00', '07'])
		expect(texts.map((e) => show(e, '10:00:00;12'))).toEqual(['10', '00', '00', '12'])
	})

	it('shows -- with no signal, and before the app has answered', () => {
		expect(texts.map((e) => show(e, fx.initial_state['tct.timecode'] as string))).toEqual(['--', '--', '--', '--'])
		expect(texts.map((e) => show(e, undefined))).toEqual(['--', '--', '--', '--'])
	})

	it('lights while locked or generating, and in freewheel, from the state feedback', () => {
		expect(keys[0].feedbacks.map((f) => f.options.value)).toEqual(['locked', 'generating', 'freewheel'])
		expect(r?.section).toMatchObject({ id: 'tct_readout', definitions: Object.keys(r?.presets ?? {}) })
	})

	it('follows the connection label, and needs a timecode in the catalogue', () => {
		expect(readoutExpression('tc2', 3)).toBe("substr($(tc2:timecode), 3, 5) || '--'")
		expect(timecodeReadoutPresets({ ...cat, state: [] }, 'tct')).toBeNull()
	})
})
