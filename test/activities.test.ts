import { describe, it, expect } from 'vitest'
import { classifyEvent, byActivity } from '../src/activities.js'
import { budgetStatus } from '../src/analytics.js'
import type { UsageEvent } from '../src/schema.js'

const ev = (over: Partial<UsageEvent>): UsageEvent => ({
  agent: 'claude-code',
  sessionId: 's1',
  project: 'p',
  timestamp: '2026-06-05T10:00:00.000Z',
  model: 'claude-sonnet-4-6',
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  toolCalls: [],
  sidechain: false,
  gitBranch: null,
  ...over,
})

describe('activity classification', () => {
  it('classifies no-tool turns as reasoning', () => {
    expect(classifyEvent([])).toBe('reasoning')
  })

  it('editing wins over everything (Edit+Bash = editing)', () => {
    expect(classifyEvent(['Bash', 'Edit'])).toBe('editing')
    expect(classifyEvent(['Read', 'Write'])).toBe('editing')
  })

  it('maps codex tools too', () => {
    expect(classifyEvent(['apply_patch'])).toBe('editing')
    expect(classifyEvent(['shell'])).toBe('executing')
    expect(classifyEvent(['update_plan'])).toBe('planning')
  })

  it('precedence: exec > delegate > explore > plan', () => {
    expect(classifyEvent(['Read', 'Bash'])).toBe('executing')
    expect(classifyEvent(['Task', 'Read'])).toBe('delegating')
    expect(classifyEvent(['Grep', 'TodoWrite'])).toBe('exploring')
    expect(classifyEvent(['TodoWrite'])).toBe('planning')
  })

  it('unknown/MCP tools fall into other-tools', () => {
    expect(classifyEvent(['mcp__github__create_pr'])).toBe('other-tools')
  })

  it('byActivity attributes cost shares that sum to 1', () => {
    const buckets = byActivity([
      ev({ toolCalls: ['Edit'], outputTokens: 1_000_000 }),
      ev({ toolCalls: ['Bash'], outputTokens: 1_000_000 }),
      ev({ toolCalls: [], outputTokens: 2_000_000 }),
    ])
    expect(buckets[0].activity).toBe('reasoning') // highest cost first
    const sum = buckets.reduce((a, b) => a + b.share, 0)
    expect(sum).toBeCloseTo(1)
  })
})

describe('budget burn-down', () => {
  const june = [
    ev({ timestamp: '2026-06-01T10:00:00.000Z', outputTokens: 1_000_000 }), // $15
    ev({ timestamp: '2026-06-05T10:00:00.000Z', outputTokens: 1_000_000 }), // $15
    ev({ timestamp: '2026-05-20T10:00:00.000Z', outputTokens: 10_000_000 }), // prior month — excluded
  ]

  it('sums only the current month', () => {
    const b = budgetStatus(june, 100, new Date('2026-06-10T12:00:00'))
    expect(b.month).toBe('2026-06')
    expect(b.spent).toBeCloseTo(30)
    expect(b.used).toBeCloseTo(0.3)
  })

  it('projects linearly to month end', () => {
    const b = budgetStatus(june, 100, new Date('2026-06-10T12:00:00'))
    expect(b.daysElapsed).toBe(10)
    expect(b.daysInMonth).toBe(30)
    expect(b.projected).toBeCloseTo(90) // $3/day * 30
  })
})
