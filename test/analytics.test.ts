import { describe, it, expect } from 'vitest'
import type { UsageEvent } from '../src/schema.js'
import { totals, byModel, byDay, toolUsage, hourlyHistogram, filterDays } from '../src/analytics.js'
import { eventCost, cacheSavings, rateFor } from '../src/pricing.js'

const ev = (over: Partial<UsageEvent>): UsageEvent => ({
  agent: 'claude-code',
  sessionId: 's1',
  project: 'p',
  timestamp: '2026-06-01T10:00:00.000Z',
  model: 'claude-sonnet-4-6',
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  toolCalls: [],
  sidechain: false,
  ...over,
})

describe('pricing', () => {
  it('prices sonnet at $3/$15 per MTok', () => {
    const c = eventCost(ev({ inputTokens: 1_000_000, outputTokens: 1_000_000 }))
    expect(c).toBeCloseTo(18)
  })

  it('prices cache reads at 10% of input', () => {
    const c = eventCost(ev({ cacheReadTokens: 1_000_000 }))
    expect(c).toBeCloseTo(0.3)
  })

  it('uses repriced rates for opus 4.5+', () => {
    expect(rateFor('claude-opus-4-8')!.input).toBe(5)
    expect(rateFor('claude-opus-4-1')!.input).toBe(15)
  })

  it('computes cache savings as full-rate minus cached-rate', () => {
    const s = cacheSavings(ev({ cacheReadTokens: 1_000_000 }))
    expect(s).toBeCloseTo(2.7) // 3.00 - 0.30
  })

  it('returns null for unknown models', () => {
    expect(eventCost(ev({ model: 'mystery-model-9000' }))).toBeNull()
  })
})

describe('analytics', () => {
  const events = [
    ev({ inputTokens: 100, outputTokens: 50, sessionId: 'a' }),
    ev({ inputTokens: 200, cacheReadTokens: 1000, sessionId: 'b', model: 'claude-opus-4-8' }),
    ev({ model: 'mystery-model-9000', inputTokens: 999, sessionId: 'b' }),
  ]

  it('totals tokens and flags unpriced models', () => {
    const t = totals(events)
    expect(t.inputTokens).toBe(1299)
    expect(t.sessions).toBe(2)
    expect(t.unknownModels).toEqual(['mystery-model-9000'])
  })

  it('buckets by model sorted by cost', () => {
    const b = byModel(events)
    expect(b.map((x) => x.key)).toContain('claude-sonnet-4-6')
    expect(b).toHaveLength(3)
  })

  it('buckets by local day', () => {
    const b = byDay(events)
    expect(b).toHaveLength(1)
    expect(b[0].events).toBe(3)
  })

  it('counts tool usage', () => {
    const t = toolUsage([ev({ toolCalls: ['Bash', 'Read'] }), ev({ toolCalls: ['Bash'] })])
    expect(t[0]).toEqual(['Bash', 2])
  })

  it('builds a 24-slot hourly histogram', () => {
    const h = hourlyHistogram(events)
    expect(h).toHaveLength(24)
    expect(h.reduce((a, b) => a + b)).toBe(3)
  })

  it('filters by day window', () => {
    const now = new Date('2026-06-03T00:00:00.000Z')
    expect(filterDays(events, 1, now)).toHaveLength(0)
    expect(filterDays(events, 3, now)).toHaveLength(3)
  })
})
