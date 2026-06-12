// Team report export — the bridge between the free CLI and the enterprise tier.
//
// Privacy contract (this is the product): the report contains AGGREGATES ONLY.
// No prompts (we never parse them), no file paths, no session ids, no tool
// names, and — by default — no project or branch names, since those can leak
// confidential codenames. An IC can read the entire payload before sharing it.

import { execSync } from 'node:child_process'
import type { Compaction, FileRead, TurnDuration, UsageEvent } from './schema.js'
import { diagnose } from './insights.js'
import {
  totals,
  byModel,
  byAgent,
  byDay,
  byProject,
  byBranch,
  budgetStatus,
  type Totals,
  type Bucket,
  type BudgetStatus,
} from './analytics.js'
import { byActivity, type ActivityBucket } from './activities.js'

export interface TeamReport {
  schema: 'vibecheck.report.v1'
  generatedAt: string
  /** Reporting window. from/to are local dates derived from the data. */
  period: { days: number | null; from: string | null; to: string | null }
  /** From git config; null when --anonymous or unavailable. */
  user: { name: string | null; email: string | null }
  totals: Totals
  byActivity: ActivityBucket[]
  byModel: Bucket[]
  byAgent: Bucket[]
  byDay: Bucket[]
  /** Summed turn durations in hours (Claude Code records them; null when
   *  unrecorded). Runtime, not wall-clock — parallel subagents stack. Only
   *  the aggregate number crosses the wire; per-turn records never do. */
  agentHours: number | null
  /** Doctor's notes as id+level ONLY — never the rendered text, which can
   *  contain file basenames (re-read tax) or project names (whale session). */
  insights: { id: string; level: 'warn' | 'info' | 'good' }[]
  budget: BudgetStatus | null
  /** Only present with --include-projects (opt-in: names can be sensitive). */
  byProject?: Bucket[]
  byBranch?: Bucket[]
}

export interface ExportOptions {
  days?: number | null
  budget?: number | null
  anonymous?: boolean
  includeProjects?: boolean
  now?: Date
  /** Used only to compute insight ids — never serialized. */
  compactions?: Compaction[]
  fileReads?: FileRead[]
  /** Summed into agentHours — per-turn records are never serialized. */
  turnDurations?: TurnDuration[]
}

function agentHours(turnDurations: TurnDuration[]): number | null {
  const ms = turnDurations.reduce((a, t) => a + t.ms, 0)
  return ms > 0 ? ms / 3_600_000 : null
}

function gitIdentity(): { name: string | null; email: string | null } {
  const get = (key: string): string | null => {
    try {
      const v = execSync(`git config ${key}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
      return v || null
    } catch {
      return null
    }
  }
  return { name: get('user.name'), email: get('user.email') }
}

export function teamReport(events: UsageEvent[], opts: ExportOptions = {}): TeamReport {
  const days = byDay(events).filter((d) => d.key !== 'unknown')
  const report: TeamReport = {
    schema: 'vibecheck.report.v1',
    generatedAt: (opts.now ?? new Date()).toISOString(),
    period: {
      days: opts.days ?? null,
      from: days[0]?.key ?? null,
      to: days[days.length - 1]?.key ?? null,
    },
    user: opts.anonymous ? { name: null, email: null } : gitIdentity(),
    totals: totals(events),
    byActivity: byActivity(events),
    byModel: byModel(events),
    byAgent: byAgent(events),
    byDay: days,
    agentHours: agentHours(opts.turnDurations ?? []),
    insights: diagnose(events, opts.compactions ?? [], opts.fileReads ?? []).map((n) => ({
      id: n.id,
      level: n.level,
    })),
    budget: opts.budget ? budgetStatus(events, opts.budget, opts.now) : null,
  }
  if (opts.includeProjects) {
    report.byProject = byProject(events)
    report.byBranch = byBranch(events)
  }
  return report
}
