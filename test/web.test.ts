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

  it('shows the budget burn-down only when a budget is set', () => {
    expect(html).not.toContain('Budget (')
    const withBudget = dashboardHtml(events, { budget: 100, now: new Date('2026-06-10T12:00:00') })
    expect(withBudget).toContain('Budget (2026-06)')
    expect(withBudget).toContain('on pace')
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
