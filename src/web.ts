// Local HTML dashboard — a single self-contained static file. No server, no
// port, no JS dependencies; everything is rendered at generation time. Your
// data is private because the dashboard is just a file on your disk.

import type { Compaction, FileRead, UsageEvent } from './schema.js'
import {
  totals,
  byModel,
  byProject,
  byBranch,
  byDay,
  byMonth,
  bySession,
  toolUsage,
  hourlyHistogram,
  budgetStatus,
} from './analytics.js'
import { byActivity } from './activities.js'
import { diagnose } from './insights.js'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const money = (n: number) => `$${n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2)}`
const fmtTokens = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${(n / 1e3).toFixed(1)}k`

function barTable(rows: { key: string; cost: number; tokens: number; events: number }[], label: string): string {
  if (rows.length === 0) return ''
  const max = Math.max(...rows.map((r) => r.cost), 0.001)
  const body = rows
    .map(
      (r) => `<tr><td>${esc(r.key)}</td><td class="num">${r.events}</td><td class="num">${fmtTokens(
        r.tokens,
      )}</td><td class="num">${money(r.cost)}</td><td class="barcell"><div class="bar" style="width:${Math.max(
        1,
        Math.round((r.cost / max) * 100),
      )}%"></div></td></tr>`,
    )
    .join('\n')
  return `<section><h2>${esc(label)}</h2><table>
<thead><tr><th></th><th class="num">calls</th><th class="num">tokens</th><th class="num">cost</th><th></th></tr></thead>
<tbody>${body}</tbody></table></section>`
}

export interface WebOptions {
  days?: number | null
  budget?: number | null
  now?: Date
  compactions?: Compaction[]
  fileReads?: FileRead[]
}

export function dashboardHtml(events: UsageEvent[], opts: WebOptions = {}): string {
  const t = totals(events)
  const allTokens = t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens
  const period = opts.days ? `last ${opts.days} days` : 'all time'
  const acts = byActivity(events)
  const days = byDay(events).filter((d) => d.key !== 'unknown')
  const recent = days.slice(-30)
  const hours = hourlyHistogram(events)
  const maxHour = Math.max(...hours, 1)
  const notes = diagnose(events, opts.compactions ?? [], opts.fileReads ?? [])
  const sessions = bySession(events).slice(0, 15)
  const months = byMonth(events).filter((m) => m.key !== 'unknown')
  const branches = byBranch(events).filter((b) => b.key !== '(unknown)')
  const budget = opts.budget ? budgetStatus(events, opts.budget, opts.now) : null

  const vitals = `
<div class="vitals">
  <div class="stat"><div class="big">${money(t.cost)}</div><div class="label">API-equivalent spend</div></div>
  <div class="stat"><div class="big">${fmtTokens(allTokens)}</div><div class="label">tokens</div></div>
  <div class="stat"><div class="big">${t.sessions}</div><div class="label">sessions</div></div>
  <div class="stat"><div class="big good">${money(t.cacheSavings)}</div><div class="label">saved by caching</div></div>
</div>`

  const budgetHtml = budget
    ? `<section><h2>Budget (${budget.month})</h2>
<div class="budgetline">${money(budget.spent)} of ${money(budget.budget)} · day ${budget.daysElapsed}/${budget.daysInMonth} · projected <span class="${budget.projected > budget.budget ? 'warn' : 'good'}">${money(budget.projected)}${budget.projected > budget.budget ? ' ⚠ over pace' : ' on pace'}</span></div>
<div class="track"><div class="fill ${budget.used >= 1 || budget.projected > budget.budget ? 'warnbg' : 'goodbg'}" style="width:${Math.min(100, Math.round(budget.used * 100))}%"></div></div>
</section>`
    : ''

  const notesHtml = notes.length
    ? `<section><h2>Doctor's notes</h2><ul class="notes">${notes
        .map((n) => `<li class="${n.level}">${esc(n.text)}</li>`)
        .join('')}</ul></section>`
    : ''

  const activityHtml = acts.length
    ? `<section><h2>Where tokens go</h2><div class="actbar">${acts
        .map(
          (a, i) =>
            `<div class="actseg c${i % 7}" style="width:${Math.max(0.5, a.share * 100)}%" title="${esc(
              a.activity,
            )} ${Math.round(a.share * 100)}%"></div>`,
        )
        .join('')}</div><div class="legend">${acts
        .map(
          (a, i) =>
            `<span><i class="dot c${i % 7}"></i>${esc(a.activity)} ${Math.round(a.share * 100)}% (${money(a.cost)})</span>`,
        )
        .join(' ')}</div></section>`
    : ''

  const maxDay = Math.max(...recent.map((d) => d.cost), 0.001)
  const dailyHtml = recent.length > 1
    ? `<section><h2>Daily spend <span class="dim">(last ${recent.length} active days)</span></h2>
<div class="chart">${recent
        .map(
          (d) =>
            `<div class="col" title="${d.key} ${money(d.cost)}"><div class="colfill" style="height:${Math.max(
              2,
              Math.round((d.cost / maxDay) * 100),
            )}%"></div></div>`,
        )
        .join('')}</div>
<div class="legend"><span>${recent[0].key}</span><span style="float:right">${recent[recent.length - 1].key}</span></div></section>`
    : ''

  const hourlyHtml = `<section><h2>When you vibe <span class="dim">(events by local hour)</span></h2>
<div class="chart small">${hours
    .map(
      (h, i) =>
        `<div class="col" title="${String(i).padStart(2, '0')}:00 — ${h} events"><div class="colfill" style="height:${Math.max(
          h > 0 ? 4 : 0,
          Math.round((h / maxHour) * 100),
        )}%"></div></div>`,
    )
    .join('')}</div>
<div class="legend"><span>00</span><span style="float:right">23</span></div></section>`

  const sessionsHtml = sessions.length
    ? `<section><h2>Top sessions</h2><table>
<thead><tr><th>date</th><th>project</th><th>agent</th><th class="num">span</th><th class="num">turns</th><th class="num">cost</th></tr></thead>
<tbody>${sessions
        .map(
          (s) =>
            `<tr><td class="dim">${esc(s.start.slice(0, 10))}</td><td>${esc(s.project)}</td><td>${esc(
              s.agent,
            )}</td><td class="num">${s.minutes >= 60 ? `${Math.floor(s.minutes / 60)}h${s.minutes % 60}m` : `${s.minutes}m`}</td><td class="num">${s.turns}</td><td class="num">${money(s.cost)}</td></tr>`,
        )
        .join('\n')}</tbody></table></section>`
    : ''

  const tools = toolUsage(events).slice(0, 10)
  const maxTool = Math.max(...tools.map(([, n]) => n), 1)
  const toolsHtml = tools.length
    ? `<section><h2>Top tools</h2><table>
<thead><tr><th></th><th class="num">calls</th><th></th></tr></thead>
<tbody>${tools
        .map(
          ([name, n]) =>
            `<tr><td>${esc(name)}</td><td class="num">${n}</td><td class="barcell"><div class="bar" style="width:${Math.max(1, Math.round((n / maxTool) * 100))}%"></div></td></tr>`,
        )
        .join('\n')}</tbody></table></section>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>vibecheck — ${esc(period)}</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0d1117; color:#e6edf3; font-family:'SF Mono','Cascadia Code',Menlo,Consolas,monospace; margin:0; padding:32px; }
  .wrap { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0; background:linear-gradient(90deg,#34d399,#22d3ee); -webkit-background-clip:text; background-clip:text; color:transparent; display:inline-block; }
  .sub { color:#8b949e; font-size:13px; margin: 6px 0 24px; }
  h2 { font-size: 15px; margin: 0 0 12px; color:#e6edf3; }
  section { background:#161b22; border:1px solid #30363d; border-radius:12px; padding:20px 24px; margin-bottom:16px; }
  .vitals { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:16px; }
  .stat { flex:1; min-width:160px; background:#161b22; border:1px solid #30363d; border-radius:12px; padding:18px 22px; }
  .big { font-size:30px; font-weight:700; }
  .label { color:#8b949e; font-size:12px; margin-top:4px; }
  .good { color:#34d399; } .warn { color:#e3b341; }
  .goodbg { background:#34d399; } .warnbg { background:#e3b341; }
  .dim { color:#8b949e; font-weight:400; font-size:12px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:#8b949e; font-weight:400; padding:4px 12px 8px 0; border-bottom:1px solid #30363d; }
  td { padding:6px 12px 6px 0; border-bottom:1px solid #21262d; }
  .num { text-align:right; }
  .barcell { width:30%; } .bar { height:8px; border-radius:4px; background:linear-gradient(90deg,#34d399,#22d3ee); }
  .track { height:14px; background:#21262d; border-radius:7px; overflow:hidden; margin-top:10px; }
  .fill { height:100%; border-radius:7px; }
  .budgetline { font-size:13px; }
  .notes { list-style:none; padding:0; margin:0; font-size:13px; }
  .notes li { padding:5px 0 5px 22px; position:relative; }
  .notes li::before { position:absolute; left:0; }
  .notes li.warn::before { content:'⚠'; color:#e3b341; }
  .notes li.info::before { content:'·'; color:#8b949e; }
  .notes li.good::before { content:'✓'; color:#34d399; }
  .notes li.warn { color:#e3b341; } .notes li.good { color:#34d399; }
  .actbar { display:flex; height:18px; border-radius:9px; overflow:hidden; margin-bottom:10px; }
  .legend { color:#8b949e; font-size:12px; line-height:1.9; }
  .legend span { margin-right:14px; }
  .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:5px; }
  .c0{background:#34d399}.c1{background:#22d3ee}.c2{background:#a78bfa}.c3{background:#f472b6}.c4{background:#e3b341}.c5{background:#fb923c}.c6{background:#8b949e}
  .chart { display:flex; align-items:flex-end; gap:2px; height:120px; }
  .chart.small { height:60px; }
  .col { flex:1; display:flex; align-items:flex-end; height:100%; }
  .colfill { width:100%; background:linear-gradient(180deg,#22d3ee,#34d399); border-radius:2px 2px 0 0; }
  footer { color:#8b949e; font-size:12px; margin-top:24px; text-align:center; }
</style>
</head>
<body><div class="wrap">
<h1>🩺 vibecheck</h1>
<div class="sub">${esc(period)} · generated ${esc((opts.now ?? new Date()).toISOString().slice(0, 16).replace('T', ' '))} · static file, all data stays local</div>
${vitals}
${budgetHtml}
${notesHtml}
${activityHtml}
${dailyHtml}
${months.length > 1 ? barTable(months, 'By month') : ''}
${hourlyHtml}
${barTable(byModel(events).slice(0, 8), 'By model')}
${barTable(byProject(events).slice(0, 10), 'By project')}
${branches.length > 1 ? barTable(branches.slice(0, 10), 'By branch') : ''}
${sessionsHtml}
${toolsHtml}
<footer>npx vibe-check · costs are API-list-price estimates · nothing leaves your machine</footer>
</div></body></html>
`
}
