// Doctor's notes — turn the numbers into a diagnosis. Every heuristic is
// deterministic, threshold-gated, and only fires with enough data to matter.

import type { UsageEvent } from './schema.js'
import { eventCost, rateFor } from './pricing.js'
import { totals, bySession, hourlyHistogram } from './analytics.js'
import { classifyEvent, type Activity } from './activities.js'

export interface Insight {
  level: 'warn' | 'info' | 'good'
  text: string
}

const LEVEL_ORDER: Record<Insight['level'], number> = { warn: 0, info: 1, good: 2 }
// floor, not round — the doctor never overstates (99.7% cache ≠ "100%")
const pct = (x: number) => `${Math.floor(x * 100)}%`
const usd = (x: number) => `$${x >= 100 ? Math.round(x) : x.toFixed(2)}`

/** Minimum data before we offer opinions. */
const MIN_EVENTS = 50
const MIN_COST = 1

export function diagnose(events: UsageEvent[]): Insight[] {
  const t = totals(events)
  if (t.events < MIN_EVENTS || t.cost < MIN_COST) return []

  const out: Insight[] = []

  // 1. Cache health — reads cost ~10% of fresh input.
  const cacheable = t.cacheReadTokens + t.inputTokens
  if (cacheable > 1_000_000) {
    const hitRate = t.cacheReadTokens / cacheable
    if (hitRate >= 0.8) {
      out.push({
        level: 'good',
        text: `Healthy cache: ${pct(hitRate)} of input was served from cache, saving ${usd(t.cacheSavings)} vs list price.`,
      })
    } else if (hitRate < 0.5) {
      out.push({
        level: 'warn',
        text: `Low cache hit rate (${pct(hitRate)}). Frequent session restarts or >5min idle gaps break the prompt cache — cached input costs 10% of fresh.`,
      })
    }
  }

  // 1b. Cache thrash — writes cost a 1.25× premium; if reads never recoup it,
  // caching is a net loss (short sessions / >5min gaps write cache nobody reads).
  let writeCost = 0
  for (const e of events) {
    const r = rateFor(e.model)
    if (r) writeCost += (e.cacheWriteTokens * r.cacheWrite) / 1_000_000
  }
  if (writeCost > 1 && writeCost > t.cacheSavings) {
    out.push({
      level: 'warn',
      text: `Cache thrash: writing to cache cost ${usd(writeCost)} (1.25× input rate) but reads only saved ${usd(t.cacheSavings)}. Short sessions and >5min idle gaps pay the write premium without the payoff.`,
    })
  }

  // 2. Activity skews (cost-weighted).
  const acts = activityShares(events)
  const exec = acts.get('executing') ?? 0
  if (exec > 0.4) {
    out.push({
      level: 'info',
      text: `${pct(exec)} of spend is command-running turns. Verbose build/test output is token-hungry — pipe through tail/grep, silence noisy commands.`,
    })
  }
  const reasoning = acts.get('reasoning') ?? 0
  if (reasoning > 0.35) {
    out.push({
      level: 'info',
      text: `${pct(reasoning)} of spend is no-tool turns (discussion/reasoning). Fine if intentional — but long Q&A may belong in a cheaper chat surface.`,
    })
  }

  // 3. Subagent traffic.
  const sideCost = events.reduce((a, e) => a + (e.sidechain ? (eventCost(e) ?? 0) : 0), 0)
  if (t.cost > 0 && sideCost / t.cost > 0.25) {
    out.push({
      level: 'info',
      text: `Subagents account for ${pct(sideCost / t.cost)} of spend (${usd(sideCost)}). Each spawn re-derives context — batch related work into fewer agents.`,
    })
  }

  // 4. Spend concentration — one session dominating.
  const sessions = bySession(events)
  if (sessions.length >= 5 && sessions[0].cost / t.cost > 0.3) {
    const s = sessions[0]
    out.push({
      level: 'info',
      text: `One session is ${pct(s.cost / t.cost)} of all spend (${usd(s.cost)}, ${s.project}). Run \`vibevitals sessions\` to see what it did.`,
    })
  }

  // 5. Night-owl vitals.
  const hours = hourlyHistogram(events)
  const night = hours.slice(0, 5).reduce((a, b) => a + b, 0)
  const all = hours.reduce((a, b) => a + b, 0)
  if (all > 0 && night / all > 0.15) {
    out.push({
      level: 'info',
      text: `${pct(night / all)} of your turns happen between midnight and 5am. The doctor recommends sleep.`,
    })
  }

  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
}

// cost share per activity without importing the CLI's table shape
function activityShares(events: UsageEvent[]): Map<Activity, number> {
  const costs = new Map<Activity, number>()
  let total = 0
  for (const e of events) {
    const c = eventCost(e) ?? 0
    const a = classifyEvent(e.toolCalls)
    costs.set(a, (costs.get(a) ?? 0) + c)
    total += c
  }
  if (total > 0) for (const [k, v] of costs) costs.set(k, v / total)
  return costs
}
