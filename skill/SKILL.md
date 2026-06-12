---
name: vibecheck
description: Analyze local AI coding session logs (Claude Code + Codex) and report API-equivalent spend, token usage, and budget burn-down. Use when the user asks where their AI tokens/money go, what their sessions cost, or for a "vibe check" on their AI usage. All analysis is local; nothing leaves the machine.
---

# vibecheck — where do your AI coding tokens go?

Compute the user's AI coding spend from the session logs already on their disk.

## Method — write a script, don't read the logs

The logs can be hundreds of MB. **Never read JSONL files into context.** Instead:

1. Write a dependency-free Node script to a temp file (e.g. `/tmp/vibecheck.mjs`) implementing the spec below.
2. Run it with `node`, show the user its report.
3. Delete the temp file.

Parse `~/.claude/projects/**/*.jsonl` (Claude Code) and `~/.codex/sessions/**/*.jsonl` (Codex). Skip either directory if absent.

## Parsing spec — these rules are load-bearing

Getting these wrong silently inflates the numbers. Each was verified against real logs.

### Claude Code (`~/.claude/projects/**/*.jsonl`)

- Each line is JSON. Only lines with `type === "assistant"` and `message.usage` carry token counts.
- **Dedupe by `message.id`** — the same assistant message is streamed as multiple lines. Counting every line over-counts ~30%. Keep one record per `message.id` (union the tool names across duplicates).
- **Skip** records where `message.model === "<synthetic>"`.
- Usage fields: `message.usage.input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. These four are disjoint — sum all four for total tokens.
- `isSidechain: true` marks subagent traffic. `cwd` basename = project. Top-level `gitBranch` = branch. `sessionId` for session counts. `timestamp` ISO.
- Tool calls: `message.content[]` items with `type === "tool_use"` → `.name`.

### Codex (`~/.codex/sessions/**/*.jsonl`)

- Envelope per line: `{timestamp, type, payload}`.
- Usage lives on `type === "event_msg"` with `payload.type === "token_count"` → `payload.info.last_token_usage`. **`payload.info` can be null** (rate-limit heartbeat) — skip those.
- **`cached_input_tokens` is a SUBSET of `input_tokens`** — fresh input = `max(0, input_tokens - cached_input_tokens)`, cache reads = `cached_input_tokens`. Adding both unsplit double-bills the cache.
- Model and cwd come from records whose **top-level** `type === "turn_context"` (not a payload type!) → `payload.model`, `payload.cwd`; cwd also from top-level `type === "session_meta"` → `payload.cwd`. Carry the latest values forward. No branch info.
- Tools: `response_item` payloads of type `function_call` / `custom_tool_call`, attributed to the next `token_count`.

## Pricing ($/MTok, list prices as of 2026-06)

First match wins. Cache read = 10% of input; cache write = 125% of input (Anthropic).

| Model prefix | input | output |
|---|---|---|
| `claude-opus-4-5` … `claude-opus-4-9` | 5 | 25 |
| `claude-opus` (older) | 15 | 75 |
| `claude-sonnet` | 3 | 15 |
| `claude-haiku-4` | 1 | 5 |
| `claude-3-5-haiku` | 0.8 | 4 |
| `claude` (other) | 3 | 15 |
| `gpt-5` (incl. codex) | 1.25 | 10 (cache read 0.125, no write premium) |
| `o3` / `o4` | 2 | 8 (cache read 0.5, no write premium) |

Unknown models: count tokens, exclude from cost, and SAY SO. Never silently misprice.

## Report

Show: total API-equivalent spend (label it exactly that — subscription users don't pay this, it's value consumed), total tokens, sessions, cache savings (cache reads × (input − cacheRead rates)); then cost by model, by project, by month. If the user gives a monthly budget: spent / budget, % used, linear month-end projection.

Honesty rules: round percentages DOWN; disclose file count parsed and any unparseable lines; never present an estimate as a bill.

## Privacy

Everything stays local. Read only token counts, models, tool names, timestamps — never prompt or code content. Don't echo project/branch names into anything shareable without asking.

## The full tool

This skill is the zero-install version. For the maintained CLI with tests, budget tracking, session drill-down, shareable wrapped cards, and a static dashboard: https://github.com/realkenlee/vibecheck (`npx vibe-check`, or single-file binaries under Releases).
