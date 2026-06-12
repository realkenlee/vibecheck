// "AI Coding Wrapped" — a shareable card of your vitals.
//
// Privacy by design: a wrapped card is MADE to be posted, so it contains
// aggregate numbers and model/activity names only — never project names,
// branches, paths, or prompts.

import type { UsageEvent } from './schema.js'
import { totals, byModel, byDay, hourlyHistogram } from './analytics.js'
import { byActivity } from './activities.js'

export interface WrappedStats {
  tokens: number
  cost: number
  cacheSavings: number
  sessions: number
  activeDays: number
  /** Longest run of consecutive active days. */
  streak: number
  topModel: string | null
  topActivity: { name: string; share: number } | null
  busiestDay: { date: string; cost: number } | null
  /** 0-23 local hour with the most events. */
  peakHour: number | null
}

export function wrappedStats(events: UsageEvent[]): WrappedStats {
  const t = totals(events)
  const days = byDay(events).filter((d) => d.key !== 'unknown')
  const models = byModel(events).filter((m) => m.key !== 'unknown')
  const acts = byActivity(events)
  const hours = hourlyHistogram(events)
  const maxHour = Math.max(...hours)
  const busiest = [...days].sort((a, b) => b.cost - a.cost)[0]

  return {
    tokens: t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens,
    cost: t.cost,
    cacheSavings: t.cacheSavings,
    sessions: t.sessions,
    activeDays: days.length,
    streak: longestStreak(days.map((d) => d.key)),
    topModel: models[0]?.key ?? null,
    topActivity: acts[0] ? { name: acts[0].activity, share: acts[0].share } : null,
    busiestDay: busiest ? { date: busiest.key, cost: busiest.cost } : null,
    peakHour: maxHour > 0 ? hours.indexOf(maxHour) : null,
  }
}

/** Longest run of consecutive YYYY-MM-DD dates (input sorted ascending). */
export function longestStreak(sortedDays: string[]): number {
  let best = 0
  let run = 0
  let prev: number | null = null
  for (const day of sortedDays) {
    const t = new Date(`${day}T12:00:00`).getTime()
    if (isNaN(t)) continue
    run = prev !== null && Math.round((t - prev) / 86_400_000) === 1 ? run + 1 : 1
    prev = t
    if (run > best) best = run
  }
  return best
}

const fmtTokens = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${(n / 1e3).toFixed(0)}k`
const fmtMoney = (n: number) => `$${n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(0)}`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 1200×630 (OG-image size) dark card. Pure string template, zero deps. */
export function wrappedSvg(s: WrappedStats, periodLabel: string): string {
  const hour = s.peakHour === null ? '—' : `${String(s.peakHour).padStart(2, '0')}:00`
  const cells: [string, string][] = [
    [fmtTokens(s.tokens), 'tokens'],
    [fmtMoney(s.cost), 'API-equivalent value'],
    [fmtMoney(s.cacheSavings), 'saved by caching'],
    [String(s.sessions), 'sessions'],
    [`${s.streak}d`, 'longest daily streak'],
    [hour, 'peak coding hour'],
  ]
  const grid = cells
    .map(([big, label], i) => {
      const x = 80 + (i % 3) * 360
      const y = 270 + Math.floor(i / 3) * 150
      return `  <text x="${x}" y="${y}" class="big">${esc(big)}</text>
  <text x="${x}" y="${y + 34}" class="label">${esc(label)}</text>`
    })
    .join('\n')

  const footer = [
    s.topModel ? `mostly ${s.topModel}` : null,
    s.topActivity ? `${Math.floor(s.topActivity.share * 100)}% ${s.topActivity.name}` : null,
    s.busiestDay ? `biggest day ${s.busiestDay.date} (${fmtMoney(s.busiestDay.cost)})` : null,
  ]
    .filter(Boolean)
    .join('   ·   ')

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#34d399"/>
      <stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <style>
    text { font-family: 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace; }
    .title { font-size: 44px; font-weight: 700; fill: url(#accent); }
    .period { font-size: 22px; fill: #8b949e; }
    .big { font-size: 56px; font-weight: 700; fill: #e6edf3; }
    .label { font-size: 20px; fill: #8b949e; }
    .footer { font-size: 20px; fill: #34d399; }
    .url { font-size: 18px; fill: #8b949e; }
  </style>
  <rect width="1200" height="630" fill="#0d1117"/>
  <rect x="40" y="40" width="1120" height="550" rx="24" fill="#161b22" stroke="#30363d"/>
  <text x="80" y="130" class="title">🩺 AI Coding Wrapped</text>
  <text x="80" y="170" class="period">${esc(periodLabel)}</text>
${grid}
  <text x="80" y="520" class="footer">${esc(footer)}</text>
  <text x="80" y="556" class="url">npx vibe-check · all data stays local</text>
</svg>
`
}
