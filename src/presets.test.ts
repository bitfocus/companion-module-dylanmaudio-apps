/**
 * Scene presets carry the show's scene names: the recall key shows its scene's
 * name, the list of scenes reads by name, and button text refers to this
 * connection by its own label.
 */
import { describe, expect, it } from 'vitest'
import type { ModuleContext } from './context.js'
import { buildFeedbacks } from './feedbacks.js'
import { buildPresets } from './presets.js'

type Json = Record<string, any>

function ctxWith(names: [number, string][], label = 'dylanmaudio_dLive'): ModuleContext {
	const sceneNames = new Map(names)
	const state = { sceneNames, sceneName: (n?: number) => (n === undefined ? '' : (sceneNames.get(n) ?? '')) }
	return {
		link: { state, subscriptions: { touch: () => undefined, remove: () => undefined } },
		config: {},
		actionsMap: [],
		label,
		log: () => undefined,
		reloadShowFile: async () => undefined,
		resync: () => undefined,
	} as unknown as ModuleContext
}

describe('scene presets', () => {
	const ctx = ctxWith([
		[1, 'BPM - Specter'],
		[12, 'Changeover'],
	])
	const { presets, sections } = buildPresets(ctx, { inputs: 8, extendedTypes: false })

	it("the recall key shows its scene's name from the show", () => {
		const p = presets.scene_recall as Json
		expect(p.style.text).toBe('$(local:sc)\\n$(local:name)')
		expect(p.localVariables).toContainEqual({
			variableType: 'feedback',
			variableName: 'name',
			feedbackId: 'scene_name',
			options: { scene: { isExpression: true, value: '$(local:sc)' } },
		})
		const name = buildFeedbacks(ctx).scene_name
		expect(name?.callback({ options: { scene: 12 } }, {})).toBe('Changeover')
		expect(name?.callback({ options: { scene: 13 } }, {})).toBe('')
	})

	it('the list of scenes reads by name where the show has one', () => {
		const scenes = sections.find((s) => s.id === 'scenes')?.definitions as Json[]
		const values = scenes.find((d) => d.id === 'scene_recall_t')?.templateValues as Json[]
		expect(values[0]).toEqual({ value: 1, name: '1 BPM - Specter' })
		expect(values[1]).toEqual({ value: 2, name: 'Scene 2' })
		expect(values[11]).toEqual({ value: 12, name: '12 Changeover' })
	})

	it('refers to this connection by its own label, not "dlive"', () => {
		expect(JSON.stringify(presets)).not.toContain('$(dlive:')
		expect((presets.scene_current as Json).style.text).toContain('$(dylanmaudio_dLive:scene_current_name)')
		expect((presets.status as Json).style.text).toContain('$(dylanmaudio_dLive:firmware)')
	})
})

describe('MIDI Bridge presets', () => {
	const { presets } = buildPresets(ctxWith([]), { inputs: 8, extendedTypes: false })

	it("every text has a size: 'auto' picked a different one per label", () => {
		for (const [id, p] of Object.entries(presets)) {
			const style = (p as Json).style as Json | undefined
			if (style?.text !== undefined) expect(style.size, id).not.toBe('auto')
		}
	})

	it('sizes desk text to fit a full-length name, whole', () => {
		// a dLive name is up to 8 characters and a fixed size breaks rather than shrinks
		for (const id of ['mute_input', 'level_input', 'scene_recall']) {
			expect((presets[id] as Json).style.size, id).toBeLessThanOrEqual(10)
		}
	})

	it('a muted key says MUTED, in a red no desk colour uses', () => {
		const mute = presets.mute_input as Json
		const fb = (mute.feedbacks as Json[]).find((f) => f.feedbackId === 'mute') as Json
		expect((fb.style as Json).text).toContain('MUTED')
		expect((fb.style as Json).bgcolor).toBe(0x5a0000)
	})
})
