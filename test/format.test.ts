import { describe, it, expect } from 'vitest'
import { money, monthLabel, tokens, spark } from '../src/format.js'

describe('format', () => {
  it('labels months by name — UTC, so boundary months never shift', () => {
    expect(monthLabel('2026-06')).toBe('June 2026')
    expect(monthLabel('2026-01')).toBe('January 2026')
    expect(monthLabel('2025-12')).toBe('December 2025')
  })

  it('formats money with cents under $100, whole dollars above', () => {
    expect(money(3.456)).toBe('$3.46')
    expect(money(1212)).toBe('$1,212')
  })

  it('humanizes token counts', () => {
    expect(tokens(482_000_000)).toBe('482.0M')
    expect(tokens(1_500)).toBe('1.5k')
    expect(tokens(12)).toBe('12')
  })

  it('sparklines scale to the histogram max', () => {
    const s = spark([0, 4, 8])
    expect(s).toHaveLength(3)
    expect(s[2]).toBe('█')
  })
})
