// Team report export — the bridge between the free CLI and the enterprise tier.
//
// Privacy contract (this is the product): the report contains AGGREGATES ONLY.
// No prompts (we never parse them), no file paths, no session ids, no tool
// names, and — by default — no project or branch names, since those can leak
// confidential codenames. An IC can read the entire payload before sharing it.

import { execSync } from 'node:child_process'
import type { UsageEvent } from './schema.js'
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
  schema: 'vibevitals.report.v1'
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
    schema: 'vibevitals.report.v1',
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
    budget: opts.budget ? budgetStatus(events, opts.budget, opts.now) : null,
  }
  if (opts.includeProjects) {
    report.byProject = byProject(events)
    report.byBranch = byBranch(events)
  }
  return report
}
