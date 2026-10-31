import { describe, expect, test, tier } from 'claude-code/testing'

import { bump, effective, reminder, unused, uses } from '../hooks/register'

tier('user')

describe('the reminder', () => {
  test('nothing picked adds nothing', () => {
    expect(reminder({ skills: [], plugins: [] }, 'advise')).toBe(null)
    expect(reminder({ skills: [], plugins: [] }, 'gate')).toBe(null)
  })

  test('a starred plugin swallows the picked skills inside it', () => {
    const p = { plugins: ['caveman'], skills: ['caveman:caveman', 'ponytail:ponytail', 'animate'] }
    expect(effective(p).skills).toEqual(['ponytail:ponytail', 'animate'])
    const text = reminder(p, 'advise') ?? ''
    expect(text).toContain('any caveman skill')
    expect(text).not.toContain('caveman:caveman')
  })

  test('advise leaves the choice to the model, gate asks for a skill', () => {
    const p = { plugins: [], skills: ['ponytail:ponytail'] }
    expect(reminder(p, 'advise')).toMatch(/only if it does/)
    expect(reminder(p, 'advise')).toMatch(/Never invoke a skill just to satisfy/)
    expect(reminder(p, 'gate')).toMatch(/every turn, without being asked/)
  })

  test('the ledger counts what ran and flags picks that never did', () => {
    let u = bump({}, 'ponytail:ponytail', 1)
    u = bump(u, 'ponytail:ponytail', 2)
    u = bump(u, 'caveman:caveman', 3)
    expect(u['ponytail:ponytail']).toEqual({ n: 2, last: 2 })
    expect(uses(u, 'caveman', true)).toBe(1)
    expect(uses(u, 'ponytail:ponytail', false)).toBe(2)
    expect(uses(u, 'animate', false)).toBe(0)
    const p = { plugins: ['caveman', 'impeccable'], skills: ['ponytail:ponytail', 'animate', 'caveman:caveman'] }
    expect(unused(p, u)).toEqual({ plugins: ['impeccable'], skills: ['animate'] })
  })
})
