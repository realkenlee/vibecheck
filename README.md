# 🩺 vibevitals

[![ci](https://github.com/realkenlee/vibevitals/actions/workflows/ci.yml/badge.svg)](https://github.com/realkenlee/vibevitals/actions/workflows/ci.yml)

**Know where your AI coding tokens go.** Local-first analytics for Claude Code and Codex sessions — spend, activities, budget burn-down. Free forever for individuals.

```
npx vibevitals
```

```
  🩺 vibevitals  ·  all time  ·  all data stays local

  $239 API-equivalent spend   │   477.8M tokens   │   45 sessions   │   $1,212 saved by caching

  Budget (2026-06)   $122 of $200  ▕████████░░░░░░▏ 61%   day 10/30 · projected $367 ⚠ over pace

  Where tokens go  (by dominant activity per turn)
  activity     turns  tokens     cost  share
  ───────────  ─────  ──────  ───────  ─────
  executing     2262  229.2M     $107    45%
  editing        728   87.1M   $44.82    19%
  reasoning      784   77.6M   $41.89    17%
  exploring      716   67.1M   $34.51    14%

  By model                              By branch  (Claude Code sessions)
  model               calls    cost     branch              calls    cost
  ─────────────────   ─────  ──────     ─────────────────   ─────  ──────
  claude-sonnet-4-6    3937    $214     feat/q2-migration    1582  $85.76
  gpt-5.3-codex         171   $3.34     main                 1303  $54.14

  When you vibe  (events by hour, local time)
  00 ▁   ▂▃█▃▆▃▃▃▂▃▃▃▆▅▃▄▃▅▂  23

  Doctor's notes
  · 44% of spend is command-running turns. Verbose build/test output is
    token-hungry — pipe through tail/grep, silence noisy commands.
  ✓ Healthy cache: 99% of input was served from cache, saving $851 vs list price.
```

## The problem

Every developer now has an AI usage limit — and no instrument panel. Your agents already log everything (every token, tool call, and model) into local JSONL files nobody reads. vibevitals reads them and answers:

- **Am I going to blow my monthly limit?** — `--budget` burn-down with projection to month end
- **What activities eat my tokens?** — editing vs. executing vs. exploring vs. reasoning, per turn
- **What did that branch cost?** — spend by branch, project, model, agent, and day
- **What is caching saving me?** — vs. API list price (often 5× the headline spend)

One normalized report across Claude Code and Codex. More agents coming.

## Privacy

**Everything runs locally. Nothing leaves your machine.** No telemetry, no accounts, no uploads. It's a read-only parser over files you already have. Prompt and code content is never parsed — only token counts, models, tool names, and timestamps.

## Usage

```bash
npx vibevitals                   # full report, all time
npx vibevitals --days 30         # last 30 days
npx vibevitals --budget 200      # monthly soft limit → burn-down + projection
npx vibevitals sessions          # most expensive sessions, span + turns
npx vibevitals wrapped --out wrapped.svg   # shareable card (aggregates only)
npx vibevitals web               # static HTML dashboard — no server, opens in browser
npx vibevitals --json            # machine-readable, pipe it anywhere
```

Set `VIBEVITALS_BUDGET=200` to make the budget bar permanent.

Or as a library:

```ts
import { parseClaudeDir, totals, byActivity, budgetStatus } from 'vibevitals'

const { events } = parseClaudeDir(`${process.env.HOME}/.claude/projects`)
console.log(byActivity(events))
```

## For teams & enterprise

ICs get visibility for free. Engineering leaders get the questions ICs can't answer alone: *is our AI spend producing edits or spinning on retries? Which teams are over their soft limits? What did the migration actually cost?*

The bridge is `vibevitals export` — an **aggregates-only** JSON report each developer can inspect line-by-line before sharing:

```bash
vibevitals export --days 30 --out report.json   # totals, activities, models, daily spend
vibevitals export --anonymous                   # …without your git name/email
vibevitals export --include-projects            # opt-in: project + branch names
```

By default the export contains **no prompts, no code, no file paths, no session ids, no project or branch names** — read [`src/export.ts`](src/export.ts), it's one screen of code.

**vibevitals for Teams** (hosted rollups, org-wide burn-down, activity benchmarks, gateway-level capture) is in design. Interested? → khflee@gmail.com

## Supported agents

| Agent | Data source | Status |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | ✅ |
| OpenAI Codex CLI | `~/.codex/sessions/**/*.jsonl` | ✅ |
| Gemini CLI | — | planned |
| Cursor | — | planned |
| opencode | — | planned |

## Accuracy notes

- Costs are **API list-price estimates** (per-MTok rates in [`src/pricing.ts`](src/pricing.ts)). Subscription users: read it as "value consumed," not "money billed."
- Claude Code streams duplicate assistant records — vibevitals dedupes by message id (naive parsers over-count by ~30%).
- Codex `cached_input_tokens` is a subset of `input_tokens` — vibevitals splits it out before pricing.
- Activity attribution is per-turn by dominant tool (precedence: editing > executing > delegating > exploring > planning). Read it as "cost of turns spent doing X."
- Unparseable lines are counted and surfaced — these JSONL schemas are undocumented and drift between agent versions. If you see the schema-drift warning, please [file an issue](../../issues).

## Development

Parsers are the product, so everything is fixture-tested:

```bash
npm install
npm test        # 40 tests over synthetic fixtures encoding every schema gotcha
npm run dev     # build + run against your own sessions
```

## Roadmap

- [x] Activity attribution ("where tokens go")
- [x] Budget burn-down with month-end projection
- [x] Branch-level cost attribution
- [x] Aggregates-only team export
- [x] Session drill-down (`vibevitals sessions`)
- [x] Doctor's notes (actionable diagnosis: cache health, spend skews)
- [x] "AI Coding Wrapped" shareable card (`vibevitals wrapped`, SVG, aggregates only)
- [x] Local dashboard (`vibevitals web` — single static HTML file, no server, no JS)
- [ ] Gemini CLI, Cursor, opencode parsers
- [ ] vibevitals for Teams (hosted)

## License

MIT — free for everyone, forever. The CLI will never phone home.
