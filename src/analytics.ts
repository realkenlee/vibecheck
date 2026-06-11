// Pure aggregation functions over UsageEvent[] — all independently testable.

import type { UsageEvent } from './schema.js'
import { eventCost, cacheSavings } from './pricing.js'

export interface Totals {
  events: number
  sessions: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  cacheSavings: number
  /** Models we couldn't price — their spend is NOT in `cost`. */
  unknownModels: string[]
}

export function totals(events: UsageEvent[]): Totals {
  const t: Totals = {
    events: events.length,
    sessions: new Set(events.map((e) => `${e.agent}:${e.sessionId}`)).size,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    cacheSavings: 0,
    unknownModels: [],
  }
  const unknown = new Set<string>()
  for (const e of events) {
    t.inputTokens += e.inputTokens
    t.outputTokens += e.outputTokens
    t.cacheReadTokens += e.cacheReadTokens
    t.cacheWriteTokens += e.cacheWriteTokens
    const c = eventCost(e)
    if (c == null) unknown.add(e.model)
    else t.cost += c
    t.cacheSavings += cacheSavings(e)
  }
  t.unknownModels = [...unknown].sort()
  return t
}

export interface Bucket {
  key: string
  events: number
  tokens: number // input + output + cacheRead + cacheWrite
  cost: number
}

function bucketBy(events: UsageEvent[], keyFn: (e: UsageEvent) => string): Bucket[] {
  const map = new Map<string, Bucket>()
  for (const e of events) {
    const key = keyFn(e)
    let b = map.get(key)
    if (!b) {
      b = { key, events: 0, tokens: 0, cost: 0 }
      map.set(key, b)
    }
    b.events++
    b.tokens += e.inputTokens + e.outputTokens + e.cacheReadTokens + e.cacheWriteTokens
    b.cost += eventCost(e) ?? 0
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
}

export const byModel = (ev: UsageEvent[]) => bucketBy(ev, (e) => e.model)
export const byProject = (ev: UsageEvent[]) => bucketBy(ev, (e) => e.project)
export const byAgent = (ev: UsageEvent[]) => bucketBy(ev, (e) => e.agent)
/** Branch attribution — "what did the q2-migration branch cost". Codex events land in (unknown). */
export const byBranch = (ev: UsageEvent[]) => bucketBy(ev, (e) => e.gitBranch ?? '(unknown)')

/** Buckets keyed by local date YYYY-MM-DD, sorted ascending by date. */
export function byDay(events: UsageEvent[]): Bucket[] {
  return bucketBy(events, (e) => localDay(e.timestamp)).sort((a, b) =>
    a.key.localeCompare(b.key),
  )
}

export function localDay(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'unknown'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Tool name -> invocation count, sorted desc. */
export function toolUsage(events: UsageEvent[]): [string, number][] {
  const map = new Map<string, number>()
  for (const e of events)
    for (const t of e.toolCalls) map.set(t, (map.get(t) ?? 0) + 1)
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

/** 24-slot histogram of event counts by local hour. */
export function hourlyHistogram(events: UsageEvent[]): number[] {
  const h = new Array(24).fill(0)
  for (const e of events) {
    const d = new Date(e.timestamp)
    if (!isNaN(d.getTime())) h[d.getHours()]++
  }
  return h
}

export function filterDays(events: UsageEvent[], days: number, now = new Date()): UsageEvent[] {
  const cutoff = now.getTime() - days * 86_400_000
  return events.filter((e) => {
    const t = new Date(e.timestamp).getTime()
    return !isNaN(t) && t >= cutoff
  })
}

// ── session drill-down ────────────────────────────────────────────────────────

export interface SessionSummary {
  sessionId: string
  agent: string
  /** Most frequent project within the session. */
  project: string
  start: string
  end: string
  /** Wall-clock span in minutes (first to last event). */
  minutes: number
  turns: number
  tokens: number
  cost: number
}

/** Per-session rollup, sorted by cost desc — "which sessions ate my budget". */
export function bySession(events: UsageEvent[]): SessionSummary[] {
  const map = new Map<string, { s: SessionSummary; projects: Map<string, number> }>()
  for (const e of events) {
    const key = `${e.agent}:${e.sessionId}`
    let entry = map.get(key)
    if (!entry) {
      entry = {
        s: {
          sessionId: e.sessionId,
          agent: e.agent,
          project: e.project,
          start: e.timestamp,
          end: e.timestamp,
          minutes: 0,
          turns: 0,
          tokens: 0,
          cost: 0,
        },
        projects: new Map(),
      }
      map.set(key, entry)
    }
    const { s, projects } = entry
    if (e.timestamp) {
      if (!s.start || e.timestamp < s.start) s.start = e.timestamp
      if (e.timestamp > s.end) s.end = e.timestamp
    }
    s.turns++
    s.tokens += e.inputTokens + e.outputTokens + e.cacheReadTokens + e.cacheWriteTokens
    s.cost += eventCost(e) ?? 0
    projects.set(e.project, (projects.get(e.project) ?? 0) + 1)
  }
  const out: SessionSummary[] = []
  for (const { s, projects } of map.values()) {
    s.project = [...projects.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const span = new Date(s.end).getTime() - new Date(s.start).getTime()
    s.minutes = isNaN(span) ? 0 : Math.round(span / 60_000)
    out.push(s)
  }
  return out.sort((a, b) => b.cost - a.cost)
}

// ── budget burn-down (the soft-limit IC view) ─────────────────────────────────

export interface BudgetStatus {
  /** e.g. "2026-06" */
  month: string
  spent: number
  budget: number
  /** spent / budget, may exceed 1 */
  used: number
  /** linear projection to month end based on elapsed days */
  projected: number
  daysElapsed: number
  daysInMonth: number
}

export function budgetStatus(events: UsageEvent[], budget: number, now = new Date()): BudgetStatus {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  let spent = 0
  for (const e of events) {
    if (localDay(e.timestamp).startsWith(month)) spent += eventCost(e) ?? 0
  }
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const daysElapsed = Math.max(1, now.getDate())
  return {
    month,
    spent,
    budget,
    used: budget > 0 ? spent / budget : 0,
    projected: (spent / daysElapsed) * daysInMonth,
    daysElapsed,
    daysInMonth,
  }
}
