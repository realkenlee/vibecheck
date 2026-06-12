import { describe, it, expect } from 'vitest'
import { teamReport } from '../src/export.js'
import { byBranch } from '../src/analytics.js'
import type { UsageEvent } from '../src/schema.js'

const ev = (over: Partial<UsageEvent>): UsageEvent => ({
  agent: 'claude-code',
  sessionId: 's1',
  project: 'secret-codename',
  timestamp: '2026-06-05T10:00:00.000Z',
  model: 'claude-sonnet-4-6',
  inputTokens: 100,
  outputTokens: 1000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  toolCalls: [],
  sidechain: false,
  gitBranch: 'feat/secret-feature',
  ...over,
})

describe('byBranch', () => {
  it('buckets by branch with (unknown) fallback for codex', () => {
    const buckets = byBranch([
      ev({}),
      ev({ gitBranch: 'main' }),
      ev({ agent: 'codex', gitBranch: null }),
    ])
    const keys = buckets.map((b) => b.key).sort()
    expect(keys).toEqual(['(unknown)', 'feat/secret-feature', 'main'])
  })
})

describe('teamReport (the enterprise seam)', () => {
  const events = [
    ev({}),
    ev({ timestamp: '2026-06-07T15:00:00.000Z', toolCalls: ['Edit'] }),
  ]

  it('contains aggregates only — no project/branch/session/tool identifiers by default', () => {
    const r = teamReport(events, { now: new Date('2026-06-10T12:00:00') })
    const json = JSON.stringify(r)
    expect(json).not.toContain('secret-codename')
    expect(json).not.toContain('secret-feature')
    expect(json).not.toContain('"s1"')
    expect(r.byProject).toBeUndefined()
    expect(r.byBranch).toBeUndefined()
    expect(r.schema).toBe('vibecheck.report.v1')
  })

  it('derives the period from the data', () => {
    const r = teamReport(events, { now: new Date('2026-06-10T12:00:00') })
    expect(r.period.from).toBe('2026-06-05')
    expect(r.period.to).toBe('2026-06-07')
  })

  it('includes activity and budget rollups', () => {
    const r = teamReport(events, { budget: 100, now: new Date('2026-06-10T12:00:00') })
    expect(r.byActivity.map((b) => b.activity).sort()).toEqual(['editing', 'reasoning'])
    expect(r.budget!.month).toBe('2026-06')
    expect(r.budget!.spent).toBeCloseTo(0.0306, 3) // 2 × (100×$3 + 1000×$15)/1M
  })

  it('opt-in projects/branches with --include-projects', () => {
    const r = teamReport(events, { includeProjects: true })
    expect(r.byProject![0].key).toBe('secret-codename')
    expect(r.byBranch![0].key).toBe('feat/secret-feature')
  })

  it('anonymous strips git identity', () => {
    const r = teamReport(events, { anonymous: true })
    expect(r.user).toEqual({ name: null, email: null })
  })

  it('carries insight ids+levels but NEVER the rendered note text', () => {
    // enough volume to clear the doctor's MIN_EVENTS/MIN_COST floor, plus
    // file reads that trigger the re-read tax note (whose text names a file)
    const many = Array.from({ length: 60 }, (_, i) =>
      ev({ sessionId: 's1', outputTokens: 1_000_000, toolCalls: ['Read'], timestamp: `2026-06-05T10:${String(i % 60).padStart(2, '0')}:00.000Z` }),
    )
    const reads = Array.from({ length: 60 }, () => ({
      sessionId: 's1',
      timestamp: '2026-06-05T10:00:00.000Z',
      file: 'topsecret.py',
      bytes: 5000,
    }))
    const r = teamReport(many, { fileReads: reads })
    expect(r.insights.length).toBeGreaterThan(0)
    expect(r.insights.map((n) => n.id)).toContain('re-read-tax')
    for (const n of r.insights) expect(Object.keys(n).sort()).toEqual(['id', 'level'])
    const json = JSON.stringify(r)
    expect(json).not.toContain('topsecret') // file names stay local
    expect(json).not.toContain('Re-read tax') // note text stays local
  })
})
