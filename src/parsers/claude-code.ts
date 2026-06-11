// Parser for Claude Code session transcripts: ~/.claude/projects/<encoded-cwd>/<session>.jsonl
//
// Schema notes (undocumented, verified against real sessions, CC ~2.x):
// - One JSON object per line; `type` discriminates: user | assistant | system | ...
// - Assistant records carry `message.usage` with input_tokens, output_tokens,
//   cache_read_input_tokens, cache_creation_input_tokens.
// - CRITICAL: the same assistant message id can appear on MULTIPLE lines
//   (streamed updates) with identical usage — dedupe by message.id or you
//   double-count ~30% of spend.
// - `isSidechain: true` marks subagent traffic.
// - `cwd` is the project working directory; `message.model` the model id.
// - Synthetic/error records use model "<synthetic>" — no real usage, skip.

import { readdirSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { ParseResult, UsageEvent } from '../schema.js'

interface ClaudeUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export function parseClaudeLines(lines: Iterable<string>, sessionId: string): ParseResult {
  // message.id -> event (later lines for the same id are more complete; usage is identical)
  const byId = new Map<string, UsageEvent>()
  let skippedLines = 0
  let anonCounter = 0

  for (const line of lines) {
    if (!line.trim()) continue
    let d: Record<string, unknown>
    try {
      d = JSON.parse(line)
    } catch {
      skippedLines++
      continue
    }
    if (d.type !== 'assistant') continue
    const msg = d.message as
      | { id?: string; model?: string; usage?: ClaudeUsage; content?: unknown }
      | undefined
    if (!msg?.usage) continue
    const model = msg.model ?? 'unknown'
    if (model === '<synthetic>') continue

    const u = msg.usage
    const toolCalls = Array.isArray(msg.content)
      ? (msg.content as { type?: string; name?: string }[])
          .filter((c) => c.type === 'tool_use' && c.name)
          .map((c) => c.name as string)
      : []

    const id = msg.id ?? `anon-${anonCounter++}`
    const prev = byId.get(id)
    if (prev) {
      // streamed duplicate — union tool names, keep latest usage (identical in practice)
      for (const t of toolCalls) if (!prev.toolCalls.includes(t)) prev.toolCalls.push(t)
      continue
    }
    byId.set(id, {
      agent: 'claude-code',
      sessionId,
      project: typeof d.cwd === 'string' && d.cwd ? basename(d.cwd) : 'unknown',
      timestamp: typeof d.timestamp === 'string' ? d.timestamp : '',
      model,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      toolCalls,
      sidechain: d.isSidechain === true,
    })
  }

  const events = [...byId.values()]
  return {
    events,
    stats: { files: 1, sessions: 1, events: events.length, skippedLines },
  }
}

/** Recursively parse every *.jsonl under a Claude Code projects root. */
export function parseClaudeDir(root: string): ParseResult {
  const events: UsageEvent[] = []
  let files = 0
  let skippedLines = 0
  const sessions = new Set<string>()

  for (const path of walkJsonl(root)) {
    files++
    const sessionId = basename(path, '.jsonl')
    sessions.add(sessionId)
    const r = parseClaudeLines(readFileSync(path, 'utf8').split('\n'), sessionId)
    events.push(...r.events)
    skippedLines += r.stats.skippedLines
  }
  return { events, stats: { files, sessions: sessions.size, events: events.length, skippedLines } }
}

export function* walkJsonl(root: string): Generator<string> {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = join(root, e.name)
    if (e.isDirectory()) yield* walkJsonl(p)
    else if (e.name.endsWith('.jsonl')) yield p
  }
}
