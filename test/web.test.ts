import { describe, it, expect } from 'vitest'
import { dashboardHtml } from '../src/web.js'
import type { UsageEvent } from '../src/schema.js'

const ev = (over: Partial<UsageEvent>): UsageEvent => ({
  agent: 'claude-code',
  sessionId: 's1',
  project: 'acme-app',
  timestamp: '2026-06-05T10:00:00.000Z',
  model: 'claude-sonnet-4-6',
  inputTokens: 100,
  outputTokens: 1_000_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  toolCalls: ['Edit'],
  sidechain: false,
  gitBranch: 'main',
  ...over,
})

describe('web dashboard', () => {
  const events = [
    ev({}),
    ev({ timestamp: '2026-06-06T11:00:00.000Z', toolCalls: ['Bash'], sessionId: 's2' }),
  ]
  const html = dashboardHtml(events, { days: 30, now: new Date('2026-06-10T12:00:00') })

  it('is a self-contained static document (no external resources, no scripts)', () => {
    expect(html).toContain('<!doctype html>')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/src=["']https?:/i)
    expect(html).not.toMatch(/href=["']https?:/i)
  })

  it('renders vitals, sections, and local project data', () => {
    expect(html).toContain('API-equivalent spend')
    expect(html).toContain('Where tokens go')
    expect(html).toContain('acme-app') // local file — projects ARE included
    expect(html).toContain('Top sessions')
    expect(html).toContain('claude-sonnet-4-6')
  })

  it('shows the months trend only when usage spans multiple months', () => {
    expect(html).not.toContain('By month') // both events in 2026-06
    const multi = dashboardHtml([ev({}), ev({ timestamp: '2026-05-05T10:00:00.000Z' })], {})
    expect(multi).toContain('By month')
    expect(multi).toContain('2026-05')
  })

  it('shows the budget burn-down only when a budget is set', () => {
    expect(html).not.toContain('Budget (')
    const withBudget = dashboardHtml(events, { budget: 100, now: new Date('2026-06-10T12:00:00') })
    expect(withBudget).toContain('Budget (2026-06)')
    expect(withBudget).toContain('on pace')
  })

  it("threads compactions into the doctor's notes", () => {
    const many = Array.from({ length: 60 }, (_, i) => ev({ sessionId: `s${i % 7}` }))
    const compaction = {
      sessionId: 's0',
      timestamp: '2026-06-05T10:00:00.000Z',
      trigger: 'auto',
      preTokens: 160_000,
      postTokens: 10_000,
    }
    const withC = dashboardHtml(many, { compactions: [compaction, compaction, compaction] })
    expect(withC).toContain('auto-forced')
    expect(dashboardHtml(many, {})).not.toContain('auto-forced')
  })

  it('shows per-session gaps and compactions in Top sessions', () => {
    // two events 6min apart -> 1 gap in s1; one compaction attributed to s1
    const gapEvents = [
      ev({}),
      ev({ timestamp: '2026-06-05T10:06:00.000Z' }),
      ev({ sessionId: 's2', timestamp: '2026-06-06T11:00:00.000Z' }),
    ]
    const withC = dashboardHtml(gapEvents, {
      compactions: [
        { sessionId: 's1', timestamp: '2026-06-05T10:03:00.000Z', trigger: 'auto', preTokens: 1, postTokens: 1 },
      ],
    })
    expect(withC).toContain('>gaps<')
    expect(withC).toContain('>compact<')
    expect(withC).toMatch(/<td class="num">1<\/td><td class="num">1<\/td>/) // s1 row: 1 gap, 1 compaction
  })

  it("threads file reads into the doctor's notes", () => {
    const many = Array.from({ length: 60 }, (_, i) => ev({ sessionId: `s${i % 7}` }))
    const reads = Array.from({ length: 60 }, () => ({
      sessionId: 's0',
      timestamp: '2026-06-05T10:00:00.000Z',
      file: 'main.py',
      bytes: 5000,
    }))
    const withR = dashboardHtml(many, { fileReads: reads })
    expect(withR).toContain('Re-read tax')
    expect(dashboardHtml(many, {})).not.toContain('Re-read tax')
  })

  it('escapes hostile names everywhere', () => {
    const hostile = dashboardHtml(
      [ev({ project: '<img src=x onerror=alert(1)>', model: '"><script>', gitBranch: '<b>' })],
      {},
    )
    expect(hostile).not.toContain('<img src=x')
    expect(hostile).not.toContain('<script>')
    expect(hostile).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})
