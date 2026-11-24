import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const built = vi.hoisted(() => ({ template: [] as unknown[] }))
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (t: unknown[]) => {
      built.template = t
      return {}
    }
  }
}))

import { buildMenu } from '../../src/main/menu'
import { APP_KEYS, EDITOR_KEYS, MONACO_DEFAULTS_REMOVED, normalizeKey } from '../../src/shared/keys'
import { MENU_MODEL, type MenuModelItem } from '../../src/shared/menu-model'

interface Item {
  label?: string
  accelerator?: string
  registerAccelerator?: boolean
  submenu?: Item[]
}

function menuItems(): Item[] {
  buildMenu(
    () => null,
    () => undefined,
    () => undefined
  )
  const out: Item[] = []
  const walk = (list: Item[]): void => {
    for (const i of list) {
      if (i.submenu) walk(i.submenu)
      else out.push(i)
    }
  }
  walk(built.template as Item[])
  return out
}

// ---- Monaco's default bindings, read from its own source ------------------

const MOD: Record<string, string> = { CtrlCmd: 'Ctrl', Shift: 'Shift', Alt: 'Alt' }

function keyName(code: string): string {
  const map: Record<string, string> = { Comma: ',', Period: '.', Minus: '-', Equal: '=', Backquote: '`' }
  if (map[code]) return map[code]
  const m = /^(?:Key|Digit)(.)$/.exec(code)
  return m ? m[1] : code
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) sourceFiles(p, out)
    else if (f.endsWith('.js')) out.push(p)
  }
  return out
}

/** Every key combination written as `n /* KeyMod.X *\/ | n /* KeyCode.Y *\/` in Monaco's editor sources. */
function monacoDefaults(): Set<string> {
  const found = new Set<string>()
  const root = join(process.cwd(), 'node_modules', 'monaco-editor', 'esm', 'vs', 'editor')
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes('KeyCode.')) continue
    for (const line of text.split('\n')) {
      if (!/\b(primary|secondary|win|linux|mac)\b/.test(line) && !line.includes('KeyCode.')) continue
      if (/\bmac\s*:/.test(line) || line.includes('KeyChord(')) continue
      for (const seg of line.split(',')) {
        const tokens = [...seg.matchAll(/\d+ \/\* (KeyMod|KeyCode)\.(\w+) \*\//g)]
        const codes = tokens.filter((t) => t[1] === 'KeyCode')
        if (codes.length !== 1) continue
        const mods = tokens.filter((t) => t[1] === 'KeyMod').map((t) => MOD[t[2]])
        if (mods.some((m) => m === undefined)) continue
        found.add(normalizeKey([...mods, keyName(codes[0][2])].join('+')))
      }
    }
  }
  return found
}

describe('key owners', () => {
  const normalizedEditor = EDITOR_KEYS.map(normalizeKey)
  const normalizedApp = APP_KEYS.map(normalizeKey)

  it('no key is in both lists', () => {
    expect(normalizedEditor.filter((k) => normalizedApp.includes(k))).toEqual([])
  })

  it('every menu accelerator is in exactly one list', () => {
    for (const i of menuItems()) {
      if (!i.accelerator) continue
      const k = normalizeKey(i.accelerator)
      const owners = Number(normalizedEditor.includes(k)) + Number(normalizedApp.includes(k))
      expect(owners, `${i.label} ${i.accelerator}`).toBe(1)
    }
  })

  it('the menu shows editor keys without registering them, and registers application keys', () => {
    for (const i of menuItems()) {
      if (!i.accelerator) continue
      const editorKey = normalizedEditor.includes(normalizeKey(i.accelerator))
      expect(i.registerAccelerator === false, `${i.label} ${i.accelerator}`).toBe(editorKey)
    }
  })

  it('every listed key is shown in the menu', () => {
    const shown = menuItems()
      .map((i) => i.accelerator)
      .filter((a): a is string => !!a)
      .map(normalizeKey)
    for (const k of [...normalizedEditor, ...normalizedApp]) expect(shown, k).toContain(k)
  })

  it('every accelerator of the shared menu model (also drawn in the title bar) is in exactly one list', () => {
    const keys: string[] = []
    const walk = (items: readonly MenuModelItem[]): void => {
      for (const i of items) {
        if (i.kind === 'command' && i.accelerator) keys.push(i.accelerator)
        if (i.kind === 'submenu') walk(i.items)
      }
    }
    for (const m of MENU_MODEL) walk(m.items)
    expect(keys.length).toBe(EDITOR_KEYS.length + APP_KEYS.length)
    for (const a of keys) {
      const k = normalizeKey(a)
      expect(Number(normalizedEditor.includes(k)) + Number(normalizedApp.includes(k)), a).toBe(1)
    }
  })

  it('Monaco binds every editor key by default', () => {
    const defaults = monacoDefaults()
    for (const k of normalizedEditor) expect(defaults.has(k), k).toBe(true)
  })

  it('every application key with a Monaco default binding is removed in the editor set-up', () => {
    const defaults = monacoDefaults()
    const conflicting = normalizedApp.filter((k) => defaults.has(k))
    expect(conflicting.sort()).toEqual(MONACO_DEFAULTS_REMOVED.map(normalizeKey).sort())
  })
})
