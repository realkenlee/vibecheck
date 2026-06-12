import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseClaudeLines } from '../src/parsers/claude-code.js'
import { parseCodexLines } from '../src/parsers/codex.js'

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const lines = (f: string) => readFileSync(join(FIX, f), 'utf8').split('\n')

describe('claude-code parser', () => {
  const r = parseClaudeLines(lines('claude-code.jsonl'), 'fixture-session')

  it('dedupes streamed duplicate message ids (the double-count trap)', () => {
    // 6 assistant records with usage, but msg_dup appears twice and
    // <synthetic> is excluded -> 5 events
    expect(r.events).toHaveLength(5)
    const dup = r.events.filter((e) => e.inputTokens === 100)
    expect(dup).toHaveLength(1)
  })

  it('unions tool calls across duplicate lines', () => {
    const dup = r.events.find((e) => e.inputTokens === 100)!
    expect(dup.toolCalls).toEqual(['Bash', 'Read'])
  })

  it('extracts usage including cache fields', () => {
    const dup = r.events.find((e) => e.inputTokens === 100)!
    expect(dup.outputTokens).toBe(50)
    expect(dup.cacheReadTokens).toBe(2000)
    expect(dup.cacheWriteTokens).toBe(300)
    expect(dup.model).toBe('claude-sonnet-4-6')
  })

  it('derives project from cwd basename', () => {
    expect(r.events[0].project).toBe('acme-app')
  })

  it('marks sidechain (subagent) events', () => {
    const side = r.events.find((e) => e.sidechain)
    expect(side).toBeDefined()
    expect(side!.project).toBe('side-project')
  })

  it('skips synthetic error records', () => {
    expect(r.events.some((e) => e.model === '<synthetic>')).toBe(false)
  })

  it('counts unparseable lines as schema-drift canary', () => {
    expect(r.stats.skippedLines).toBe(1)
  })

  it('collects multiple tool calls in one message', () => {
    const multi = r.events.find((e) => e.model === 'claude-opus-4-8')!
    expect(multi.toolCalls).toEqual(['Read', 'Bash'])
  })

  it('attributes tool result bytes back to the calling turn', () => {
    // t1's tool_use only appears on the streamed DUPLICATE line — attribution
    // must work through the dedupe path
    const dup = r.events.find((e) => e.inputTokens === 100)!
    expect(dup.toolResultBytes).toBe('build ok'.length)
    // string content + text-block arrays are both summed; orphan results ignored
    const multi = r.events.find((e) => e.model === 'claude-opus-4-8')!
    expect(multi.toolResultBytes).toBe('aaaa'.length + 'bbbbbb'.length + 'command not found'.length)
  })

  it('counts errored tool results per turn', () => {
    expect(r.events.find((e) => e.model === 'claude-opus-4-8')!.toolErrors).toBe(1)
    expect(r.events.find((e) => e.inputTokens === 100)!.toolErrors).toBe(0)
  })

  it('records Read calls as FileReads with basename only, never the path', () => {
    // r4 (only on the streamed-duplicate line), r1, r2 — r3 and t2 have no
    // file_path and are ignored
    expect(r.fileReads).toHaveLength(3)
    for (const fr of r.fileReads!) {
      expect(fr.file).toBe('main.py')
      expect(fr.file).not.toContain('/')
      expect(fr.sessionId).toBe('fixture-session')
    }
  })

  it('attributes result bytes to each FileRead (0 when no result arrived)', () => {
    const bytes = r.fileReads!.map((fr) => fr.bytes).sort((a, b) => a - b)
    // r4 got no tool_result; r1 and r2 each returned "def main():\n    pass"
    expect(bytes).toEqual([0, 'def main():\n    pass'.length, 'def main():\n    pass'.length])
  })

  it('extracts compact_boundary records with their token receipts', () => {
    expect(r.compactions).toHaveLength(1)
    const c = r.compactions![0]
    expect(c.trigger).toBe('auto')
    expect(c.preTokens).toBe(160_000)
    expect(c.postTokens).toBe(12_000)
    expect(c.sessionId).toBe('fixture-session')
  })

  it('extracts gitBranch when present, null otherwise', () => {
    expect(r.events.find((e) => e.inputTokens === 100)!.gitBranch).toBe('main')
    expect(r.events.find((e) => e.model === 'claude-opus-4-8')!.gitBranch).toBe('feat/q2-migration')
    expect(r.events.find((e) => e.sidechain)!.gitBranch).toBeNull()
  })
})

describe('codex parser', () => {
  const r = parseCodexLines(lines('codex.jsonl'), 'fixture-session')

  it('emits one event per token_count with info, skipping null-info heartbeats', () => {
    expect(r.events).toHaveLength(2)
  })

  it('splits cached tokens out of input_tokens', () => {
    const e = r.events[0]
    expect(e.inputTokens).toBe(4000) // 10000 - 6000 cached
    expect(e.cacheReadTokens).toBe(6000)
    expect(e.outputTokens).toBe(200)
  })

  it('uses last_token_usage (per-response), not cumulative totals', () => {
    const e = r.events[1]
    expect(e.inputTokens).toBe(1000)
    expect(e.outputTokens).toBe(100)
  })

  it('tracks model and cwd from turn_context', () => {
    expect(r.events[0].model).toBe('gpt-5.3-codex')
    expect(r.events[0].project).toBe('acme-app')
    expect(r.events[1].model).toBe('gpt-5.3-codex-mini')
    expect(r.events[1].project).toBe('other-repo')
  })

  it('attributes tool calls to the next token_count', () => {
    expect(r.events[0].toolCalls).toEqual(['shell', 'apply_patch'])
    expect(r.events[1].toolCalls).toEqual([])
  })

  it('counts unparseable lines', () => {
    expect(r.stats.skippedLines).toBe(1)
  })
})
