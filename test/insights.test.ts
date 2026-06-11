import { describe, it, expect } from 'vitest'
import { diagnose } from '../src/insights.js'
import type { UsageEvent } from '../src/schema.js'

const ev = (over: Partial<UsageEvent>): UsageEvent => ({
  agent: 'claude-code',
  sessionId: 's1',
  project: 'p',
  timestamp: '2026-06-05T10:00:00.000Z',
  model: 'claude-sonnet-4-6',
  inputTokens: 0,
  outputTokens: 100_000, // $1.50 each — clears MIN_COST quickly
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  toolCalls: [],
  sidechain: false,
  gitBranch: null,
  ...over,
})

const fill = (n: number, over: Partial<UsageEvent> = {}) =>
  Array.from({ length: n }, (_, i) => ev({ sessionId: `s${i % 7}`, ...over }))

describe("doctor's notes", () => {
  it('stays silent on thin data', () => {
    expect(diagnose([ev({})])).toEqual([])
    expect(diagnose(fill(60, { outputTokens: 1 }))).toEqual([]) // events but no cost
  })

  it('warns on low cache hit rate', () => {
    const notes = diagnose(fill(60, { inputTokens: 100_000, cacheReadTokens: 10_000 }))
    const cache = notes.find((n) => n.text.includes('cache hit rate'))
    expect(cache?.level).toBe('warn')
  })

  it('praises a healthy cache', () => {
    const notes = diagnose(fill(60, { inputTokens: 10_000, cacheReadTokens: 100_000 }))
    const cache = notes.find((n) => n.text.includes('Healthy cache'))
    expect(cache?.level).toBe('good')
  })

  it('warns on cache thrash (write premium exceeds read savings)', () => {
    // heavy cache writes, zero cache reads → pure write premium, no payoff
    const notes = diagnose(fill(60, { cacheWriteTokens: 100_000 }))
    const thrash = notes.find((n) => n.text.includes('Cache thrash'))
    expect(thrash?.level).toBe('warn')
  })

  it('stays quiet about thrash when reads recoup the writes', () => {
    const notes = diagnose(fill(60, { cacheWriteTokens: 100_000, cacheReadTokens: 2_000_000 }))
    expect(notes.some((n) => n.text.includes('Cache thrash'))).toBe(false)
  })

  it('flags executing-heavy spend with advice', () => {
    const notes = diagnose([
      ...fill(40, { toolCalls: ['Bash'] }),
      ...fill(20, { toolCalls: ['Edit'] }),
    ])
    expect(notes.some((n) => n.text.includes('command-running'))).toBe(true)
  })

  it('flags reasoning-heavy spend', () => {
    const notes = diagnose([...fill(40), ...fill(20, { toolCalls: ['Edit'] })])
    expect(notes.some((n) => n.text.includes('no-tool turns'))).toBe(true)
  })

  it('flags subagent-heavy spend', () => {
    const notes = diagnose([...fill(30, { sidechain: true }), ...fill(30, { toolCalls: ['Edit'] })])
    expect(notes.some((n) => n.text.includes('Subagents'))).toBe(true)
  })

  it('flags one session dominating spend', () => {
    const notes = diagnose([
      ...fill(50, { sessionId: 'whale', outputTokens: 500_000, toolCalls: ['Edit'] }),
      ...fill(10, { toolCalls: ['Edit'] }),
    ])
    expect(notes.some((n) => n.text.includes('of all spend'))).toBe(true)
  })

  it('calls out night-owl usage and sorts warns first', () => {
    // build night timestamps via local-time Date so the test is TZ-independent
    const d = new Date(2026, 5, 5, 2, 0, 0)
    const notes = diagnose([
      ...fill(20, { timestamp: d.toISOString() }),
      ...fill(40, { inputTokens: 100_000, cacheReadTokens: 0 }),
    ])
    expect(notes.some((n) => n.text.includes('midnight and 5am'))).toBe(true)
    expect(notes[0].level).toBe('warn') // low-cache warn sorts above info
  })
})
