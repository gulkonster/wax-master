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
  it('effects with an expression body return nothing or a clean-up function', () => {
    // React calls whatever an effect returns as its clean-up; a promise (scrollTo returns one
    // in current Chromium) or any other value throws there and empties the window. An effect
    // written as `() => expression` may only use one of these forms.
    const allowed = /^(\(\) => |void |on\(|on[A-Z]\w*Change\(|window\.wax\.on\(|s\.subscribe\(|watch[A-Z]\w*\(|set[A-Z]\w*\(|post\()/
    const bad: string[] = []
    for (const f of files(join(root, 'renderer'))) {
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(/use(?:Layout)?Effect\(\s*\(\)\s*=>\s*([^\s{][^\n]*)/g)) {
        if (!allowed.test(m[1])) bad.push(`${f}: ${m[1].trim()}`)
      }
    }
    expect(bad).toEqual([])
  })
  it('has no raw control characters or line or paragraph separators (written as escapes instead)', () => {
    // Tab, line feed and carriage return are ordinary text; anything else breaks the bundler or hides text.
    // eslint-disable-next-line no-control-regex
    const raw = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
    // Line and paragraph separators (code points 2028 and 2029 hex) end a line for the bundler.
    const separators = [0x2028, 0x2029].map((c) => String.fromCharCode(c))
    const hits = [...files(root), ...files(join(__dirname, '..'))].filter((f) => {
      const text = readFileSync(f, 'utf8')
      return raw.test(text) || separators.some((c) => text.includes(c))
    })
    expect(hits).toEqual([])
  })
})
