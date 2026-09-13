import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clampTalkFlashCooldown, clampTalkFlashHz, TalkFlash } from './talkflash.js'

describe('TalkFlash', () => {
	let lit: boolean[]
	let armed: boolean[]
	let flash: TalkFlash
	beforeEach(() => {
		vi.useFakeTimers()
		lit = []
		armed = []
		flash = new TalkFlash({
			hz: 2,
			cooldownS: 10,
			onLit: () => lit.push(flash.lit),
			onArmed: (a) => armed.push(a),
		})
	})
	afterEach(() => {
		flash.stop()
		vi.useRealTimers()
	})

	it('lights at once when talk starts, then blinks at 2 Hz — lit and dark every 250 ms', () => {
		flash.setTalk(true)
		expect(flash.lit).toBe(true)
		vi.advanceTimersByTime(250)
		expect(flash.lit).toBe(false)
		vi.advanceTimersByTime(250)
		expect(flash.lit).toBe(true)
		vi.advanceTimersByTime(1000) // two more full blinks
		expect(lit).toEqual([true, false, true, false, true, false, true])
	})

	it('goes dark and stops ticking when talk ends', () => {
		flash.setTalk(true)
		vi.advanceTimersByTime(250)
		flash.setTalk(false)
		const calls = lit.length
		vi.advanceTimersByTime(2000)
		expect(flash.lit).toBe(false)
		expect(lit.length).toBe(calls)
	})

	it('EXIT disarms for the cooldown, then re-arms', () => {
		expect(flash.armed).toBe(true)
		flash.exit()
		expect(flash.armed).toBe(false)
		vi.advanceTimersByTime(9999)
		expect(flash.armed).toBe(false)
		vi.advanceTimersByTime(1)
		expect(flash.armed).toBe(true)
		expect(armed).toEqual([false, true])
	})

	it('a second EXIT restarts the cooldown without reporting a change it did not make', () => {
		flash.exit()
		vi.advanceTimersByTime(8000)
		flash.exit()
		vi.advanceTimersByTime(8000)
		expect(flash.armed).toBe(false)
		vi.advanceTimersByTime(2000)
		expect(flash.armed).toBe(true)
		expect(armed).toEqual([false, true])
	})

	it('a zero cooldown never disarms', () => {
		flash.configure(2, 0)
		flash.exit()
		expect(flash.armed).toBe(true)
		expect(armed).toEqual([])
	})

	it('picks up a new rate mid-talk', () => {
		flash.setTalk(true)
		flash.configure(1, 10) // 500 ms per half
		vi.advanceTimersByTime(250)
		expect(flash.lit).toBe(true)
		vi.advanceTimersByTime(250)
		expect(flash.lit).toBe(false)
	})

	it('caps the rate at 3 Hz and keeps both settings in range', () => {
		expect(clampTalkFlashHz(10)).toBe(3)
		expect(clampTalkFlashHz(0)).toBe(0.5)
		expect(clampTalkFlashHz('x')).toBe(2)
		expect(clampTalkFlashCooldown(-5)).toBe(0)
		expect(clampTalkFlashCooldown(999)).toBe(120)
		expect(clampTalkFlashCooldown(undefined)).toBe(10)
		expect(new TalkFlash({ hz: 99, cooldownS: 10, onLit: () => undefined, onArmed: () => undefined }).rateHz).toBe(3)
	})
})
