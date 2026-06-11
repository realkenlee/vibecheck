// Parser for OpenAI Codex CLI session logs: ~/.codex/sessions/**/*.jsonl
//
// Schema notes (undocumented, verified against real sessions, codex_cli_rs 0.4x):
// - Envelope: { timestamp, type, payload }
// - session_meta: cwd, cli_version (session defaults)
// - turn_context: model + cwd for subsequent turns
// - event_msg/token_count: payload.info.last_token_usage holds per-response
//   usage { input_tokens, cached_input_tokens, output_tokens, ... }.
//   info can be NULL (rate-limit-only heartbeats) — skip those.
//   cached_input_tokens is a SUBSET of input_tokens.
// - response_item/function_call + custom_tool_call: tool names; attributed to
//   the next token_count event.

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { ParseResult, UsageEvent } from '../schema.js'
import { walkJsonl } from './claude-code.js'

interface TokenUsage {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
}

export function parseCodexLines(lines: Iterable<string>, sessionId: string): ParseResult {
  const events: UsageEvent[] = []
  let skippedLines = 0
  let model = 'unknown'
  let cwd = ''
  let pendingTools: string[] = []

  for (const line of lines) {
    if (!line.trim()) continue
    let d: { timestamp?: string; type?: string; payload?: Record<string, unknown> }
    try {
      d = JSON.parse(line)
    } catch {
      skippedLines++
      continue
    }
    const p = d.payload ?? {}

    if (d.type === 'session_meta') {
      if (typeof p.cwd === 'string') cwd = p.cwd
      continue
    }
    if (d.type === 'turn_context') {
      if (typeof p.model === 'string') model = p.model
      if (typeof p.cwd === 'string') cwd = p.cwd
      continue
    }
    if (d.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) {
      if (typeof p.name === 'string') pendingTools.push(p.name)
      continue
    }
    if (d.type === 'event_msg' && p.type === 'token_count') {
      const info = p.info as { last_token_usage?: TokenUsage } | null | undefined
      const u = info?.last_token_usage
      if (!u) continue // rate-limit heartbeat
      const cached = u.cached_input_tokens ?? 0
      events.push({
        agent: 'codex',
        sessionId,
        project: cwd ? basename(cwd) : 'unknown',
        timestamp: d.timestamp ?? '',
        model,
        inputTokens: Math.max(0, (u.input_tokens ?? 0) - cached), // input includes cached — split out
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
        toolCalls: pendingTools,
        sidechain: false,
        gitBranch: null, // codex logs don't record the branch
      })
      pendingTools = []
    }
  }

  return { events, stats: { files: 1, sessions: 1, events: events.length, skippedLines } }
}

/** Recursively parse every *.jsonl under a Codex sessions root. */
export function parseCodexDir(root: string): ParseResult {
  const events: UsageEvent[] = []
  let files = 0
  let skippedLines = 0
  const sessions = new Set<string>()

  for (const path of walkJsonl(root)) {
    files++
    const sessionId = basename(path, '.jsonl')
    sessions.add(sessionId)
    const r = parseCodexLines(readFileSync(path, 'utf8').split('\n'), sessionId)
    events.push(...r.events)
    skippedLines += r.stats.skippedLines
  }
  return { events, stats: { files, sessions: sessions.size, events: events.length, skippedLines } }
}
