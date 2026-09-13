/**
 * Builds companion/talk-flash.companionconfig — the TALK page and its two
 * triggers (brief-companion-control.md §5), as a Companion 5 "full" export
 * that holds only those, for users to import.
 *
 *     node tools/talk-flash-config.mjs      # rewrites the file
 *
 * The shapes are Companion 5's own (export version 12), taken from real
 * exports of this module's buttons and from Companion's source: layered
 * buttons, entity options wrapped as {value, isExpression}, trigger events
 * with plain options. The file is then round-tripped through a live
 * Companion — imported, and exported again — before it is committed.
 *
 * What the file does, and why it is shaped this way:
 *
 *   - EXIT (top-left) sends only the deck it is pressed on back a page
 *     ("Surface: Set to page", surface self, page back), then runs
 *     "Talk flash: exit" to start the cooldown.
 *   - Every other key is TALK, white with red text, carrying the Talk
 *     flash feedback: one module timer blinks them in phase.
 *   - "Talk start" fires on $(tlt:talk_active) changing, when talk is on,
 *     the flash is armed and a TALK page is set (0 = off), and sends deck 0
 *     to $(tlt:talk_page). The page
 *     number is a connection setting rather than a number baked in here,
 *     because whoever imports this can put the page anywhere.
 *   - "Talk end" fires on the same variable, when talk is off, the talk took
 *     the decks over, and EXIT wasn't pressed. It sends deck 0 back a page.
 *     The brief's per-deck "Surface: when on the selected page" condition
 *     needs a deck serial number, which a file for other people's
 *     rigs cannot carry. The module's talk_flash_took_over and
 *     talk_flash_exited variables stand in for it, exactly for one deck.
 *
 * Companion rewrites variable references in these expressions when an
 * import remaps the connection, so `tlt:` follows whatever the user named
 * their Talk Light connection.
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CONNECTION_ID = 'talkLightTrigger'
/**
 * The page's number inside the file. Companion's import picks a source page
 * from the file (starting at 1) and a destination page on the user's system,
 * so this is not where it lands: the connection's "TALK page number" setting
 * says that, and ships as 0 (off) until the user sets it.
 */
export const FILE_PAGE = 1
const RED = 0xff2828
const WHITE = 0xffffff
const DARK = 0x18181c

const v = (value) => ({ value, isExpression: false })
const expr = (value) => ({ value, isExpression: true })
const wrapAll = (o) =>
	Object.fromEntries(Object.entries(o).map(([k, val]) => [k, val?.isExpression !== undefined ? val : v(val)]))

function layers(text, bg, fg) {
	return [
		{
			id: 'canvas',
			name: 'Canvas',
			usage: 'auto',
			type: 'canvas',
			decoration: v('default'),
			showStatusIcons: v('default'),
		},
		{
			id: 'box0',
			name: 'Background',
			usage: 'auto',
			type: 'box',
			enabled: v(true),
			opacity: v(100),
			x: v(0),
			y: v(0),
			width: v(100),
			height: v(100),
			rotation: v(0),
			color: v(bg),
			borderWidth: v(0),
			borderColor: v(0),
			borderPosition: v('inside'),
		},
		{
			id: 'image0',
			name: 'Image',
			usage: 'auto',
			type: 'image',
			enabled: v(true),
			opacity: v(100),
			x: v(0),
			y: v(0),
			width: v(100),
			height: v(100),
			rotation: v(0),
			base64Image: v(null),
			halign: v('center'),
			valign: v('center'),
			fillMode: v('fit'),
		},
		{
			id: 'text0',
			name: 'Text',
			usage: 'auto',
			type: 'text',
			enabled: v(true),
			opacity: v(100),
			x: v(0),
			y: v(0),
			width: v(100),
			height: v(100),
			rotation: v(0),
			text: v(text),
			color: v(fg),
			halign: v('center'),
			valign: v('center'),
			fontsize: v(100),
			fontsizeAllowShrink: v(true),
			font: v('companion-sans'),
			outlineColor: v(4278190080),
		},
	]
}

// Companion stores its own (internal) entities with an empty children map and
// no upgrade index; a module's carry upgradeIndex -1. Written as it exports them.
const tail = (connectionId) => (connectionId === 'internal' ? { children: {} } : { upgradeIndex: -1 })
const action = (id, connectionId, definitionId, options = {}) => ({
	type: 'action',
	id,
	connectionId,
	definitionId,
	options: wrapAll(options),
	...tail(connectionId),
})
const feedback = (id, connectionId, definitionId, options = {}, styleOverrides = []) => ({
	type: 'feedback',
	id,
	connectionId,
	definitionId,
	options: wrapAll(options),
	isInverted: v(false),
	...tail(connectionId),
	styleOverrides,
})

function button(text, bg, fg, { feedbacks = [], down = [] } = {}) {
	return {
		type: 'button-layered',
		style: { layers: layers(text, bg, fg) },
		options: {
			stepProgression: 'auto',
			stepExpression: '',
			rotaryActions: false,
			canModifyStyleInApis: false,
			notes: '',
		},
		feedbacks,
		steps: { 0: { action_sets: { down, up: [] }, options: { runWhileHeld: [] } } },
		localVariables: [],
	}
}

function talkKey(row, col) {
	return button('TALK', WHITE, RED, {
		feedbacks: [
			feedback(`talk_${row}_${col}_flash`, CONNECTION_ID, 'talk_flash', {}, [
				{ overrideId: `talk_${row}_${col}_bg`, elementId: 'box0', elementProperty: 'color', override: v(RED) },
				{ overrideId: `talk_${row}_${col}_fg`, elementId: 'text0', elementProperty: 'color', override: v(WHITE) },
			]),
		],
	})
}

function exitKey() {
	return button('EXIT', DARK, WHITE, {
		down: [
			action('exit_back', 'internal', 'set_page', { surfaceId: 'self', page: 'back' }),
			action('exit_cooldown', CONNECTION_ID, 'talk_flash_exit'),
		],
	})
}

function trigger(name, sortOrder, notes, condition, actions) {
	return {
		type: 'trigger',
		options: { name, enabled: true, sortOrder, notes },
		actions,
		condition,
		events: [
			{
				id: `${name.replace(/\W+/g, '_')}_event`,
				type: 'variable_changed',
				enabled: true,
				options: { variableId: 'tlt:talk_active' },
			},
		],
		localVariables: [],
	}
}

export function buildTalkFlashConfig() {
	const controls = {}
	for (let row = 0; row <= 3; row++) {
		controls[row] = {}
		for (let col = 0; col <= 7; col++) controls[row][col] = row === 0 && col === 0 ? exitKey() : talkKey(row, col)
	}
	return {
		version: 12,
		type: 'full',
		pages: {
			[FILE_PAGE]: {
				id: 'talkFlashPage',
				name: 'TALK',
				controls,
				gridSize: { minColumn: 0, maxColumn: 7, minRow: 0, maxRow: 3 },
			},
		},
		triggers: {
			talkFlashStart: trigger(
				'Talk flash: talk start',
				0,
				'Talk Light reports talk, the flash is armed and a TALK page is set: send deck 0 to the TALK page. Duplicate this for each deck, changing the surface index.',
				[
					feedback('start_condition', 'internal', 'check_expression', {
						expression: '$(tlt:talk_active) && $(tlt:talk_flash_armed) && $(tlt:talk_page) > 0',
					}),
				],
				[action('start_page', 'internal', 'set_page_byindex', { surfaceIndex: 0, page: expr('$(tlt:talk_page)') })],
			),
			talkFlashEnd: trigger(
				'Talk flash: talk end',
				1,
				'Talk has ended: send deck 0 back — but only if this talk took it over and EXIT did not already send it back.',
				[
					feedback('end_condition', 'internal', 'check_expression', {
						expression: '!$(tlt:talk_active) && $(tlt:talk_flash_took_over) && !$(tlt:talk_flash_exited)',
					}),
				],
				[action('end_page', 'internal', 'set_page_byindex', { surfaceIndex: 0, page: 'back' })],
			),
		},
		triggerCollections: [],
		custom_variables: {},
		customVariablesCollections: [],
		instances: {
			[CONNECTION_ID]: {
				moduleInstanceType: 'connection',
				moduleId: 'dylanmaudio',
				moduleVersionId: null,
				updatePolicy: 'stable',
				sortOrder: 0,
				label: 'tlt',
				isFirstInit: false,
				config: {
					app: 'tlt',
					ctlHost: '127.0.0.1',
					ctlPort: 0,
					talkFlashHz: 2,
					talkFlashCooldownS: 10,
					talkFlashPage: 0,
				},
				secrets: {},
				lastUpgradeIndex: -1,
				enabled: true,
			},
		},
		connectionCollections: [],
		imageLibrary: [],
		imageLibraryCollections: [],
	}
}

export const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'companion', 'talk-flash.companionconfig')

if (import.meta.url === `file://${process.argv[1]}`) {
	writeFileSync(OUTPUT, JSON.stringify(buildTalkFlashConfig(), null, '\t') + '\n')
	console.log(`wrote ${OUTPUT}`)
}
