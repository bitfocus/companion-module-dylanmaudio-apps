/**
 * What the talk flash adds to a Talk Light Trigger connection
 * (brief-companion-control.md §5): the blinking feedback, the EXIT action
 * that starts the cooldown, the two variables the triggers read, and a
 * TALK key preset.
 *
 * The page switching is not here and cannot be. Module presets may only use
 * a small set of Companion's internal actions, and "Surface: set page" is
 * not among them. So the TALK page, its EXIT key and the two triggers ship
 * as an importable Companion file.
 */

import {
	combineRgb,
	type CompanionActionDefinitions,
	type CompanionFeedbackDefinitions,
	type CompanionPresetDefinitions,
} from '@companion-module/base'
import type { ActionsSchema } from '../actions.js'
import type { FeedbacksSchema } from '../feedbacks.js'
import type { ModuleSchema } from '../main.js'
import type { TalkFlash } from './talkflash.js'

export const TALK_FLASH_FEEDBACK = 'talk_flash'
export const TALK_FLASH_EXIT = 'talk_flash_exit'
export const TALK_FLASH_PRESET = 'p_talk_flash_key'

export const TALK_FLASH_VARIABLES: Record<string, string> = {
	talk_active: 'Talk is active (Talk Light Trigger reports talk)',
	talk_flash_armed: 'A new talk will take the decks over (no EXIT cooldown running)',
	talk_flash_exited: 'EXIT was pressed during this talk — the deck already went back',
	talk_flash_took_over: 'The last talk took the decks over (it started while armed)',
	talk_page: 'The page the TALK page was imported to (connection setting; 0 = not set)',
}

const RED = combineRgb(255, 40, 40)
const WHITE = combineRgb(255, 255, 255)

export function talkFlashActions(flash: TalkFlash): CompanionActionDefinitions<ActionsSchema> {
	return {
		[TALK_FLASH_EXIT]: {
			name: 'Talk flash: exit',
			description:
				'For the TALK page\'s EXIT key, after "Surface: Set to page → back". Starts the cooldown, during which a new talk does not take the decks over again.',
			options: [],
			callback: () => flash.exit(),
		},
	}
}

export function talkFlashFeedbacks(flash: TalkFlash): CompanionFeedbackDefinitions<FeedbacksSchema> {
	return {
		[TALK_FLASH_FEEDBACK]: {
			type: 'boolean',
			name: 'Talk flash',
			description:
				'Blinks while Talk Light Trigger reports talk. Every key carrying it blinks in phase, from one timer; the rate is set in the connection.',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [],
			callback: () => flash.lit,
		},
	}
}

export function talkFlashPresets(): CompanionPresetDefinitions<ModuleSchema> {
	return {
		[TALK_FLASH_PRESET]: {
			type: 'simple',
			name: 'TALK key (flashes while talking)',
			style: { text: 'TALK', textExpression: false, size: 'auto', color: RED, bgcolor: WHITE },
			feedbacks: [{ feedbackId: TALK_FLASH_FEEDBACK, options: {}, style: { bgcolor: RED, color: WHITE } }],
			steps: [{ down: [], up: [] }],
		},
	}
}
