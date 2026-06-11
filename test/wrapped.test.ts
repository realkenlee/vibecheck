import { describe, it, expect } from 'vitest'
import { wrappedStats, wrappedSvg, longestStreak } from '../src/wrapped.js'
import type { UsageEvent } from '../src/schema.js'

const ev = (over: Partial<UsageEvent>): UsageEvent => ({
  agent: 'claude-code',
  sessionId: 's1',
  project: 'secret-codename',
  timestamp: '2026-06-05T10:00:00.000Z',
  model: 'claude-sonnet-4-6',
  inputTokens: 100,
  outputTokens: 1_000_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  toolCalls: ['Edit'],
  sidechain: false,
  gitBranch: 'feat/secret-feature',
  ...over,
})

describe('longestStreak', () => {
  it('finds the longest consecutive-day run', () => {
    expect(longestStreak(['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-07', '2026-06-08'])).toBe(3)
  })
  it('handles single days and gaps', () => {
    expect(longestStreak([])).toBe(0)
    expect(longestStreak(['2026-06-01'])).toBe(1)
    expect(longestStreak(['2026-06-01', '2026-06-03', '2026-06-05'])).toBe(1)
  })
  it('spans month boundaries', () => {
    expect(longestStreak(['2026-05-30', '2026-05-31', '2026-06-01'])).toBe(3)
  })
})

describe('wrappedStats', () => {
  const events = [
    ev({ timestamp: '2026-06-01T10:00:00.000Z' }),
    ev({ timestamp: '2026-06-02T10:00:00.000Z', sessionId: 's2' }),
    ev({ timestamp: '2026-06-03T22:00:00.000Z', sessionId: 's2', toolCalls: [] }),
  ]

  it('computes totals, streak, top model and activity', () => {
    const s = wrappedStats(events)
    expect(s.sessions).toBe(2)
    expect(s.activeDays).toBe(3)
    expect(s.streak).toBe(3)
    expect(s.topModel).toBe('claude-sonnet-4-6')
    expect(s.topActivity!.name).toBe('editing') // 2 of 3 turns by cost
    expect(s.cost).toBeCloseTo(45.0009, 2)
  })
})

describe('wrappedSvg', () => {
  it('never leaks project or branch names — the card is made to be shared', () => {
    const svg = wrappedSvg(wrappedStats([ev({}), ev({ sessionId: 's2' })]), 'all time')
    expect(svg).not.toContain('secret-codename')
    expect(svg).not.toContain('secret-feature')
    expect(svg).toContain('claude-sonnet-4-6') // model name is fine
    expect(svg).toContain('npx vibevitals')
  })

  it('escapes markup in model names', () => {
    const svg = wrappedSvg(wrappedStats([ev({ model: '<evil>&model' })]), 'all time')
    expect(svg).not.toContain('<evil>')
    expect(svg).toContain('&lt;evil&gt;&amp;model')
  })
})
