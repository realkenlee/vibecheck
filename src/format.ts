// Tiny ANSI table/format helpers — zero dependencies.

const TTY = process.stdout.isTTY
export const bold = (s: string) => (TTY ? `\x1b[1m${s}\x1b[0m` : s)
export const dim = (s: string) => (TTY ? `\x1b[2m${s}\x1b[0m` : s)
export const green = (s: string) => (TTY ? `\x1b[32m${s}\x1b[0m` : s)
export const yellow = (s: string) => (TTY ? `\x1b[33m${s}\x1b[0m` : s)
export const cyan = (s: string) => (TTY ? `\x1b[36m${s}\x1b[0m` : s)

export function money(v: number): string {
  return v >= 100 ? `$${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`
}

export function tokens(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return String(v)
}

/** Right-pads/aligns columns. First column left-aligned, rest right-aligned. */
export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows
  const widths = all[0].map((_, i) => Math.max(...all.map((r) => strip(r[i]).length)))
  const fmt = (r: string[]) =>
    r
      .map((cell, i) => {
        const pad = widths[i] - strip(cell).length
        return i === 0 ? cell + ' '.repeat(pad) : ' '.repeat(pad) + cell
      })
      .join('  ')
  const lines = []
  if (header) {
    lines.push(dim(fmt(header)))
    lines.push(dim(widths.map((w) => '─'.repeat(w)).join('  ')))
  }
  for (const r of rows) lines.push(fmt(r))
  return lines.join('\n')
}

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

/** Unicode sparkline bar for a histogram. */
export function spark(values: number[]): string {
  const blocks = ' ▁▂▃▄▅▆▇█'
  const max = Math.max(...values, 1)
  return values.map((v) => blocks[Math.round((v / max) * 8)]).join('')
}
