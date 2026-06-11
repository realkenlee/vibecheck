# 🩺 vibevitals

**Check your vitals.** Local-first analytics for your AI coding sessions — Claude Code, Codex, more coming. Where do your tokens actually go?

```
npx vibevitals
```

```
  🩺 vibevitals  ·  all time  ·  all data stays local

  $239 API-equivalent spend   │   477.8M tokens   │   45 sessions   │   $1,212 saved by caching

  By model
  model                      calls  tokens    cost
  ─────────────────────────  ─────  ──────  ──────
  claude-sonnet-4-6           3937  424.8M    $214
  gpt-5.3-codex                171   11.6M   $3.34

  By project
  project             calls  tokens    cost
  ──────────────────  ─────  ──────  ──────
  my-startup           1582  167.6M  $85.76
  side-project         1303  119.7M  $54.14

  When you vibe  (events by hour, local time)
  00 ▁   ▂▃█▃▆▃▃▃▂▃▃▃▆▅▃▄▃▅▂  23
```

## Why

Your AI coding agents already log everything — every token, every tool call, every model — into local JSONL files. Nobody looks at them. vibevitals reads those logs and tells you:

- **API-equivalent spend** per project, model, agent, and day — what your Max/Pro subscription is actually delivering
- **Cache savings** — how much prompt caching saved you vs. list price
- **Usage rhythm** — when you code with AI, which tools your agents lean on
- **Multi-agent view** — Claude Code and Codex in one normalized report

## Privacy

**Everything runs locally. Nothing leaves your machine.** No telemetry, no accounts, no uploads. It's a read-only parser over files you already have.

## Supported agents

| Agent | Data source | Status |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | ✅ |
| OpenAI Codex CLI | `~/.codex/sessions/**/*.jsonl` | ✅ |
| Gemini CLI | — | planned |
| Cursor | — | planned |
| opencode | — | planned |

## Usage

```bash
npx vibevitals              # full report, all time
npx vibevitals --days 30    # last 30 days
npx vibevitals --json       # machine-readable, pipe it anywhere
npx vibevitals --claude-dir /path --codex-dir /path   # custom locations
```

Or as a library:

```ts
import { parseClaudeDir, parseCodexDir, totals, byProject } from 'vibevitals'

const { events } = parseClaudeDir(`${process.env.HOME}/.claude/projects`)
console.log(totals(events))
```

## Accuracy notes

- Costs are **API list-price estimates** (per-MTok rates in [`src/pricing.ts`](src/pricing.ts)). Subscription users: read it as "value consumed," not "money billed."
- Claude Code streams duplicate assistant records — vibevitals dedupes by message id (naive parsers over-count by ~30%).
- Codex `cached_input_tokens` is a subset of `input_tokens` — vibevitals splits it out before pricing.
- Unparseable lines are counted and surfaced — these JSONL schemas are undocumented and drift between agent versions. If you see the schema-drift warning, please [file an issue](../../issues).

## Development

Parsers are the product, so everything is fixture-tested:

```bash
npm install
npm test        # 25 tests over synthetic fixtures encoding every schema gotcha
npm run dev     # build + run against your own sessions
```

## Roadmap

- [ ] Local web dashboard (`vibevitals --web`)
- [ ] "AI Coding Wrapped" shareable card (anonymized, opt-in)
- [ ] Gemini CLI, Cursor, opencode parsers
- [ ] Per-session drill-down (interruption rate, longest sessions)
- [ ] Team aggregates (self-hosted)

## License

MIT
