/**
 * Time Code Tool: timecode readouts in Companion Mono, so the digits don't
 * shift as they change, each under a small field label. Two layouts: four
 * keys (HH, MM, SS, FF) and two (HH:MM, SS:FF).
 *
 * Each key slices $(tct:timecode) rather than showing tct.tc_h/m/s/f. The
 * string is fixed-width HH:MM:SS:FF (with ";" before the frames in
 * drop-frame), already zero-padded, and reads "--" in each field with no
 * signal. Using one variable also keeps the keys in step: the separate
 * numbers arrive as four events, and at 10 Hz the keys would briefly
 * disagree across a rollover. In Companion 5, substr() is String.slice and
 * an unset variable reads as "", so the `||` fallback covers the moment
 * before the app has answered.
 *
 * Companion draws text at fontsize% of the element's own height (/1.2), so
 * sizes here are set by each element's box.
 */

import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type { ModuleSchema } from '../main.js'
import { enumFeedbackId, variableId } from './definitions.js'
import type { Catalogue } from './types.js'

export const TIMECODE_KEY = 'tct.timecode'
const STATE_KEY = 'tct.state'

/** The four-key readout: one field per key. */
export const READOUT_FIELDS = [
	{ id: 'hh', name: 'hours', label: 'HH', start: 0 },
	{ id: 'mm', name: 'minutes', label: 'MM', start: 3 },
	{ id: 'ss', name: 'seconds', label: 'SS', start: 6 },
	{ id: 'ff', name: 'frames', label: 'FF', start: 9 },
] as const

/** The two-key readout: HH:MM and SS:FF (SS;FF in drop-frame, as the app shows it). */
export const READOUT_PAIRS = [
	{ id: 'hhmm', name: 'hours and minutes', label: 'HH:MM', start: 0 },
	{ id: 'ssff', name: 'seconds and frames', label: 'SS:FF', start: 6 },
] as const

export const readoutExpression = (label: string, start: number, length = 2): string =>
	`substr($(${label}:${variableId('tct', TIMECODE_KEY)}), ${start}, ${start + length}) || '${length === 2 ? '--' : '--:--'}'`

const BLACK = 0x000000
const DIM = 0x9a9a9a
const LABEL = 0x6b6b78
const GREEN = 0x3ddc84
const AMBER = 0xffb300

type Preset = NonNullable<CompanionPresetDefinitions<ModuleSchema>[string]>
interface Box {
	y: number
	height: number
}

function readoutKey(
	name: string,
	fieldLabel: string,
	expression: string,
	digits: Box,
	lit: { value: string; color: number }[],
): Preset {
	const text = (id: string, value: unknown, box: Box, more: Record<string, unknown>) => ({
		type: 'text',
		id,
		x: 0,
		...box,
		width: 100,
		text: value,
		fontsize: 100,
		fontsizeAllowShrink: true,
		halign: 'center',
		valign: 'center',
		...more,
	})
	return {
		type: 'layered',
		name,
		elements: [
			{ type: 'box', id: 'bg', x: 0, y: 0, width: 100, height: 100, color: BLACK },
			text('field', fieldLabel, { y: 2, height: 17 }, { font: 'companion-sans', color: LABEL }),
			text('digits', { isExpression: true, value: expression }, digits, {
				font: 'companion-mono',
				weight: 'bold',
				color: DIM,
			}),
		],
		feedbacks: lit.map(({ value, color }) => ({
			feedbackId: enumFeedbackId(STATE_KEY),
			options: { value },
			// wrapped: Companion drops a plain-valued override (see looks/looks.ts)
			styleOverrides: [
				{ elementId: 'digits', elementProperty: 'color', override: { value: color, isExpression: false } },
			],
		})),
		steps: [{ down: [], up: [] }],
	} as unknown as Preset
}

export function timecodeReadoutPresets(
	cat: Catalogue,
	label: string,
): { section: CompanionPresetSection<ModuleSchema>; presets: CompanionPresetDefinitions<ModuleSchema> } | null {
	if (!cat.state.some((s) => s.key === TIMECODE_KEY)) return null
	const state = cat.state.find((s) => s.key === STATE_KEY && s.type === 'enum')
	const has = (v: string): boolean => state?.values?.includes(v) ?? false
	const lit = [
		...['locked', 'generating'].filter(has).map((value) => ({ value, color: GREEN })),
		...['freewheel'].filter(has).map((value) => ({ value, color: AMBER })),
	]
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	// Two characters per key: the digits fill the key under the label.
	for (const f of READOUT_FIELDS)
		presets[`p_tct__readout__${f.id}`] = readoutKey(
			`Timecode readout: ${f.name}`,
			f.label,
			readoutExpression(label, f.start),
			{ y: 17, height: 83 },
			lit,
		)
	// Five characters per key: the text shrinks to the key's width.
	for (const p of READOUT_PAIRS)
		presets[`p_tct__readout__${p.id}`] = readoutKey(
			`Timecode readout (2 keys): ${p.name}`,
			p.label,
			readoutExpression(label, p.start, 5),
			{ y: 22, height: 60 },
			lit,
		)
	return { section: { id: 'tct_readout', name: 'Timecode readout', definitions: Object.keys(presets) }, presets }
}
