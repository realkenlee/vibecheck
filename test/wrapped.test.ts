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

  it('tracks longest session turns and compactions — numbers only, no names', () => {
    const c = { sessionId: 's2', timestamp: '2026-06-02T11:00:00.000Z', trigger: 'auto', preTokens: 1, postTokens: 1 }
    const s = wrappedStats(events, [c, c, c])
    expect(s.longestSessionTurns).toBe(2) // s2 has 2 turns
    expect(s.compactions).toBe(3)
  })

  it('sums turn durations into agent hours — runtime, not wall-clock', () => {
    const td = (ms: number) => ({ sessionId: 's1', timestamp: '2026-06-01T10:00:00.000Z', ms })
    expect(wrappedStats(events, [], [td(5_400_000)]).agentHours).toBeCloseTo(1.5)
    expect(wrappedStats(events, [], [td(3_600_000), td(1_800_000)]).agentHours).toBeCloseTo(1.5)
    expect(wrappedStats(events).agentHours).toBeNull() // no records (codex) -> null, not 0
  })
})

describe('wrappedSvg', () => {
  it('never leaks project or branch names — the card is made to be shared', () => {
    const svg = wrappedSvg(wrappedStats([ev({}), ev({ sessionId: 's2' })]), 'all time')
    expect(svg).not.toContain('secret-codename')
    expect(svg).not.toContain('secret-feature')
    expect(svg).toContain('claude-sonnet-4-6') // model name is fine
    expect(svg).toContain('npx vibe-check')
  })

  it('shows marathon stats only when they clear the thresholds', () => {
    // 120-turn session + 3 compactions -> second footer line appears
    const marathon = Array.from({ length: 120 }, (_, i) =>
      ev({ timestamp: `2026-06-05T10:${String(i % 60).padStart(2, '0')}:00.000Z` }),
    )
    const c = { sessionId: 's1', timestamp: '2026-06-05T10:30:00.000Z', trigger: 'auto', preTokens: 1, postTokens: 1 }
    const svg = wrappedSvg(wrappedStats(marathon, [c, c, c]), 'all time')
    expect(svg).toContain('longest session 120 turns')
    expect(svg).toContain('3 compactions survived')
    // small sessions, no compactions -> line absent
    const quiet = wrappedSvg(wrappedStats([ev({}), ev({ sessionId: 's2' })]), 'all time')
    expect(quiet).not.toContain('longest session')
    expect(quiet).not.toContain('compactions survived')
  })

  it('shows agent runtime only past an hour', () => {
    const td = (ms: number) => ({ sessionId: 's1', timestamp: '2026-06-05T10:00:00.000Z', ms })
    const svg = wrappedSvg(wrappedStats([ev({})], [], [td(8_280_000)]), 'all time')
    expect(svg).toContain('2.3h of agent runtime')
    // under an hour -> line absent (a "0.4h" brag is no brag)
    const quiet = wrappedSvg(wrappedStats([ev({})], [], [td(1_500_000)]), 'all time')
    expect(quiet).not.toContain('agent runtime')
  })

  it('escapes markup in model names', () => {
    const svg = wrappedSvg(wrappedStats([ev({ model: '<evil>&model' })]), 'all time')
    expect(svg).not.toContain('<evil>')
    expect(svg).toContain('&lt;evil&gt;&amp;model')
  })
})
