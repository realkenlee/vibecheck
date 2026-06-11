import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { VERSION } from '../src/version.js'

describe('version', () => {
  it('matches package.json (VERSION is hardcoded for binary builds)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(VERSION).toBe(pkg.version)
  })
})
