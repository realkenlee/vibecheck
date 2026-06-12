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
      text: `One session is ${pct(s.cost / t.cost)} of all spend (${usd(s.cost)}, ${s.project}). Run \`vibecheck sessions\` to see what it did.`,
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

  // 6. Context tax — a session re-pays its whole history every turn, so late
  // turns in marathon sessions cost multiples of early ones. Estimate the
  // excess cache reads past turn 100 vs each session's own early baseline.
  const sessionsSorted = groupSessions(events)
  let marathons = 0
  let tax = 0
  let earlySum = 0, earlyN = 0, lateSum = 0, lateN = 0
  for (const turns of sessionsSorted.values()) {
    if (turns.length < 100) continue
    marathons++
    const base = turns.slice(0, 25)
    const baseline = base.reduce((a, e) => a + e.cacheReadTokens, 0) / base.length
    earlySum += baseline * base.length; earlyN += base.length
    for (let i = 100; i < turns.length; i++) {
      const r = rateFor(turns[i].model)
      if (!r) continue
      lateSum += turns[i].cacheReadTokens; lateN++
      tax += (Math.max(0, turns[i].cacheReadTokens - baseline) * r.cacheRead) / 1_000_000
    }
  }
  if (marathons > 0 && tax > 5) {
    const k = (x: number) => `${Math.round(x / 1000)}k`
    out.push({
      level: tax / t.cost > 0.2 ? 'warn' : 'info',
      text: `Context tax: ${marathons} session${marathons > 1 ? 's' : ''} ran past 100 turns — late turns re-read ~${k(lateSum / Math.max(1, lateN))} cached tokens apiece vs ~${k(earlySum / Math.max(1, earlyN))} early, ≈ ${usd(tax)} of pure re-reading. Context is rent, not a purchase: /compact or restart between tasks.`,
    })
  }

  // 7. Idle gaps — the prompt cache expires after ~5min; coming back means
  // re-writing it at the 1.25× premium. Post-gap cache writes approximate that.
  let gapCount = 0
  let gapCost = 0
  for (const turns of sessionsSorted.values()) {
    for (let i = 1; i < turns.length; i++) {
      const dt = new Date(turns[i].timestamp).getTime() - new Date(turns[i - 1].timestamp).getTime()
      if (!(dt > 5 * 60_000)) continue
      const r = rateFor(turns[i].model)
      if (!r) continue
      gapCount++
      gapCost += (turns[i].cacheWriteTokens * r.cacheWrite) / 1_000_000
    }
  }
  if (gapCount >= 10 && gapCost > 2) {
    out.push({
      level: 'info',
      text: `${gapCount} idle gaps >5min inside sessions let the prompt cache expire — post-gap turns re-wrote it for ≈ ${usd(gapCost)}. Wrap up before stepping away, or expect a rebuild on return.`,
    })
  }

  // 8. Failure tax — errored tool calls usually buy a retry turn on top of
  // the failed one. Rate is over tool-using turns, not all turns.
  const toolTurns = events.filter((e) => e.toolCalls.length > 0)
  const errTurns = toolTurns.filter((e) => (e.toolErrors ?? 0) > 0)
  if (toolTurns.length >= 100 && errTurns.length >= 20 && errTurns.length / toolTurns.length > 0.08) {
    out.push({
      level: 'info',
      text: `${pct(errTurns.length / toolTurns.length)} of tool-using turns had a failing call (${errTurns.length} of ${toolTurns.length}). Each failure usually costs a retry turn — and the error output rides in context for the rest of the session.`,
    })
  }

  // 9. Tool-result diet — results enter context and are re-paid as cache
  // reads on every later turn, so fat results compound.
  let resBytes = 0
  let resTurns = 0
  for (const e of toolTurns) {
    if (e.toolResultBytes === undefined) continue
    resTurns++
    resBytes += e.toolResultBytes
  }
  if (resTurns >= 100) {
    const avgKB = resBytes / resTurns / 1000
    if (avgKB > 8) {
      out.push({
        level: 'warn',
        text: `Fat tool results: ~${avgKB.toFixed(1)}KB per tool turn on average. Every byte is re-read each later turn — pipe commands through tail/grep and use Read limits.`,
      })
    } else if (avgKB < 3) {
      out.push({
        level: 'good',
        text: `Lean tool results: ~${avgKB.toFixed(1)}KB per tool turn on average. Trimmed output keeps context rent low.`,
      })
    }
  }

  // 10. Verbosity drift — output tokens are the priciest line item (5× input).
  // Compare the last two months that have enough turns to mean something.
  const monthOut = new Map<string, { out: number; n: number }>()
  for (const e of events) {
    const m = e.timestamp.slice(0, 7)
    if (m.length !== 7) continue
    const v = monthOut.get(m) ?? { out: 0, n: 0 }
    v.out += e.outputTokens
    v.n++
    monthOut.set(m, v)
  }
  const solidMonths = [...monthOut.entries()].filter(([, v]) => v.n >= 200).sort()
  if (solidMonths.length >= 2) {
    const [prevKey, prev] = solidMonths[solidMonths.length - 2]
    const [currKey, curr] = solidMonths[solidMonths.length - 1]
    const prevAvg = prev.out / prev.n
    const currAvg = curr.out / curr.n
    if (currAvg > prevAvg * 1.3) {
      out.push({
        level: 'info',
        text: `Responses are getting longer: avg output/turn went from ~${Math.round(prevAvg)} to ~${Math.round(currAvg)} tokens (${prevKey} → ${currKey}, +${Math.floor((currAvg / prevAvg - 1) * 100)}%). Output costs 5× input — ask for tighter diffs and less narration.`,
      })
    }
  }

  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
}

// events per session in timestamp order — for turn-position economics
function groupSessions(events: UsageEvent[]): Map<string, UsageEvent[]> {
  const map = new Map<string, UsageEvent[]>()
  for (const e of events) {
    const key = `${e.agent}:${e.sessionId}`
    let arr = map.get(key)
    if (!arr) map.set(key, (arr = []))
    arr.push(e)
  }
  for (const arr of map.values()) arr.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return map
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
