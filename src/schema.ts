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
  /** Bytes of tool results returned for this turn's calls (optional — some parsers omit it). */
  toolResultBytes?: number
  /** Tool calls in this turn that failed — Claude Code's is_error flag, Codex's nonzero exit_code. */
  toolErrors?: number
  /** True for subagent (sidechain) traffic. */
  sidechain: boolean
  /** Git branch the session ran on (Claude Code records it; null when unknown). */
  gitBranch: string | null
}

/**
 * One Read-tool invocation (Claude Code only). `file` is the BASENAME only —
 * full paths never leave the parser, and these records are used solely by
 * local surfaces (report/doctor/web); `export` and `wrapped` never see them.
 */
export interface FileRead {
  sessionId: string
  /** ISO 8601 */
  timestamp: string
  /** Basename of the file read — never the full path. */
  file: string
  /** Bytes the read returned (0 if the result never arrived). */
  bytes: number
}

/**
 * A completed turn's measured duration (Claude Code `turn_duration` records).
 * Summed, these are agent runtime — parallel subagents each log their own
 * turns, so totals can exceed wall-clock time. Durations are plain numbers
 * and safe on every surface, including `wrapped`.
 */
export interface TurnDuration {
  sessionId: string
  /** ISO 8601 */
  timestamp: string
  ms: number
}

/** A context compaction recorded by the agent (Claude Code `compact_boundary`). */
export interface Compaction {
  sessionId: string
  /** ISO 8601 */
  timestamp: string
  /** "auto" = forced at the context ceiling; "manual" = user ran /compact. */
  trigger: string
  preTokens: number
  postTokens: number
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
  /** Compaction events, when the agent records them (Claude Code only). */
  compactions?: Compaction[]
  /** Read-tool invocations, when the agent records them (Claude Code only). */
  fileReads?: FileRead[]
  /** Per-turn durations, when the agent records them (Claude Code only). */
  turnDurations?: TurnDuration[]
}
