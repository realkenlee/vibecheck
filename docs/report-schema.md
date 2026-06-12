# `vibecheck.report.v1` — the export schema

`vibecheck export` emits one JSON document. This is the contract a team
dashboard (or any consumer) can build against. Versioning policy: **fields are
only added within v1, never renamed, removed, or re-typed** — a breaking change
bumps the `schema` string to `vibecheck.report.v2`.

The privacy contract is the product: the report contains **aggregates only**.
No prompts, no file paths, no session ids, no tool names, and — by default —
no project or branch names. An IC can read the entire payload before sharing
it. A test plants secret names in every input and greps the serialized output.

## Top-level fields

| field | type | meaning |
|---|---|---|
| `schema` | `"vibecheck.report.v1"` | Version discriminator — switch on this before parsing anything else |
| `generatedAt` | ISO 8601 string | When the report was generated |
| `period` | object | Reporting window: `days` (the `--days` filter, or null), `from`/`to` (first/last local active date in the data, or null when empty) |
| `user` | object | `name`/`email` from git config; both null with `--anonymous` or when git is unavailable |
| `totals` | Totals | Headline aggregates (see below) |
| `byActivity` | ActivityBucket[] | Cost split by dominant activity per turn (editing, executing, reasoning, …) |
| `byModel` | Bucket[] | Per-model rollup; key = model id (model names are not sensitive) |
| `byAgent` | Bucket[] | Per-agent rollup; key = `claude-code` \| `codex` |
| `byDay` | Bucket[] | Per-day rollup; key = local `YYYY-MM-DD` |
| `agentHours` | number \| null | Summed measured turn durations, in hours. Null when unrecorded (Codex doesn't log durations) — null means "unknown", never 0. Runtime, not wall-clock: parallel subagents stack |
| `insights` | array | Doctor's notes as `{id, level}` ONLY — never rendered text, which can contain file or project names. The id vocabulary and thresholds live in [doctor-notes.md](doctor-notes.md) |
| `budget` | BudgetStatus \| null | Present only when `--budget` (or `VIBECHECK_BUDGET`) is set |
| `byProject` | Bucket[] (optional) | Only with `--include-projects` — project names can be confidential codenames, so they are opt-in |
| `byBranch` | Bucket[] (optional) | Only with `--include-projects`; key `(unknown)` for agents that don't record branches |

## Shapes

**Totals** — `events`, `sessions`, `inputTokens`, `outputTokens`,
`cacheReadTokens`, `cacheWriteTokens` (counts), `cost` (API-equivalent USD),
`cacheSavings` (USD vs. uncached), `unknownModels` (string[] — models we
couldn't price; their spend is **not** in `cost`, never silently mispriced).

**Bucket** — `key`, `events`, `tokens` (all four token kinds summed), `cost`.

**ActivityBucket** — `activity`, `events`, `tokens`, `cost`, `share`
(0..1 share of total cost).

**BudgetStatus** — `month` (`YYYY-MM`), `spent`, `budget`, `used`
(spent/budget, may exceed 1), `projected` (linear month-end projection),
`daysElapsed`, `daysInMonth`, `remainingPerDay` (USD/day to stay under;
null on the last day).

## Semantics consumers get wrong

- **Cost is API-equivalent value, not a bill.** Subscription users never paid
  it. Label it that way.
- **`agentHours` is runtime.** Summing a team's hours can exceed wall-clock
  time — that's parallelism, not an error.
- **`cacheReadTokens` are cheap, not free** — already priced into `cost`.
- **`insights` levels** are `warn` / `info` / `good`; aggregate by id across
  reports to see which advice a team actually needs.
