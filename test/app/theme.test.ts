import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEME } from '../../src/renderer/src/lib/theme-colors'

const renderer = join(__dirname, '../../src/renderer/src')
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g

function read(rel: string): string {
  return readFileSync(join(renderer, rel), 'utf8')
}

function rootBlock(css: string): string {
  const m = /:root\s*\{([\s\S]*?)\n\}/.exec(css)
  if (!m) throw new Error('no :root block')
  return m[1]
}

function tokens(): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of rootBlock(read('styles.css')).matchAll(/(--[\w-]+):\s*([^;]+);/g)) map.set(m[1], m[2].trim())
  return map
}

function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.(tsx?|css)$/.test(f)) out.push(p)
  }
  return out
}

describe('colour tokens', () => {
  it('styles.css has no colour value outside :root', () => {
    const css = read('styles.css')
    const outside = css.replace(/:root\s*\{[\s\S]*?\n\}/, '')
    expect(outside.match(HEX) ?? []).toEqual([])
    expect(outside).not.toMatch(/rgba?\(/)
  })

  it('no component, the terminal page or the confirmation window carries a colour of its own', () => {
    const hits: string[] = []
    for (const f of sources(renderer)) {
      if (f.endsWith('styles.css') || f.endsWith('theme-colors.ts')) continue
      const text = readFileSync(f, 'utf8')
      for (const m of text.match(HEX) ?? []) hits.push(`${f}: ${m}`)
    }
    expect(hits).toEqual([])
  })

  it('the tokens have the values of the design', () => {
    const t = tokens()
    const expected: Record<string, string> = {
      '--bg-chrome': '#181818',
      '--bg-content': '#1F1F1F',
      '--bg-surface': '#262626',
      '--bg-surface-2': '#2D2D2D',
      '--bg-surface-3': '#383838',
      '--bg-flyout': '#2B2B2B',
      '--bg-inset': '#161616',
      '--border': '#303030',
      '--border-control': '#404040',
      '--border-strong': '#7A7A7A',
      '--text': '#E4E4E4',
      '--text-strong': '#FFFFFF',
      '--text-2': '#BDBDBD',
      '--text-3': '#9C9C9C',
      '--text-disabled': '#6E6E6E',
      '--accent': '#DE8334',
      '--accent-hover': '#E8954C',
      '--accent-pressed': '#C97228',
      '--accent-text': '#EFA05C',
      '--on-accent': '#1A1207',
      '--red-fill': '#C4302B',
      '--red-text': '#FF8F87',
      '--green-fill': '#2F7D46',
      '--green-text': '#6CCB82',
      '--warn-text': '#E8C45A',
      '--info-fill': '#2B6CB0',
      '--info-text': '#75B6F5'
    }
    for (const [k, v] of Object.entries(expected)) expect(t.get(k), k).toBe(v)
  })

  it('the editor and terminal theme colours mirror the tokens they name', () => {
    const t = tokens()
    const file = read('lib/theme-colors.ts')
    let checked = 0
    for (const m of file.matchAll(/\/\*\* (--[\w-]+) \*\/\s*\n\s*(\w+):\s*'(#[0-9A-Fa-f]+)'/g)) {
      expect(t.get(m[1]), m[1]).toBe(m[3])
      expect((THEME as Record<string, string>)[m[2]]).toBe(m[3])
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(9)
  })

  it('the first paint of each page and window has the background of its token', () => {
    const t = tokens()
    const html = (f: string): string => readFileSync(join(renderer, '..', f), 'utf8')
    expect(html('index.html')).toContain(`style="background-color: ${t.get('--bg-chrome')}"`)
    expect(html('confirm.html')).toContain(`style="background-color: ${t.get('--bg-content')}"`)
    expect(html('terminal.html')).toContain(`style="background-color: ${t.get('--bg-content')}"`)
    const main = readFileSync(join(__dirname, '../../src/main/index.ts'), 'utf8')
    expect(main).toContain(`backgroundColor: '${t.get('--bg-chrome')}'`)
    expect(main).toContain(`titleBarOverlay: { color: '${t.get('--bg-chrome')}', symbolColor: '${t.get('--text')}', height: 36 }`)
    for (const f of ['confirm-window.ts', 'keys-service.ts']) {
      expect(readFileSync(join(__dirname, '../../src/main', f), 'utf8')).toContain(`backgroundColor: '${t.get('--bg-content')}'`)
    }
  })

  it('only the weights 400 and 600 are used', () => {
    const weights = new Set<string>()
    for (const f of sources(renderer)) {
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(/font-?[wW]eight:\s*'?(\w+)/g)) weights.add(m[1])
    }
    expect([...weights].sort()).toEqual(['400', '600'])
  })

  it('no label is transformed to upper case', () => {
    for (const f of sources(renderer)) expect(readFileSync(f, 'utf8'), f).not.toMatch(/text-transform:\s*uppercase|textTransform/)
  })
})
