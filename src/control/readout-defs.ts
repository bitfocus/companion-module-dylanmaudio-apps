/**
 * Time Code Tool: a four-key timecode readout (hours, minutes, seconds,
 * frames), zero-padded.
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
const GREEN = 0x3ddc84
const AMBER = 0xffb300

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
			type: 'simple',
			name: `Timecode readout: ${f.name}`,
			style: {
				text: readoutExpression(label, f.start),
				textExpression: true,
				size: 'auto',
				color: DIM,
				bgcolor: BLACK,
			},
			feedbacks: lit.map(({ value, color }) => ({
				feedbackId: enumFeedbackId(STATE_KEY),
				options: { value },
				style: { color },
			})),
			steps: [{ down: [], up: [] }],
		}
	}
	return { section: { id: 'tct_readout', name: 'Timecode readout', definitions: Object.keys(presets) }, presets }
}
