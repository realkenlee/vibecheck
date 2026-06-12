# Changelog

All notable changes to vibecheck. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added
- The `web` dashboard's doctor's notes now include compaction receipts (compactions are threaded through `WebOptions`)
- The zero-install skill now specifies the three highest-value doctor's notes (context tax, idle gaps, compaction receipts) with exact thresholds

### Fixed
- Skill spec: session identity is the **.jsonl filename**, not the embedded `sessionId` field (which can differ after resumes) — caught by re-validating a from-spec implementation against the CLI

## [0.5.0] — 2026-06-11

### Added
- Claude Code parser now extracts **compaction receipts** (`compact_boundary` records → `Compaction` on `ParseResult`: trigger, preTokens, postTokens)
- Doctor's note for **compaction receipts** — when ≥80% of compactions are auto-forced at the context ceiling, reports exactly how many tokens each one shed and suggests compacting between tasks instead
- Claude Code parser now captures **tool-result sizes and errors** (`toolResultBytes`, `toolErrors` on `UsageEvent`) — results live on `user` lines, matched by `tool_use_id`
- Doctor's note for **failure tax** — flags when >8% of tool-using turns return errors (each failure usually costs a retry turn)
- Doctor's note for **tool-result diet** — warns past ~8KB/turn (results are re-read every later turn), praises lean output under 3KB
- Doctor's note for **verbosity drift** — month-over-month rise in output tokens per turn (output is the 5×-priced line item)
- Doctor's note for **context tax** — sessions past 100 turns re-pay their whole history as cache reads every turn; quantifies the excess vs each session's own early baseline ("context is rent, not a purchase")
- Doctor's note for **idle gaps** — >5min pauses inside sessions expire the prompt cache; counts the gaps and prices the post-gap cache rebuilds
- **Zero-install Claude Code skill** ([`skill/SKILL.md`](skill/SKILL.md)) — encodes the full parsing spec (message-id dedupe, cache-subset split, list prices) so Claude Code can compute the report with no install at all. Validated: an implementation written from the spec alone matches the CLI's output exactly.

## [0.4.0] — 2026-06-11

### Changed
- **Renamed: vibevitals → vibecheck.** npm package is `vibe-check` (unhyphenated name is squatted); the installed command is `vibecheck`. Export schema is now `vibecheck.report.v1`; budget env var is now `VIBECHECK_BUDGET`. Release binaries are named `vibecheck-<platform>`.

### Added
- Doctor's note for **cache thrash** — warns when cache-write premium (1.25× input rate) exceeds what cache reads saved
- **By month** section in the `web` dashboard

## [0.3.0] — 2026-06-11

> Released under the old name, `vibevitals`.

### Added
- `vibecheck months` — month-over-month spend trend with Δ% column
- `--version` / `-v` flag (version is compiled into the single-file binaries)
- Loud input validation: `--month 2026-13`, `--days 0`, `--budget -5` now exit 1 with a reason instead of silently reporting $0
- Pricing freshness disclosure in the report footer ("prices as of YYYY-MM")
- Teaching empty states: suggests `--claude-dir`/`--codex-dir`, or points at your active filter
- CI contract step asserting bad input exits non-zero

### Changed
- GitHub Actions bumped to `checkout@v5` / `setup-node@v5`

## [0.2.0] — 2026-06-10

### Added
- **Single-file binaries** for macOS (arm64/x64), Linux (arm64/x64), Windows — built with `bun build --compile`, attached to GitHub Releases with SHA256SUMS. No Node required
- `vibecheck web` — self-contained static HTML dashboard: zero scripts, zero external resources, all data stays local
- `vibecheck wrapped` — shareable 1200×630 "AI Coding Wrapped" SVG card (aggregate numbers only; tested to never contain project or branch names)
- `vibecheck sessions` — most expensive sessions with wall-clock span, turns, dominant project
- `vibecheck export` — versioned `vibecheck.report.v1` team report: aggregates only, project/branch names opt-in via `--include-projects`, `--anonymous` strips git identity
- Doctor's notes — deterministic, threshold-gated diagnosis (cache health, activity skews, subagent share, whale sessions, night-owl hours)
- Activity attribution ("Where tokens go"): editing / executing / exploring / delegating / planning / reasoning
- Budget burn-down: `--budget` / `VIBECHECK_BUDGET` with projection and daily allowance
- `--month YYYY-MM` reconciliation filter
- Branch attribution (Claude Code records `gitBranch`)
- CI across Node 18/20/22

## [0.1.0] — 2026-06-10

### Added
- Claude Code parser (`~/.claude/projects`) with `message.id` dedupe — naive parsers over-count ~30%
- Codex parser (`~/.codex/sessions`) handling null token_count heartbeats and cached-input-as-subset
- Normalized `UsageEvent` schema; API-list-price cost estimates with cache savings
- Report: spend, tokens, by model / project / agent, daily spend, hourly rhythm, tool usage
- Zero runtime dependencies; nothing leaves your machine
