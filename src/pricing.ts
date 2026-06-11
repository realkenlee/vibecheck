// $ per million tokens. Cache-read/write rates are absolute (not multipliers).
// Prices change — treat as estimates, override via `ratesOverride` if needed.

export interface Rate {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** When the list-price table below was last verified. Surfaced in CLI output so a stale binary discloses itself. */
export const PRICES_AS_OF = '2026-06'

const R = (input: number, output: number): Rate => ({
  input,
  output,
  cacheRead: input * 0.1, // standard cache-read discount
  cacheWrite: input * 1.25, // 5-min cache write premium
})

/** First matching pattern wins — order matters. */
export const PRICING: [RegExp, Rate][] = [
  // Anthropic — Opus 4.5+ repriced to $5/$25; earlier Opus was $15/$75
  [/^claude-opus-4-[5-9]/, R(5, 25)],
  [/^claude-opus/, R(15, 75)],
  [/^claude-sonnet/, R(3, 15)],
  [/^claude-haiku-4/, R(1, 5)],
  [/^claude-3-5-haiku/, R(0.8, 4)],
  [/^claude/, R(3, 15)], // unknown claude → sonnet rates
  // OpenAI — gpt-5 family (codex variants included); cached input is 10%
  [/^gpt-5/, { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }],
  [/^o[34]/, { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 }],
]

export function rateFor(model: string, ratesOverride?: [RegExp, Rate][]): Rate | null {
  for (const [re, rate] of [...(ratesOverride ?? []), ...PRICING]) {
    if (re.test(model)) return rate
  }
  return null
}

/** Cost of one event in dollars. Returns null for unknown models. */
export function eventCost(
  e: { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
  ratesOverride?: [RegExp, Rate][],
): number | null {
  const r = rateFor(e.model, ratesOverride)
  if (!r) return null
  return (
    (e.inputTokens * r.input +
      e.outputTokens * r.output +
      e.cacheReadTokens * r.cacheRead +
      e.cacheWriteTokens * r.cacheWrite) /
    1_000_000
  )
}

/** What the cache reads would have cost at the full input rate, minus what they did cost. */
export function cacheSavings(
  e: { model: string; cacheReadTokens: number },
  ratesOverride?: [RegExp, Rate][],
): number {
  const r = rateFor(e.model, ratesOverride)
  if (!r) return 0
  return (e.cacheReadTokens * (r.input - r.cacheRead)) / 1_000_000
}
