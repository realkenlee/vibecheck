// Activity attribution — classify each billable event by what the agent was
// doing, derived from its tool calls. This is the answer to "where do my
// tokens actually GO?" that per-project breakdowns can't give.
//
// Heuristic v1: an event's full cost is attributed to its dominant activity
// by precedence (an Edit+Bash event counts as editing). Documented tradeoff:
// most input cost is cached context carried across every event regardless of
// activity, so read this as "cost of turns spent doing X".

import type { UsageEvent } from './schema.js'
import { eventCost } from './pricing.js'

export type Activity =
  | 'editing' // writing/changing code
  | 'executing' // running commands, builds, tests
  | 'exploring' // reading code, searching, fetching docs
  | 'delegating' // spawning subagents
  | 'planning' // todo lists, plan mode, user questions
  | 'other-tools' // MCP/unrecognized tools
  | 'reasoning' // no tools — pure thinking/answering

const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch'])
const EXEC = new Set(['Bash', 'BashOutput', 'KillShell', 'shell', 'exec_command', 'local_shell'])
const EXPLORE = new Set([
  'Read',
  'Grep',
  'Glob',
  'LS',
  'WebFetch',
  'WebSearch',
  'ToolSearch',
  'web_search',
  'view_image',
])
const DELEGATE = new Set(['Task', 'Agent'])
const PLAN = new Set([
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'EnterPlanMode',
  'ExitPlanMode',
  'AskUserQuestion',
  'update_plan',
  'Skill',
])

/** Precedence: editing > executing > delegating > exploring > planning > other. */
export function classifyEvent(toolCalls: string[]): Activity {
  if (toolCalls.length === 0) return 'reasoning'
  let hasExec = false
  let hasDelegate = false
  let hasExplore = false
  let hasPlan = false
  let hasOther = false
  for (const t of toolCalls) {
    if (EDIT.has(t)) return 'editing'
    else if (EXEC.has(t)) hasExec = true
    else if (DELEGATE.has(t)) hasDelegate = true
    else if (EXPLORE.has(t)) hasExplore = true
    else if (PLAN.has(t)) hasPlan = true
    else hasOther = true
  }
  if (hasExec) return 'executing'
  if (hasDelegate) return 'delegating'
  if (hasExplore) return 'exploring'
  if (hasPlan) return 'planning'
  if (hasOther) return 'other-tools'
  return 'reasoning'
}

export interface ActivityBucket {
  activity: Activity
  events: number
  tokens: number
  cost: number
  /** share of total cost, 0..1 */
  share: number
}

export function byActivity(events: UsageEvent[]): ActivityBucket[] {
  const map = new Map<Activity, ActivityBucket>()
  let totalCost = 0
  for (const e of events) {
    const a = classifyEvent(e.toolCalls)
    let b = map.get(a)
    if (!b) {
      b = { activity: a, events: 0, tokens: 0, cost: 0, share: 0 }
      map.set(a, b)
    }
    b.events++
    b.tokens += e.inputTokens + e.outputTokens + e.cacheReadTokens + e.cacheWriteTokens
    const c = eventCost(e) ?? 0
    b.cost += c
    totalCost += c
  }
  const out = [...map.values()].sort((a, b) => b.cost - a.cost)
  if (totalCost > 0) for (const b of out) b.share = b.cost / totalCost
  return out
}
