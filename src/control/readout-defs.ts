/**
 * Time Code Tool: a four-key timecode readout (hours, minutes, seconds,
 * frames), zero-padded, in Companion Mono so the digits don't shift as they
 * change, each under a small field label.
 *
 * Each key slices $(tct:timecode) rather than showing tct.tc_h/m/s/f. The
 * string is fixed-width HH:MM:SS:FF (with ";" before the frames in
 * drop-frame), already zero-padded, and reads "--" in each field with no
 * signal. Using one variable also keeps the four keys in step: the separate
 * numbers arrive as four events, and at 10 Hz the keys would briefly
 * disagree across a rollover. In Companion 5, substr() is String.slice and
 * an unset variable reads as "", so `|| '--'` covers the moment before the
 * app has answered.
 */

import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type { ModuleSchema } from '../main.js'
import { enumFeedbackId, variableId } from './definitions.js'
import type { Catalogue } from './types.js'

export const TIMECODE_KEY = 'tct.timecode'
const STATE_KEY = 'tct.state'

export const READOUT_FIELDS = [
	{ id: 'hh', name: 'hours', start: 0 },
	{ id: 'mm', name: 'minutes', start: 3 },
	{ id: 'ss', name: 'seconds', start: 6 },
	{ id: 'ff', name: 'frames', start: 9 },
] as const

export const readoutExpression = (label: string, start: number): string =>
	`substr($(${label}:${variableId('tct', TIMECODE_KEY)}), ${start}, ${start + 2}) || '--'`

const BLACK = 0x000000
const DIM = 0x9a9a9a
const LABEL = 0x6b6b78
const GREEN = 0x3ddc84
const AMBER = 0xffb300

type Preset = NonNullable<CompanionPresetDefinitions<ModuleSchema>[string]>

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
	for (const f of READOUT_FIELDS) {
		presets[`p_tct__readout__${f.id}`] = {
			type: 'layered',
			name: `Timecode readout: ${f.name}`,
			elements: [
				{ type: 'box', id: 'bg', x: 0, y: 0, width: 100, height: 100, color: BLACK },
				{
					type: 'text',
					id: 'field',
					x: 0,
					y: 2,
					width: 100,
					height: 22,
					text: f.id.toUpperCase(),
					fontsize: 100,
					font: 'companion-sans',
					color: LABEL,
					halign: 'center',
					valign: 'center',
				},
				{
					type: 'text',
					id: 'digits',
					x: 0,
					y: 22,
					width: 100,
					height: 74,
					text: { isExpression: true, value: readoutExpression(label, f.start) },
					fontsize: 92,
					fontsizeAllowShrink: true,
					font: 'companion-mono',
					weight: 'bold',
					color: DIM,
					halign: 'center',
					valign: 'center',
				},
			],
			feedbacks: lit.map(({ value, color }) => ({
				feedbackId: enumFeedbackId(STATE_KEY),
				options: { value },
				// wrapped: Companion drops a plain-valued override (see looks.ts)
				styleOverrides: [
					{ elementId: 'digits', elementProperty: 'color', override: { value: color, isExpression: false } },
				],
			})),
			steps: [{ down: [], up: [] }],
		} as unknown as Preset
	}
	return { section: { id: 'tct_readout', name: 'Timecode readout', definitions: Object.keys(presets) }, presets }
}
