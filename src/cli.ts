#!/usr/bin/env node
// vibevitals — check your vitals. Local-first analytics for AI coding sessions.
// Reads ~/.claude/projects and ~/.codex/sessions. Nothing leaves your machine.

import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseClaudeDir } from './parsers/claude-code.js'
import { parseCodexDir } from './parsers/codex.js'
import {
  totals,
  byModel,
  byProject,
  byAgent,
  byDay,
  toolUsage,
  hourlyHistogram,
  filterDays,
  budgetStatus,
} from './analytics.js'
import { byActivity } from './activities.js'
import type { UsageEvent } from './schema.js'
import { bold, dim, green, yellow, cyan, money, tokens, table, spark } from './format.js'

interface Args {
  json: boolean
  days: number | null
  budget: number | null
  claudeDir: string
  codexDir: string
}

function parseArgs(argv: string[]): Args {
  const envBudget = parseFloat(process.env.VIBEVITALS_BUDGET ?? '')
  const a: Args = {
    json: false,
    days: null,
    budget: isNaN(envBudget) ? null : envBudget,
    claudeDir: join(homedir(), '.claude', 'projects'),
    codexDir: join(homedir(), '.codex', 'sessions'),
  }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (v === '--json') a.json = true
    else if (v === '--days') a.days = parseInt(argv[++i], 10)
    else if (v === '--budget') a.budget = parseFloat(argv[++i])
    else if (v === '--claude-dir') a.claudeDir = argv[++i]
    else if (v === '--codex-dir') a.codexDir = argv[++i]
    else if (v === '--help' || v === '-h') {
      console.log(`vibevitals — where do your AI coding tokens go?

Usage: vibevitals [options]

  --days <n>         only include the last n days
  --budget <usd>     monthly soft limit — show burn-down + projection
                     (or set VIBEVITALS_BUDGET)
  --json             machine-readable output
  --claude-dir <p>   Claude Code projects dir (default ~/.claude/projects)
  --codex-dir <p>    Codex sessions dir (default ~/.codex/sessions)

All analysis is local. Nothing leaves your machine.`)
      process.exit(0)
    }
  }
  return a
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  const claude = parseClaudeDir(args.claudeDir)
  const codex = parseCodexDir(args.codexDir)
  let events: UsageEvent[] = [...claude.events, ...codex.events]
  if (args.days) events = filterDays(events, args.days)

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          totals: totals(events),
          byAgent: byAgent(events),
          byModel: byModel(events),
          byProject: byProject(events),
          byActivity: byActivity(events),
          byDay: byDay(events),
          tools: toolUsage(events),
          hourly: hourlyHistogram(events),
          budget: args.budget ? budgetStatus(events, args.budget) : null,
          parseStats: { claude: claude.stats, codex: codex.stats },
        },
        null,
        2,
      ),
    )
    return
  }

  const t = totals(events)
  const period = args.days ? `last ${args.days} days` : 'all time'

  console.log()
  console.log(bold('  🩺 vibevitals') + dim(`  ·  ${period}  ·  all data stays local`))
  console.log()

  if (events.length === 0) {
    console.log('  No sessions found.')
    console.log(dim(`  Looked in: ${args.claudeDir}`))
    console.log(dim(`             ${args.codexDir}`))
    return
  }

  // ── vitals strip ──
  const allTokens = t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens
  console.log(
    '  ' +
      [
        `${bold(money(t.cost))} API-equivalent spend`,
        `${bold(tokens(allTokens))} tokens`,
        `${t.sessions} sessions`,
        green(`${money(t.cacheSavings)} saved by caching`),
      ].join(dim('   │   ')),
  )
  console.log()

  // ── budget burn-down ──
  if (args.budget) {
    const b = budgetStatus([...claude.events, ...codex.events], args.budget)
    const pct = Math.round(b.used * 100)
    const filled = Math.min(14, Math.round(b.used * 14))
    const bar = '█'.repeat(filled) + '░'.repeat(14 - filled)
    const overPace = b.projected > b.budget
    const paint = b.used >= 1 ? yellow : overPace ? yellow : green
    console.log(
      bold(`  Budget (${b.month})`) +
        `   ${bold(money(b.spent))} of ${money(b.budget)}  ` +
        paint(`▕${bar}▏ ${pct}%`) +
        dim(`   day ${b.daysElapsed}/${b.daysInMonth} · projected `) +
        (overPace ? yellow(`${money(b.projected)} ⚠ over pace`) : green(`${money(b.projected)} on pace`)),
    )
    console.log()
  }

  // ── where tokens go: activities ──
  const acts = byActivity(events)
  if (acts.length) {
    console.log(bold('  Where tokens go') + dim('  (by dominant activity per turn)'))
    console.log(
      indent(
        table(
          acts.map((b) => [
            b.activity,
            String(b.events),
            tokens(b.tokens),
            money(b.cost),
            dim(`${Math.round(b.share * 100)}%`),
          ]),
          ['activity', 'turns', 'tokens', 'cost', 'share'],
        ),
      ),
    )
    console.log()
  }

  // ── by agent ──
  const agents = byAgent(events)
  if (agents.length > 1) {
    console.log(bold('  By agent'))
    console.log(
      indent(
        table(
          agents.map((b) => [cyan(b.key), String(b.events), tokens(b.tokens), money(b.cost)]),
          ['agent', 'calls', 'tokens', 'cost'],
        ),
      ),
    )
    console.log()
  }

  // ── by model ──
  console.log(bold('  By model'))
  console.log(
    indent(
      table(
        byModel(events)
          .slice(0, 8)
          .map((b) => [b.key, String(b.events), tokens(b.tokens), money(b.cost)]),
        ['model', 'calls', 'tokens', 'cost'],
      ),
    ),
  )
  console.log()

  // ── by project ──
  console.log(bold('  By project'))
  console.log(
    indent(
      table(
        byProject(events)
          .slice(0, 10)
          .map((b) => [b.key, String(b.events), tokens(b.tokens), money(b.cost)]),
        ['project', 'calls', 'tokens', 'cost'],
      ),
    ),
  )
  console.log()

  // ── daily spend, last 14 buckets ──
  const days = byDay(events).filter((d) => d.key !== 'unknown')
  const recent = days.slice(-14)
  if (recent.length > 1) {
    console.log(bold('  Daily spend') + dim('  (last 14 active days)'))
    const max = Math.max(...recent.map((d) => d.cost), 0.01)
    for (const d of recent) {
      const bar = '█'.repeat(Math.max(1, Math.round((d.cost / max) * 30)))
      console.log(`  ${dim(d.key)}  ${cyan(bar)} ${money(d.cost)}`)
    }
    console.log()
  }

  // ── hour-of-day rhythm ──
  console.log(bold('  When you vibe') + dim('  (events by hour, local time)'))
  console.log(`  ${dim('00')} ${spark(hourlyHistogram(events))} ${dim('23')}`)
  console.log()

  // ── tools ──
  const tools = toolUsage(events).slice(0, 8)
  if (tools.length) {
    console.log(bold('  Top tools'))
    console.log(indent(table(tools.map(([name, n]) => [name, String(n)]), ['tool', 'calls'])))
    console.log()
  }

  if (t.unknownModels.length) {
    console.log(yellow(`  ⚠ Unpriced models (excluded from cost): ${t.unknownModels.join(', ')}`))
  }
  const skipped = claude.stats.skippedLines + codex.stats.skippedLines
  if (skipped > 0) {
    console.log(yellow(`  ⚠ ${skipped} unparseable lines — possible schema drift, please file an issue`))
  }
  console.log(
    dim(
      `  Parsed ${claude.stats.files + codex.stats.files} files · costs are API-list-price estimates`,
    ),
  )
  console.log()
}

const indent = (s: string) => s.replace(/^/gm, '  ')

main()
