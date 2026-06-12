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
// - Tool RESULTS live on `user`-type lines: message.content[] items with
//   type "tool_result", matched to their call by `tool_use_id`. `is_error`
//   marks failures. Content is a string or an array of {text} blocks.
// - Compactions are `system` lines with subtype "compact_boundary" and
//   compactMetadata {trigger, preTokens, postTokens} — exact receipts for
//   how much context each compaction shed.

import { readdirSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { Compaction, FileRead, ParseResult, UsageEvent } from '../schema.js'

interface ClaudeUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

// tool_result content is a string or an array of text blocks
function resultLength(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (Array.isArray(content))
    return content.reduce(
      (a, c) => a + (typeof (c as { text?: unknown }).text === 'string' ? ((c as { text: string }).text.length) : 0),
      0,
    )
  return 0
}

export function parseClaudeLines(lines: Iterable<string>, sessionId: string): ParseResult {
  // message.id -> event (later lines for the same id are more complete; usage is identical)
  const byId = new Map<string, UsageEvent>()
  // tool_use id -> event, so results (which arrive on later `user` lines) attribute back
  const byToolUse = new Map<string, UsageEvent>()
  const compactions: Compaction[] = []
  // Read-tool calls: tool_use id -> record, so result sizes attribute per file.
  // Only the BASENAME is kept — full paths never leave this function.
  const fileReads: FileRead[] = []
  const byReadId = new Map<string, FileRead>()
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
    if (d.type === 'system' && d.subtype === 'compact_boundary') {
      const m = d.compactMetadata as
        | { trigger?: string; preTokens?: number; postTokens?: number }
        | undefined
      if (m) {
        compactions.push({
          sessionId,
          timestamp: typeof d.timestamp === 'string' ? d.timestamp : '',
          trigger: typeof m.trigger === 'string' ? m.trigger : 'unknown',
          preTokens: m.preTokens ?? 0,
          postTokens: m.postTokens ?? 0,
        })
      }
      continue
    }
    if (d.type === 'user') {
      // tool results — attribute size + errors back to the calling turn
      const content = (d.message as { content?: unknown } | undefined)?.content
      if (Array.isArray(content)) {
        for (const c of content as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) {
          if (c.type !== 'tool_result' || !c.tool_use_id) continue
          const ev = byToolUse.get(c.tool_use_id)
          if (ev) {
            ev.toolResultBytes = (ev.toolResultBytes ?? 0) + resultLength(c.content)
            if (c.is_error) ev.toolErrors = (ev.toolErrors ?? 0) + 1
          }
          const fr = byReadId.get(c.tool_use_id)
          if (fr) fr.bytes += resultLength(c.content)
        }
      }
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
    const toolUses = Array.isArray(msg.content)
      ? (msg.content as { type?: string; name?: string; id?: string; input?: { file_path?: unknown } }[]).filter(
          (c) => c.type === 'tool_use' && c.name,
        )
      : []
    const toolCalls = toolUses.map((c) => c.name as string)
    const timestamp = typeof d.timestamp === 'string' ? d.timestamp : ''
    // Read calls become FileRead records (dedupe by tool_use id — the same
    // call can appear on multiple streamed lines of the same message)
    for (const c of toolUses) {
      if (c.name !== 'Read' || !c.id || byReadId.has(c.id)) continue
      if (typeof c.input?.file_path !== 'string' || !c.input.file_path) continue
      const fr: FileRead = { sessionId, timestamp, file: basename(c.input.file_path), bytes: 0 }
      fileReads.push(fr)
      byReadId.set(c.id, fr)
    }

    const id = msg.id ?? `anon-${anonCounter++}`
    const prev = byId.get(id)
    if (prev) {
      // streamed duplicate — union tool names, keep latest usage (identical in practice)
      for (const t of toolCalls) if (!prev.toolCalls.includes(t)) prev.toolCalls.push(t)
      for (const c of toolUses) if (c.id) byToolUse.set(c.id, prev)
      continue
    }
    byId.set(id, {
      agent: 'claude-code',
      sessionId,
      project: typeof d.cwd === 'string' && d.cwd ? basename(d.cwd) : 'unknown',
      timestamp,
      model,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      toolCalls,
      toolResultBytes: 0,
      toolErrors: 0,
      sidechain: d.isSidechain === true,
      gitBranch: typeof d.gitBranch === 'string' && d.gitBranch ? d.gitBranch : null,
    })
    const event = byId.get(id)!
    for (const c of toolUses) if (c.id) byToolUse.set(c.id, event)
  }

  const events = [...byId.values()]
  return {
    events,
    stats: { files: 1, sessions: 1, events: events.length, skippedLines },
    compactions,
    fileReads,
  }
}

/** Recursively parse every *.jsonl under a Claude Code projects root. */
export function parseClaudeDir(root: string): ParseResult {
  const events: UsageEvent[] = []
  const compactions: Compaction[] = []
  const fileReads: FileRead[] = []
  let files = 0
  let skippedLines = 0
  const sessions = new Set<string>()

  for (const path of walkJsonl(root)) {
    files++
    const sessionId = basename(path, '.jsonl')
    sessions.add(sessionId)
    const r = parseClaudeLines(readFileSync(path, 'utf8').split('\n'), sessionId)
    events.push(...r.events)
    compactions.push(...(r.compactions ?? []))
    fileReads.push(...(r.fileReads ?? []))
    skippedLines += r.stats.skippedLines
  }
  return {
    events,
    stats: { files, sessions: sessions.size, events: events.length, skippedLines },
    compactions,
    fileReads,
  }
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
