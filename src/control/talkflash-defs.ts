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
export const TALK_FLASH_REMEMBER = 'talk_flash_remember'
/** Decks whose page the module can remember: $(tlt:talk_return_1) … _4 */
export const TALK_FLASH_DECKS = 4

const RETURN_VARIABLES: Record<string, string> = Object.fromEntries(
	Array.from({ length: TALK_FLASH_DECKS }, (_, i) => [
		`talk_return_${i + 1}`,
		`The page deck ${i + 1} was last on, other than the TALK page — where "Talk end" and EXIT send it`,
	]),
)
export const TALK_FLASH_PRESET = 'p_talk_flash_key'

export const TALK_FLASH_VARIABLES: Record<string, string> = {
	...RETURN_VARIABLES,
	talk_active: 'Talk is active (Talk Light Trigger reports talk)',
	talk_flash_armed: 'A new talk will take the decks over (no EXIT cooldown running)',
	talk_flash_exited: 'EXIT was pressed during this talk — the deck already went back',
	talk_flash_took_over: 'The last talk took the decks over (it started while armed)',
	talk_page: 'The page the TALK page was imported to (connection setting; 0 = not set)',
}

const RED = combineRgb(255, 40, 40)
const WHITE = combineRgb(255, 255, 255)

export function talkFlashActions(
	flash: TalkFlash,
	remember?: (deck: number, page: number) => void,
): CompanionActionDefinitions<ActionsSchema> {
	return {
		...(remember
			? {
					[TALK_FLASH_REMEMBER]: {
						name: "Talk flash: remember a deck's page",
						description:
							'For a trigger on the deck\'s page variable: keeps the last page the deck was on, other than the TALK page, as $(tlt:talk_return_N). "Talk end" and EXIT send the deck back there, without relying on Companion\'s page history.',
						options: [
							{
								type: 'dropdown',
								id: 'deck',
								label: 'Deck',
								default: 1,
								choices: Array.from({ length: TALK_FLASH_DECKS }, (_, i) => ({ id: i + 1, label: `Deck ${i + 1}` })),
							},
							{
								type: 'textinput',
								id: 'page',
								label: "The deck's current page",
								tooltip:
									'Its page variable, e.g. $(internal:surface_streamdeck_<serial>_page), found under Variables → internal. Set this field to expression mode.',
								default: '',
								useVariables: true,
							},
						],
						callback: async (a) => {
							const page = a.options.page
							remember(
								Number(a.options.deck),
								typeof page === 'number' ? page : Number(typeof page === 'string' ? page.trim() : NaN),
							)
						},
					},
				}
			: {}),
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
