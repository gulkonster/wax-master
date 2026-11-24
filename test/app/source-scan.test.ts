import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) files(p, out)
    else if (/\.(ts|tsx|js|jsx|html)$/.test(name)) out.push(p)
  }
  return out
}

describe('source scan', () => {
  const root = join(__dirname, '../../src')
  const banned: [string, RegExp][] = [
    ['innerHTML', /innerHTML/],
    ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
    ['eval(', /(^|[^\w.])eval\s*\(/],
    ['new Function', /new\s+Function\b/]
  ]
  for (const [label, re] of banned) {
    it(`has no ${label}`, () => {
      const hits = files(root).filter((f) => re.test(readFileSync(f, 'utf8')))
      expect(hits).toEqual([])
    })
  }
})
