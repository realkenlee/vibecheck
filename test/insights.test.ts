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

  it('warns on context tax in marathon sessions', () => {
    // one 120-turn session, 1min apart (no idle gaps): early turns read ~1k
    // cached tokens, turns 100+ read 30M — late turns re-pay the whole history
    const at = (i: number) => new Date(Date.UTC(2026, 5, 5, 10, i)).toISOString()
    const events = Array.from({ length: 120 }, (_, i) =>
      ev({
        sessionId: 'marathon',
        timestamp: at(i),
        cacheReadTokens: i < 25 ? 1_000 : i >= 100 ? 30_000_000 : 1_000_000,
      }),
    )
    const notes = diagnose(events)
    const tax = notes.find((n) => n.text.includes('Context tax'))
    expect(tax?.level).toBe('warn') // tax dominates total cost here
    expect(tax?.text).toContain('1 session ran past 100 turns')
  })

  it('flags idle gaps that expire the prompt cache', () => {
    // 60 turns spaced 6min apart → every turn follows a >5min gap and re-writes
    // 3M tokens of cache; short session (<100 turns) so no context-tax overlap
    const at = (i: number) => new Date(Date.UTC(2026, 5, 5, 10, i * 6)).toISOString()
    const events = Array.from({ length: 60 }, (_, i) =>
      ev({ sessionId: 'gappy', timestamp: at(i), cacheWriteTokens: 3_000_000 }),
    )
    const notes = diagnose(events)
    const gaps = notes.find((n) => n.text.includes('idle gaps >5min'))
    expect(gaps?.level).toBe('info')
  })

  it('flags a high tool-failure rate', () => {
    const notes = diagnose([
      ...fill(100, { toolCalls: ['Bash'], toolResultBytes: 500, toolErrors: 0 }),
      ...fill(20, { toolCalls: ['Bash'], toolResultBytes: 500, toolErrors: 1 }),
    ])
    const tax = notes.find((n) => n.text.includes('failing call'))
    expect(tax?.level).toBe('info')
    expect(tax?.text).toContain('20 of 120')
  })

  it('warns on fat tool results, praises lean ones', () => {
    const fat = diagnose(fill(120, { toolCalls: ['Bash'], toolResultBytes: 20_000 }))
    expect(fat.find((n) => n.text.includes('Fat tool results'))?.level).toBe('warn')
    const lean = diagnose(fill(120, { toolCalls: ['Bash'], toolResultBytes: 500 }))
    expect(lean.find((n) => n.text.includes('Lean tool results'))?.level).toBe('good')
  })

  it('stays quiet on result diet when sizes were never captured', () => {
    const notes = diagnose(fill(120, { toolCalls: ['Bash'] })) // toolResultBytes undefined
    expect(notes.some((n) => n.text.includes('tool results'))).toBe(false)
  })

  it('flags verbosity drift month over month', () => {
    const notes = diagnose([
      ...fill(200, { timestamp: '2026-05-05T10:00:00.000Z', outputTokens: 100_000 }),
      ...fill(200, { timestamp: '2026-06-05T10:00:00.000Z', outputTokens: 220_000 }),
    ])
    const drift = notes.find((n) => n.text.includes('Responses are getting longer'))
    expect(drift?.level).toBe('info')
    expect(drift?.text).toContain('2026-05 → 2026-06')
  })

  it('reports auto-forced compactions with their token receipts', () => {
    const compaction = (trigger: string) => ({
      sessionId: 's1',
      timestamp: '2026-06-05T10:00:00.000Z',
      trigger,
      preTokens: 160_000,
      postTokens: 10_000,
    })
    const notes = diagnose(fill(60), [compaction('auto'), compaction('auto'), compaction('auto')])
    const c = notes.find((n) => n.text.includes('compactions were auto-forced'))
    expect(c?.level).toBe('info')
    expect(c?.text).toContain('All 3')
    expect(c?.text).toContain('~150k')
  })

  it('stays quiet when compactions are mostly manual', () => {
    const compaction = (trigger: string) => ({
      sessionId: 's1',
      timestamp: '2026-06-05T10:00:00.000Z',
      trigger,
      preTokens: 160_000,
      postTokens: 10_000,
    })
    const notes = diagnose(fill(60), [
      compaction('manual'),
      compaction('manual'),
      compaction('auto'),
    ])
    expect(notes.some((n) => n.text.includes('auto-forced'))).toBe(false)
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
