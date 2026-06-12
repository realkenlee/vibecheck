#!/usr/bin/env node
// vibecheck — check your vitals. Local-first analytics for AI coding sessions.
// Reads ~/.claude/projects and ~/.codex/sessions. Nothing leaves your machine.

import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { parseClaudeDir } from './parsers/claude-code.js'
import { parseCodexDir } from './parsers/codex.js'
import {
  totals,
  byModel,
  byProject,
  byAgent,
  byBranch,
  byDay,
  byMonth,
  bySession,
  idleGaps,
  localDay,
  toolUsage,
  hourlyHistogram,
  filterDays,
  filterMonth,
  filterProject,
  filterBranch,
  budgetStatus,
} from './analytics.js'
import { byActivity } from './activities.js'
import { PRICES_AS_OF } from './pricing.js'
import { VERSION } from './version.js'
import { teamReport } from './export.js'
import { diagnose } from './insights.js'
import { fmtHours, wrappedStats, wrappedSvg } from './wrapped.js'
import { dashboardHtml } from './web.js'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { UsageEvent } from './schema.js'
import { bold, dim, green, yellow, cyan, money, monthLabel, tokens, table, spark } from './format.js'

interface Args {
  command: 'report' | 'export' | 'sessions' | 'wrapped' | 'web' | 'months' | 'doctor'
  /** `sessions <id>` — substring of a session id to drill into. */
  sessionId: string | null
  /** `doctor --fail-on-warn` — exit 1 if any warn-level note fires (CI gate). */
  failOnWarn: boolean
  json: boolean
  days: number | null
  month: string | null
  /** Scope everything to one project / git branch (substring match). */
  project: string | null
  branch: string | null
  budget: number | null
  out: string | null
  anonymous: boolean
  includeProjects: boolean
  claudeDir: string
  codexDir: string
}

/** Bad input fails loudly — a typo'd month must never read as "you spent $0". */
function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}

function parseArgs(argv: string[]): Args {
  const envBudget = parseFloat(process.env.VIBECHECK_BUDGET ?? '')
  const a: Args = {
    command: 'report',
    sessionId: null,
    failOnWarn: false,
    json: false,
    days: null,
    month: null,
    project: null,
    branch: null,
    budget: isNaN(envBudget) ? null : envBudget,
    out: null,
    anonymous: false,
    includeProjects: false,
    claudeDir: join(homedir(), '.claude', 'projects'),
    codexDir: join(homedir(), '.codex', 'sessions'),
  }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (i === 0 && (v === 'export' || v === 'sessions' || v === 'wrapped' || v === 'web' || v === 'months' || v === 'doctor'))
      a.command = v
    else if (i === 1 && a.command === 'sessions' && !v.startsWith('-')) a.sessionId = v
    else if (v === '--fail-on-warn') a.failOnWarn = true
    else if (v === '--json') a.json = true
    else if (v === '--days') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n <= 0) fail(`--days wants a positive integer, got: ${argv[i]}`)
      a.days = n
    }
    else if (v === '--month') {
      a.month = argv[++i]
      if (!/^\d{4}-\d{2}$/.test(a.month ?? '')) fail(`--month wants YYYY-MM, got: ${a.month}`)
      const mm = Number(a.month!.slice(5))
      if (mm < 1 || mm > 12) fail(`--month wants a month 01–12, got: ${a.month}`)
    }
    else if (v === '--project') {
      a.project = argv[++i]
      if (!a.project || a.project.startsWith('-')) fail('--project wants a project name (or any part of one)')
    }
    else if (v === '--branch') {
      a.branch = argv[++i]
      if (!a.branch || a.branch.startsWith('-')) fail('--branch wants a branch name (or any part of one)')
    }
    else if (v === '--budget') {
      const b = Number(argv[++i])
      if (!Number.isFinite(b) || b <= 0) fail(`--budget wants a positive dollar amount, got: ${argv[i]}`)
      a.budget = b
    }
    else if (v === '--out') a.out = argv[++i]
    else if (v === '--anonymous') a.anonymous = true
    else if (v === '--include-projects') a.includeProjects = true
    else if (v === '--claude-dir') a.claudeDir = argv[++i]
    else if (v === '--codex-dir') a.codexDir = argv[++i]
    else if (v === '--version' || v === '-v') {
      console.log(`vibecheck ${VERSION}`)
      process.exit(0)
    }
    else if (v === '--help' || v === '-h') {
      console.log(`vibecheck — where do your AI coding tokens go?

Usage: vibecheck [options]            personal report (human-readable)
       vibecheck doctor [options]     just the diagnosis — doctor's notes only
       vibecheck sessions [id] [options]  most expensive sessions; give an id
                                      (or any part of one) to drill into it
       vibecheck months               month-over-month trend
       vibecheck wrapped [options]    shareable card (--out wrapped.svg)
       vibecheck web [options]        static HTML dashboard (no server)
       vibecheck export [options]     aggregates-only team report (JSON)

Options
  --days <n>           only include the last n days
  --month <YYYY-MM>    only include one calendar month (reconciliation)
  --project <name>     only include one project (any part of the name works)
  --branch <name>      only include one git branch (Claude Code records branches)
  --budget <usd>       monthly soft limit — burn-down + projection
                       (or set VIBECHECK_BUDGET)
  --json               machine-readable output (report mode)
  --fail-on-warn       doctor only: exit 1 if any ⚠ note fires (CI gate)
  --claude-dir <p>     Claude Code projects dir (default ~/.claude/projects)
  --codex-dir <p>      Codex sessions dir (default ~/.codex/sessions)
  --version            print version and exit

Export options (what you share is your call — read the payload first)
  --out <file>         write the report to a file instead of stdout
  --anonymous          omit your git name/email from the report
  --include-projects   include project + branch names (off by default —
                       codenames can be sensitive)

All analysis is local. Nothing leaves your machine unless you share an export.`)
      process.exit(0)
    }
    // Anything unrecognized fails loudly — `vibecheck doctr` must never quietly
    // run the default report and look like an answer.
    else if (i === 0 && !v.startsWith('-'))
      fail(`unknown command: ${v}\nCommands: doctor, sessions, months, wrapped, web, export (default: report) — see --help`)
    else fail(`unknown option: ${v} — see --help`)
  }
  // flag/command mismatches are also loud — a no-op flag must never look like it worked
  if (a.failOnWarn && a.command !== 'doctor') fail('--fail-on-warn only applies to `vibecheck doctor`')
  return a
}

/** "all time · project foo" — every local surface shows its active filters. */
function periodLabel(args: Args): string {
  let p = args.month ? args.month : args.days ? `last ${args.days} days` : 'all time'
  if (args.project) p += ` · project ${args.project}`
  if (args.branch) p += ` · branch ${args.branch}`
  return p
}

/** Top distinct values by event count — guidance for a filter that matched nothing. */
function topNames(vals: string[]): string {
  const c = new Map<string, number>()
  for (const v of vals) c.set(v, (c.get(v) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k).join(', ')
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  const claude = parseClaudeDir(args.claudeDir)
  const codex = parseCodexDir(args.codexDir)
  let events: UsageEvent[] = [...claude.events, ...codex.events]
  if (args.days) events = filterDays(events, args.days)
  if (args.month) events = filterMonth(events, args.month)
  let compactions = claude.compactions ?? []
  if (args.days) compactions = filterDays(compactions, args.days)
  if (args.month) compactions = filterMonth(compactions, args.month)
  let fileReads = claude.fileReads ?? []
  if (args.days) fileReads = filterDays(fileReads, args.days)
  if (args.month) fileReads = filterMonth(fileReads, args.month)

  let turnDurations = claude.turnDurations ?? []
  if (args.days) turnDurations = filterDays(turnDurations, args.days)
  if (args.month) turnDurations = filterMonth(turnDurations, args.month)

  // A filter that matches nothing fails loudly — a typo'd project name must
  // never read as "you spent $0". (Empty dirs fall through to the empty state.)
  if (args.project) {
    const before = events
    events = filterProject(events, args.project)
    if (events.length === 0 && before.length > 0)
      fail(`--project "${args.project}" matches nothing — your projects: ${topNames(before.map((e) => e.project))}`)
  }
  if (args.branch) {
    const before = events
    events = filterBranch(events, args.branch)
    if (events.length === 0 && before.length > 0) {
      const names = topNames(before.flatMap((e) => (e.gitBranch === null ? [] : [e.gitBranch])))
      fail(`--branch "${args.branch}" matches nothing` + (names ? ` — your branches: ${names}` : ' — only Claude Code records branches'))
    }
  }
  if (args.project || args.branch) {
    // compactions, file reads, and durations carry no project/branch — scope via surviving sessions
    const keep = new Set(events.map((e) => e.sessionId))
    compactions = compactions.filter((c) => keep.has(c.sessionId))
    fileReads = fileReads.filter((r) => keep.has(r.sessionId))
    turnDurations = turnDurations.filter((t) => keep.has(t.sessionId))
  }

  if (args.command === 'export') {
    const report = teamReport(events, {
      days: args.days,
      budget: args.budget,
      anonymous: args.anonymous,
      includeProjects: args.includeProjects,
      compactions,
      fileReads,
    })
    const json = JSON.stringify(report, null, 2)
    if (args.out) {
      writeFileSync(args.out, json + '\n')
      console.error(`wrote ${args.out} — aggregates only, review before sharing`)
    } else {
      console.log(json)
    }
    return
  }

  if (args.command === 'months') {
    const months = byMonth(events).filter((m) => m.key !== 'unknown')
    if (args.json) {
      console.log(JSON.stringify(months, null, 2))
      return
    }
    console.log()
    console.log(bold('  🩺 vibecheck — months') + dim('  ·  month-over-month'))
    console.log()
    if (months.length === 0) {
      console.log('  No sessions found.')
      return
    }
    console.log(
      indent(
        table(
          months.map((m, i) => {
            const prev = i > 0 ? months[i - 1].cost : null
            const delta =
              // Δ% against a near-zero base is noise, not trend ($0.49 → $114
              // would print "+23214%") — show a dash until the base is real.
              prev && prev >= 1
                ? (() => {
                    const d = Math.round(((m.cost - prev) / prev) * 100)
                    const s = `${d >= 0 ? '+' : ''}${d}%`
                    return d > 0 ? yellow(s) : green(s)
                  })()
                : dim('—')
            return [m.key, String(m.events), tokens(m.tokens), money(m.cost), delta]
          }),
          ['month', 'calls', 'tokens', 'cost', 'Δ'],
        ),
      ),
    )
    console.log()
    return
  }

  if (args.command === 'doctor') {
    const notes = diagnose(events, compactions, fileReads)
    // CI gate: report first, then fail — the diagnosis is the point
    const gate = () => {
      if (args.failOnWarn && notes.some((n) => n.level === 'warn')) process.exit(1)
    }
    if (args.json) {
      console.log(JSON.stringify(notes, null, 2))
      gate()
      return
    }
    console.log()
    console.log(
      bold('  🩺 vibecheck — doctor') + dim(`  ·  ${periodLabel(args)}`),
    )
    console.log()
    if (notes.length === 0) {
      if (events.length === 0) {
        console.log('  No sessions found.')
        console.log(dim('  Looked in your Claude Code and Codex log dirs — point me elsewhere with'))
        console.log(dim('  --claude-dir / --codex-dir, or widen an active filter (--days/--month/--project/--branch).'))
      } else {
        console.log(`  Nothing to diagnose yet — the doctor wants ≥50 turns and ≥$1 of usage`)
        console.log(`  before offering opinions (found ${events.length} turns).`)
      }
      console.log()
      return
    }
    for (const n of notes) {
      const mark = n.level === 'warn' ? yellow('⚠') : n.level === 'good' ? green('✓') : dim('·')
      console.log(`  ${mark} ${n.level === 'warn' ? yellow(n.text) : n.level === 'good' ? green(n.text) : n.text}`)
    }
    console.log()
    console.log(dim(`  Full numbers: \`vibecheck\` · costs are API-list-price estimates (prices as of ${PRICES_AS_OF})`))
    console.log()
    gate()
    return
  }

  if (args.command === 'web') {
    const html = dashboardHtml(events, { days: args.days, period: periodLabel(args), budget: args.budget, compactions, fileReads, turnDurations })
    const path = args.out ?? join(tmpdir(), 'vibecheck.html')
    writeFileSync(path, html)
    console.log(`wrote ${path} — static file, no server, all data stays local`)
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null
    if (opener && !args.out) spawnSync(opener, [path], { stdio: 'ignore' })
    return
  }

  if (args.command === 'wrapped') {
    const s = wrappedStats(events, compactions, turnDurations)
    // the card is built to be shared — say it's scoped, but never to what.
    // A month gets its human name: "June 2026" is the natural wrapped period.
    let period = args.month ? monthLabel(args.month) : args.days ? `last ${args.days} days` : 'all time'
    if (args.project || args.branch) period += ' · filtered'
    if (args.json) {
      console.log(JSON.stringify(s, null, 2))
      return
    }
    if (args.out) {
      writeFileSync(args.out, wrappedSvg(s, period))
      console.log(`wrote ${args.out} — aggregate numbers only, safe to share`)
      return
    }
    const hour = s.peakHour === null ? '—' : `${String(s.peakHour).padStart(2, '0')}:00`
    console.log()
    console.log(bold('  🩺 AI Coding Wrapped') + dim(`  ·  ${period}`))
    console.log()
    console.log(`  ${bold(tokens(s.tokens))} tokens  ·  ${bold(money(s.cost))} API-equivalent  ·  ${green(money(s.cacheSavings) + ' saved by caching')}`)
    console.log(
      `  ${s.sessions} sessions over ${s.activeDays} active days  ·  longest streak ${bold(String(s.streak))} days` +
        (s.agentHours && s.agentHours >= 1 ? dim(`  ·  ${fmtHours(s.agentHours)} agent runtime`) : ''),
    )
    if (s.topModel) console.log(`  mostly ${cyan(s.topModel)}` + (s.topActivity ? dim(`  ·  ${Math.floor(s.topActivity.share * 100)}% ${s.topActivity.name}`) : ''))
    if (s.busiestDay) console.log(`  biggest day ${s.busiestDay.date} (${money(s.busiestDay.cost)})  ·  peak hour ${hour}`)
    if (s.longestSessionTurns && s.longestSessionTurns >= 100)
      console.log(
        `  longest session ${bold(s.longestSessionTurns.toLocaleString('en-US'))} turns` +
          (s.compactions >= 3 ? dim(`  ·  ${s.compactions} compactions survived`) : ''),
      )
    console.log()
    console.log(dim('  vibecheck wrapped --out wrapped.svg  →  1200×630 card, safe to share'))
    console.log()
    return
  }

  if (args.command === 'sessions') {
    // per-session compaction counts (Claude Code only — codex doesn't log them)
    const compactCount = new Map<string, number>()
    for (const c of compactions) compactCount.set(c.sessionId, (compactCount.get(c.sessionId) ?? 0) + 1)
    const sessions = bySession(events).map((s) => ({
      ...s,
      compactions: s.agent === 'claude-code' ? (compactCount.get(s.sessionId) ?? 0) : 0,
    }))

    if (args.sessionId) {
      // drill into one session — match by any substring of the id, fail loudly otherwise
      const q = args.sessionId
      const matches = sessions.filter((s) => s.sessionId.includes(q))
      if (matches.length === 0)
        fail(`no session id contains "${q}" — ids are in the \`vibecheck sessions\` table`)
      if (matches.length > 1)
        fail(
          `"${q}" matches ${matches.length} sessions — give more of the id:\n` +
            matches
              .slice(0, 5)
              .map((s) => `  …${s.sessionId.slice(-8)}  ${localDay(s.start)}  ${s.project}`)
              .join('\n'),
        )
      const s = matches[0]
      const sev = events.filter((e) => e.agent === s.agent && e.sessionId === s.sessionId)
      const gaps = idleGaps(sev)
      const comps = s.agent === 'claude-code' ? compactions.filter((c) => c.sessionId === s.sessionId) : []
      // measured agent runtime (Claude Code records per-turn durations) vs raw span
      const activeMs =
        s.agent === 'claude-code'
          ? turnDurations.filter((t) => t.sessionId === s.sessionId).reduce((a, t) => a + t.ms, 0)
          : 0
      if (args.json) {
        console.log(
          JSON.stringify(
            { ...s, activeMs, gapList: gaps, compactionList: comps, byActivity: byActivity(sev), byModel: byModel(sev), tools: toolUsage(sev) },
            null,
            2,
          ),
        )
        return
      }
      const span = s.minutes >= 60 ? `${Math.floor(s.minutes / 60)}h${s.minutes % 60}m` : `${s.minutes}m`
      console.log()
      console.log(bold(`  🩺 vibecheck — session …${s.sessionId.slice(-8)}`))
      console.log()
      console.log(
        `  ${bold(s.project)}  ·  ${cyan(s.agent)}  ·  ` +
          `${localDay(s.start)}${localDay(s.end) !== localDay(s.start) ? ` → ${localDay(s.end)}` : ''}`,
      )
      console.log(
        `  ${span} span` +
          (activeMs > 0
            ? dim(` (${activeMs >= 3_600_000 ? fmtHours(activeMs / 3_600_000) : Math.max(1, Math.round(activeMs / 60_000)) + 'm'} active)`)
            : '') +
          `  ·  ${s.turns.toLocaleString('en-US')} turns  ·  ${tokens(s.tokens)} tokens  ·  ${bold(money(s.cost))}`,
      )
      console.log()
      if (gaps.length) {
        const longest = [...gaps].sort((a, b) => b.minutes - a.minutes).slice(0, 3)
        console.log(bold('  Gaps') + dim(`  ·  ${gaps.length} pauses >5min — each one expires the prompt cache`))
        for (const g of longest) {
          const dur = g.minutes >= 60 ? `${Math.floor(g.minutes / 60)}h${String(g.minutes % 60).padStart(2, '0')}m` : `${g.minutes}m`
          // a pause can cross days — without the end date "05:54 → 06:24" could be 48h
          const endDay = localDay(g.end) !== localDay(g.start) ? `${localDay(g.end)} ` : ''
          console.log(`    ${dur.padStart(7)}  ${dim(`${localDay(g.start)} ${localTime(g.start)} → ${endDay}${localTime(g.end)}`)}`)
        }
        console.log()
      }
      if (comps.length) {
        const shed = comps.reduce((n, c) => n + Math.max(0, c.preTokens - c.postTokens), 0)
        const auto = comps.filter((c) => c.trigger === 'auto').length
        console.log(bold('  Compactions') + dim(`  ·  ${comps.length} (${auto} auto-forced)  ·  ~${tokens(shed)} tokens shed`))
        console.log()
      }
      const acts = byActivity(sev)
      if (acts.length) {
        console.log(bold('  Where tokens went'))
        console.log(
          indent(
            table(
              acts.map((b) => [b.activity, String(b.events), tokens(b.tokens), money(b.cost), dim(`${Math.round(b.share * 100)}%`)]),
              ['activity', 'turns', 'tokens', 'cost', 'share'],
            ),
          ),
        )
        console.log()
      }
      const stools = toolUsage(sev).slice(0, 8)
      if (stools.length) {
        console.log(bold('  Top tools'))
        console.log(indent(table(stools.map(([name, n]) => [name, String(n)]), ['tool', 'calls'])))
        console.log()
      }
      return
    }

    if (args.json) {
      console.log(JSON.stringify(sessions, null, 2))
      return
    }
    console.log()
    console.log(bold('  🩺 vibecheck — sessions') + dim(`  ·  ${periodLabel(args)}  ·  by cost`))
    console.log()
    if (sessions.length === 0) {
      console.log('  No sessions found.')
      return
    }
    console.log(
      indent(
        table(
          sessions.slice(0, 15).map((s) => [
            dim(localDay(s.start)),
            dim('…' + s.sessionId.slice(-8)),
            s.project,
            cyan(s.agent),
            s.minutes >= 60 ? `${Math.floor(s.minutes / 60)}h${s.minutes % 60}m` : `${s.minutes}m`,
            String(s.turns),
            tokens(s.tokens),
            s.gaps > 0 ? String(s.gaps) : dim('—'),
            s.compactions > 0 ? String(s.compactions) : dim('—'),
            bold(money(s.cost)),
          ]),
          ['date', 'id', 'project', 'agent', 'span', 'turns', 'tokens', 'gaps', 'compact', 'cost'],
        ),
      ),
    )
    console.log()
    console.log(dim(`  ${sessions.length} sessions total · top 15 shown · use --json for all`))
    console.log(dim(`  gaps = >5min pauses (each expires the prompt cache) · compact = context compactions`))
    console.log(dim(`  drill in: vibecheck sessions <id> → longest gaps, compaction receipts, activity split`))
    console.log()
    return
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          totals: totals(events),
          byAgent: byAgent(events),
          byModel: byModel(events),
          byProject: byProject(events),
          byBranch: byBranch(events),
          byActivity: byActivity(events),
          byDay: byDay(events),
          tools: toolUsage(events),
          hourly: hourlyHistogram(events),
          insights: diagnose(events, compactions, fileReads),
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
  const period = periodLabel(args)

  console.log()
  console.log(bold('  🩺 vibecheck') + dim(`  ·  ${period}  ·  all data stays local`))
  console.log()

  if (events.length === 0) {
    console.log('  No sessions found.')
    console.log(dim(`  Looked in: ${args.claudeDir}`))
    console.log(dim(`             ${args.codexDir}`))
    if (args.days || args.month || args.project || args.branch) {
      console.log()
      console.log(`  Your filter (${periodLabel(args)}) may be the reason — try without it.`)
    } else {
      console.log()
      console.log('  If your logs live elsewhere, point me at them:')
      console.log(dim('    vibecheck --claude-dir <path> --codex-dir <path>'))
    }
    return
  }

  // ── vitals strip ──
  const allTokens = t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens
  const runH = turnDurations.reduce((a, td) => a + td.ms, 0) / 3_600_000
  console.log(
    '  ' +
      [
        `${bold(money(t.cost))} API-equivalent spend`,
        `${bold(tokens(allTokens))} tokens`,
        `${t.sessions} sessions`,
        runH >= 1 ? `${bold(fmtHours(runH))} agent runtime` : null,
        green(`${money(t.cacheSavings)} saved by caching`),
      ]
        .filter(Boolean)
        .join(dim('   │   ')),
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
        (overPace ? yellow(`${money(b.projected)} ⚠ over pace`) : green(`${money(b.projected)} on pace`)) +
        (b.remainingPerDay !== null && b.spent < b.budget
          ? dim(` · ≤ ${money(b.remainingPerDay)}/day to stay under`)
          : ''),
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

  // ── by branch (skip if branch data is absent, e.g. codex-only) ──
  const branches = byBranch(events).filter((b) => b.key !== '(unknown)')
  if (branches.length > 1) {
    console.log(bold('  By branch') + dim('  (Claude Code sessions)'))
    console.log(
      indent(
        table(
          branches.slice(0, 10).map((b) => [b.key, String(b.events), tokens(b.tokens), money(b.cost)]),
          ['branch', 'calls', 'tokens', 'cost'],
        ),
      ),
    )
    console.log()
  }

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

  // ── doctor's notes ──
  const notes = diagnose(events, compactions, fileReads)
  if (notes.length) {
    console.log(bold("  Doctor's notes"))
    for (const n of notes) {
      const mark = n.level === 'warn' ? yellow('⚠') : n.level === 'good' ? green('✓') : dim('·')
      console.log(`  ${mark} ${n.level === 'warn' ? yellow(n.text) : n.level === 'good' ? green(n.text) : n.text}`)
    }
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
      `  Parsed ${claude.stats.files + codex.stats.files} files · costs are API-list-price estimates (prices as of ${PRICES_AS_OF})`,
    ),
  )
  console.log()
}

const indent = (s: string) => s.replace(/^/gm, '  ')

/** Local HH:MM for gap timestamps. */
function localTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

main()
