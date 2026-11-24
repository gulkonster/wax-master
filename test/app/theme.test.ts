import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DARK, LIGHT, THEMES } from '../../src/renderer/src/lib/theme-colors'
import { TITLEBAR_HEIGHT, WINDOW_COLORS, cleanDialogSizes, mergeDialogSizes, parseDialogSizesPatch, themeFromArgv } from '../../src/shared/theme'

const renderer = join(__dirname, '../../src/renderer/src')
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g
const DARK_BLOCK = /:root\s*\{[\s\S]*?\n\}/
const LIGHT_BLOCK = /:root\[data-theme='light'\]\s*\{[\s\S]*?\n\}/

function read(rel: string): string {
  return readFileSync(join(renderer, rel), 'utf8')
}

function block(css: string, re: RegExp): string {
  const m = re.exec(css)
  if (!m) throw new Error(`no block ${re}`)
  return m[0]
}

function parse(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of text.matchAll(/(--[\w-]+):\s*([^;]+);/g)) map.set(m[1], m[2].trim())
  return map
}

/** Tokens of the dark theme (`:root`). */
function darkTokens(): Map<string, string> {
  return parse(block(read('styles.css'), DARK_BLOCK))
}

/** Tokens the light block redefines. */
function lightOnly(): Map<string, string> {
  return parse(block(read('styles.css'), LIGHT_BLOCK))
}

/** Tokens in effect in the light theme: `:root` with the light block over it. */
function lightTokens(): Map<string, string> {
  return new Map([...darkTokens(), ...lightOnly()])
}

/** Both theme blocks removed: what is left must carry no colour and no size of its own. */
function outsideTokens(css: string): string {
  return css.replace(DARK_BLOCK, '').replace(LIGHT_BLOCK, '')
}

function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.(tsx?|css)$/.test(f)) out.push(p)
  }
  return out
}

// WCAG 2 contrast.
type Rgb = [number, number, number]
function rgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
}
function hexOf(c: Rgb): string {
  return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
}
/** A `rgba(r, g, b, a)` token over an opaque background. */
function over(rgba: string, bg: string): string {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(rgba)
  if (!m) throw new Error(`not rgba: ${rgba}`)
  const a = Number(m[4])
  const b = rgb(bg)
  return hexOf([0, 1, 2].map((i) => a * Number(m[i + 1]) + (1 - a) * b[i]) as Rgb)
}
function lum(hex: string): number {
  const c = rgb(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function ratio(a: string, b: string): number {
  return (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
}

describe('colour tokens', () => {
  it('styles.css has no colour value outside the two theme blocks', () => {
    const outside = outsideTokens(read('styles.css'))
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

  it('the dark tokens have the values of the design', () => {
    const t = darkTokens()
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
      '--info-text': '#75B6F5',
      '--on-fill': '#FFFFFF'
    }
    for (const [k, v] of Object.entries(expected)) expect(t.get(k), k).toBe(v)
  })

  it('the light tokens have the values of the light palette', () => {
    const t = lightTokens()
    const expected: Record<string, string> = {
      '--bg-chrome': '#F3F3F3',
      '--bg-content': '#FFFFFF',
      '--bg-surface': '#F7F7F7',
      '--bg-surface-2': '#EDEDED',
      '--bg-surface-3': '#E2E2E2',
      '--bg-flyout': '#FFFFFF',
      '--bg-inset': '#FAFAFA',
      '--hover': 'rgba(0, 0, 0, 0.05)',
      '--pressed': 'rgba(0, 0, 0, 0.08)',
      '--smoke': 'rgba(0, 0, 0, 0.35)',
      '--stripe': 'rgba(0, 0, 0, 0.02)',
      '--border': '#E0E0E0',
      '--border-control': '#C8C8C8',
      '--border-strong': '#7A7A7A',
      '--text': '#1F1F1F',
      '--text-strong': '#000000',
      '--text-2': '#4A4A4A',
      '--text-3': '#616161',
      '--text-disabled': '#A0A0A0',
      '--accent': '#DE8334',
      '--accent-hover': '#E8954C',
      '--accent-pressed': '#C97228',
      '--on-accent': '#1A1207',
      '--accent-text': '#A14F0C',
      '--sel-line': '#C2691C',
      '--accent-tint': 'rgba(222, 131, 52, 0.16)',
      '--accent-tint-hover': 'rgba(222, 131, 52, 0.24)',
      '--red-fill': '#C4302B',
      '--green-fill': '#2F7D46',
      '--info-fill': '#2B6CB0',
      '--on-fill': '#FFFFFF',
      '--red-text': '#B3261E',
      '--green-text': '#1B6E36',
      '--warn-text': '#7A5600',
      '--info-text': '#1A5A9E',
      '--red-tint': 'rgba(196, 48, 43, 0.10)',
      '--green-tint': 'rgba(47, 125, 70, 0.12)',
      '--warn-tint': 'rgba(232, 196, 90, 0.22)',
      '--info-tint': 'rgba(43, 108, 176, 0.10)',
      '--scroll-thumb': '#C1C1C1',
      '--scroll-thumb-hover': '#9E9E9E',
      '--shadow-flyout': '0 8px 16px rgba(0, 0, 0, 0.14)',
      '--shadow-dialog': '0 24px 48px rgba(0, 0, 0, 0.22)'
    }
    for (const [k, v] of Object.entries(expected)) expect(t.get(k), k).toBe(v)
  })

  it('the light block changes colours only: every name exists in :root and no size is redefined', () => {
    const dark = darkTokens()
    for (const [k, v] of lightOnly()) {
      expect(dark.has(k), k).toBe(true)
      expect(/^(--fs|--lh|--sp|--gap|--bw|--radius|--ctl|--dialog|--icon)/.test(k), k).toBe(false)
      if (!k.startsWith('--shadow')) expect(v, k).not.toMatch(/\dpx/)
    }
  })

  it('the light theme passes the contrast pairs of the light palette', () => {
    const t = lightTokens()
    const c = (name: string): string => t.get(name)!
    const sel = (bg: string): string => over(c('--accent-tint'), c(bg))
    const pairs: [string, string, string, number, number][] = [
      // [what, foreground, background, minimum, value stated in the specification]
      ['text on chrome', c('--text'), c('--bg-chrome'), 4.5, 14.85],
      ['text on content', c('--text'), c('--bg-content'), 4.5, 16.48],
      ['text on surface-3', c('--text'), c('--bg-surface-3'), 4.5, 12.72],
      ['text-2 on chrome', c('--text-2'), c('--bg-chrome'), 4.5, 7.99],
      ['text-2 on content', c('--text-2'), c('--bg-content'), 4.5, 8.86],
      ['text-2 on surface-3', c('--text-2'), c('--bg-surface-3'), 4.5, 6.84],
      ['text-3 on chrome', c('--text-3'), c('--bg-chrome'), 4.5, 5.58],
      ['text-3 on content', c('--text-3'), c('--bg-content'), 4.5, 6.19],
      ['text-3 on surface-3', c('--text-3'), c('--bg-surface-3'), 4.5, 4.78],
      ['accent-text on chrome', c('--accent-text'), c('--bg-chrome'), 4.5, 5.2],
      ['accent-text on content', c('--accent-text'), c('--bg-content'), 4.5, 5.77],
      ['accent-text on surface-2', c('--accent-text'), c('--bg-surface-2'), 4.5, 4.93],
      ['accent-text on a selected item over content', c('--accent-text'), sel('--bg-content'), 4.5, 4.95],
      ['accent-text on a selected item over chrome', c('--accent-text'), sel('--bg-chrome'), 4.5, 4.51],
      ['red text on content', c('--red-text'), c('--bg-content'), 4.5, 6.54],
      ['green text on content', c('--green-text'), c('--bg-content'), 4.5, 6.31],
      ['warning text on content', c('--warn-text'), c('--bg-content'), 4.5, 6.65],
      ['info text on content', c('--info-text'), c('--bg-content'), 4.5, 7.0],
      ['red text on its tint', c('--red-text'), over(c('--red-tint'), c('--bg-content')), 4.5, 5.6],
      ['green text on its tint', c('--green-text'), over(c('--green-tint'), c('--bg-content')), 4.5, 5.37],
      ['warning text on its tint', c('--warn-text'), over(c('--warn-tint'), c('--bg-content')), 4.5, 5.95],
      ['info text on its tint', c('--info-text'), over(c('--info-tint'), c('--bg-content')), 4.5, 6.1],
      ['strong border on content (control edge)', c('--border-strong'), c('--bg-content'), 3, 4.29],
      ['text on the accent fill', c('--on-accent'), c('--accent'), 4.5, 6.53]
    ]
    for (const [what, fg, bg, min, stated] of pairs) {
      const r = ratio(fg, bg)
      expect(r, what).toBeGreaterThanOrEqual(min)
      expect(Math.abs(r - stated), `${what}: ${r.toFixed(2)} against ${stated}`).toBeLessThan(0.03)
    }
    // Indicator lines (3 : 1 rule for non-text) and the white text on the fills.
    expect(ratio(c('--sel-line'), c('--bg-content'))).toBeGreaterThanOrEqual(3)
    expect(ratio(c('--sel-line'), c('--bg-chrome'))).toBeGreaterThanOrEqual(3)
    for (const fill of ['--red-fill', '--green-fill', '--info-fill']) expect(ratio(c('--on-fill'), c(fill)), fill).toBeGreaterThanOrEqual(4.5)
    // The selected item over surface-3 is not allowed for orange text (below 4.5).
    expect(ratio(c('--accent-text'), c('--bg-surface-3'))).toBeLessThan(4.5)
  })

  it('the editor and terminal theme colours mirror the tokens they name, for both themes', () => {
    const file = read('lib/theme-colors.ts')
    const objects: [string, Record<string, string>, Map<string, string>][] = [
      ['DARK', DARK as unknown as Record<string, string>, darkTokens()],
      ['LIGHT', LIGHT as unknown as Record<string, string>, lightTokens()]
    ]
    for (const [name, obj, t] of objects) {
      const start = file.indexOf(`export const ${name}: ThemeColors = {`)
      const body = file.slice(start, file.indexOf('\n}', start))
      let checked = 0
      for (const m of body.matchAll(/\/\*\* (--[\w-]+) \*\/\s*\n\s*(\w+):\s*'(#[0-9A-Fa-f]+)'/g)) {
        expect(t.get(m[1]), `${name} ${m[1]}`).toBe(m[3])
        expect(obj[m[2]], `${name} ${m[2]}`).toBe(m[3])
        checked++
      }
      expect(checked, name).toBeGreaterThanOrEqual(10)
    }
    expect(THEMES.dark).toBe(DARK)
    expect(THEMES.light).toBe(LIGHT)
    expect(Object.keys(LIGHT).sort()).toEqual(Object.keys(DARK).sort())
  })

  it('editor comments and line numbers keep 4.5 : 1 on the content background in both themes', () => {
    for (const c of [DARK, LIGHT]) {
      expect(ratio(c.comment, c.content)).toBeGreaterThanOrEqual(4.5)
      expect(ratio(c.lineNumber, c.content)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('the windows paint the background of their theme before the page does', () => {
    const tokens = { dark: darkTokens(), light: lightTokens() }
    for (const theme of ['dark', 'light'] as const) {
      const w = WINDOW_COLORS[theme]
      expect(w.chrome, theme).toBe(tokens[theme].get('--bg-chrome'))
      expect(w.content, theme).toBe(tokens[theme].get('--bg-content'))
      expect(w.text, theme).toBe(tokens[theme].get('--text'))
    }
    expect(`${TITLEBAR_HEIGHT}px`).toBe(darkTokens().get('--titlebar'))
    // No page carries a fixed first-paint colour: the window background (per theme) shows until the styles load.
    for (const f of ['index.html', 'confirm.html', 'terminal.html']) {
      expect(readFileSync(join(renderer, '..', f), 'utf8'), f).not.toMatch(HEX)
    }
    const mainSrc = (f: string): string => readFileSync(join(__dirname, '../../src/main', f), 'utf8')
    expect(mainSrc('index.ts')).toContain("backgroundColor: windowBackground('chrome')")
    expect(mainSrc('index.ts')).toContain('titleBarOverlay: titleBarOverlay()')
    expect(mainSrc('index.ts')).toContain('themeArgs()')
    for (const f of ['confirm-window.ts', 'keys-service.ts']) {
      expect(mainSrc(f), f).toContain("backgroundColor: windowBackground('content')")
      expect(mainSrc(f), f).toContain('themeArgs()')
      expect(mainSrc(f), f).toMatch(/followTheme\(win, 'content'\)/)
    }
    for (const f of ['index.ts', 'confirm-window.ts', 'keys-service.ts']) expect(mainSrc(f), f).not.toMatch(HEX)
  })

  it('both preloads apply only the two theme values to <html>', () => {
    for (const f of ['index.ts', 'confirm.ts']) {
      const src = readFileSync(join(__dirname, '../../src/preload', f), 'utf8')
      expect(src, f).toContain("if (theme !== 'dark' && theme !== 'light') return")
      expect(src, f).toContain("setAttribute('data-theme', theme)")
      expect(src, f).toContain("ipcRenderer.on('theme',")
    }
  })

  it('the mainnet header of the confirmation window stays filled red with white text', () => {
    const css = read('confirm/confirm.css')
    expect(css).toMatch(/\.c-header\.mainnet \{[^}]*background: var\(--red-fill\);[^}]*color: var\(--on-fill\);/)
    expect(css).toMatch(/\.c-header\.mainnet \.c-title \{[^}]*color: var\(--on-fill\);/)
    // --on-fill and --red-fill are the same in both themes.
    expect(lightOnly().has('--on-fill')).toBe(false)
    expect(lightOnly().has('--red-fill')).toBe(false)
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

describe('size tokens', () => {
  it('the scale has the values of the size scale', () => {
    const t = darkTokens()
    const expected: Record<string, string> = {
      '--fs-body': '15px',
      '--lh-body': '22px',
      '--fs-caption': '13px',
      '--lh-caption': '18px',
      '--fs-small': '12px',
      '--lh-small': '16px',
      '--fs-page': '28px',
      '--lh-page': '36px',
      '--fs-project': '20px',
      '--lh-project': '26px',
      '--fs-section': '20px',
      '--lh-section': '28px',
      '--fs-card': '16px',
      '--lh-card': '24px',
      '--fs-dialog': '20px',
      '--lh-dialog': '28px',
      '--fs-mono': '14px',
      '--lh-mono': '22px',
      '--fs-data': '13px',
      '--lh-data': '20px',
      '--ctl': '32px',
      '--ctl-lg': '36px',
      '--btn-pad': '16px',
      '--btn-min': '88px',
      '--titlebar': '40px',
      '--topbar': '52px',
      '--tabstrip': '40px',
      '--panel-head': '36px',
      '--home-ctl': '40px',
      '--project-row': '76px',
      '--tree-row': '30px',
      '--menu-item': '36px',
      '--row': '44px',
      '--table-row': '36px',
      '--statusbar': '28px',
      '--sidebar': '300px',
      '--dialog-s': '560px',
      '--dialog-m': '760px',
      '--dialog-l': '980px',
      '--dialog-pad': '24px',
      '--dialog-min-w': '480px',
      '--dialog-min-h': '240px',
      '--grip': '16px',
      '--form-col': '880px',
      '--home-col': '1100px',
      '--icon': '18px',
      '--icon-lg': '20px',
      '--check': '18px',
      '--scrollbar': '14px',
      '--gap-row': '12px',
      '--gap-field': '16px',
      '--gap-group': '24px',
      '--gap-section': '32px'
    }
    for (const [k, v] of Object.entries(expected)) expect(t.get(k), k).toBe(v)
  })

  it('no stylesheet carries a pixel size outside :root', () => {
    for (const f of ['styles.css', 'confirm/confirm.css']) {
      const outside = outsideTokens(read(f))
      expect(outside.match(/\d+(\.\d+)?px/g) ?? [], f).toEqual([])
    }
  })

  it('no component sets a pixel size in an inline style', () => {
    const hits: string[] = []
    for (const f of sources(renderer)) {
      if (!f.endsWith('.tsx')) continue
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(/style=\{\{([^}]*)\}\}/g)) {
        if (/(fontSize|lineHeight|margin\w*|padding\w*|gap|width|height|top|left|right|bottom):\s*-?[1-9]\d*\b(?!%)/.test(m[1]) || /\dpx/.test(m[1])) hits.push(`${f}: ${m[1]}`)
      }
    }
    expect(hits).toEqual([])
  })
})

describe('theme and dialog size settings', () => {
  it('reads the theme from the start arguments; only exactly dark or light is taken, anything else is ignored', () => {
    expect(themeFromArgv(['x', '--wax-theme=light'])).toBe('light')
    expect(themeFromArgv(['--wax-theme=dark'])).toBe('dark')
    expect(themeFromArgv(['--wax-theme=light2'])).toBeNull()
    expect(themeFromArgv(['--wax-theme='])).toBeNull()
    expect(themeFromArgv([])).toBeNull()
  })

  it('accepts a dialog size change only in whole pixels within the limits', () => {
    expect(parseDialogSizesPatch({ deploy: { width: 980, height: 600 } })).toEqual({ deploy: { width: 980, height: 600 } })
    expect(parseDialogSizesPatch({ deploy: null })).toEqual({ deploy: null })
    expect(() => parseDialogSizesPatch({ deploy: { width: 479, height: 600 } })).toThrow()
    expect(() => parseDialogSizesPatch({ deploy: { width: 600, height: 239 } })).toThrow()
    expect(() => parseDialogSizesPatch({ deploy: { width: 9000, height: 600 } })).toThrow()
    expect(() => parseDialogSizesPatch({ '__proto__x': { width: 600, height: 600 } })).toThrow()
    expect(() => parseDialogSizesPatch([])).toThrow()
  })

  it('merges, forgets and caps the stored sizes; a malformed file entry is dropped', () => {
    const stored = { deploy: { width: 900, height: 600 } }
    expect(mergeDialogSizes(stored, { deploy: null })).toEqual({})
    expect(mergeDialogSizes(stored, { 'new-project': { width: 800, height: 500 } })).toEqual({ ...stored, 'new-project': { width: 800, height: 500 } })
    const many: Record<string, { width: number; height: number }> = {}
    for (let i = 0; i < 70; i++) many[`d${i}`] = { width: 600, height: 400 }
    expect(Object.keys(mergeDialogSizes(many, {})).length).toBe(64)
    expect(cleanDialogSizes({ deploy: { width: 900, height: 600 }, bad: { width: 'x', height: 1 }, 'Bad Name': { width: 900, height: 600 } })).toEqual({ deploy: { width: 900, height: 600 } })
    expect(cleanDialogSizes('text')).toEqual({})
  })
})
