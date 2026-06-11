// Normalized event schema — every agent parser emits these.

export type Agent = 'claude-code' | 'codex'

/** One billable API response from an agent session. */
export interface UsageEvent {
  agent: Agent
  sessionId: string
  /** Project identifier — basename of the working directory. */
  project: string
  /** ISO 8601 */
  timestamp: string
  model: string
  /** Uncached input tokens. */
  inputTokens: number
  outputTokens: number
  /** Tokens read from prompt cache (cheap). */
  cacheReadTokens: number
  /** Tokens written to prompt cache (Claude only). */
  cacheWriteTokens: number
  /** Tool names invoked in this response. */
  toolCalls: string[]
  /** True for subagent (sidechain) traffic. */
  sidechain: boolean
}

export interface ParseStats {
  files: number
  sessions: number
  events: number
  /** Lines that failed to parse — schema drift canary. */
  skippedLines: number
}

export interface ParseResult {
  events: UsageEvent[]
  stats: ParseStats
}
