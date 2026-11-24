import { readFileSync } from 'node:fs'
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

import { buildMenu, menuKeyDetector, type MenuKeyInput } from '../../src/main/menu'
import { MENU_MODEL, VAULT_ITEM_LABELS, itemLabel, shortcutText, vaultMenuState, type MenuModelItem } from '../../src/shared/menu-model'

interface Item {
  label?: string
  role?: string
  type?: string
  accelerator?: string
  registerAccelerator?: boolean
  checked?: boolean
  submenu?: Item[]
  click?: () => void
}

function template(networks = [{ id: 'wax-testnet', name: 'WAX Testnet', current: true }]): {
  items: Item[]
  sent: string[]
  links: string[]
  quits: number
  selected: string[]
} {
  const sent: string[] = []
  const links: string[] = []
  const selected: string[] = []
  let quits = 0
  const win = { webContents: { send: (_ch: string, cmd: string) => sent.push(cmd) } }
  buildMenu(
    () => win as never,
    (url) => links.push(url),
    () => quits++,
    networks,
    (id) => selected.push(id)
  )
  return {
    items: built.template as Item[],
    sent,
    links,
    get quits() {
      return quits
    },
    selected
  }
}

/** One line per entry: menu path, label or role, accelerator. */
function describeTemplate(items: Item[], path = ''): string[] {
  const out: string[] = []
  for (const i of items) {
    if (i.type === 'separator') out.push(`${path}---`)
    else if (i.role) out.push(`${path}role:${i.role}`)
    else {
      out.push(`${path}${i.label}${i.accelerator ? ` [${i.accelerator}]` : ''}`)
      if (i.submenu) out.push(...describeTemplate(i.submenu, `${path}${i.label} > `))
    }
  }
  return out
}

// The application menu as it was before the title bar was drawn by the page
// (labels, order and keys must not change).
const BEFORE = [
  'File',
  'File > New Project... [CmdOrCtrl+Shift+N]',
  'File > Open Project... [CmdOrCtrl+Shift+O]',
  'File > New from Template',
  'File > New from Template > Empty',
  'File > New from Template > Hello World',
  'File > New from Template > Token',
  'File > ---',
  'File > New File [CmdOrCtrl+N]',
  'File > Open... [CmdOrCtrl+O]',
  'File > ---',
  'File > Save [CmdOrCtrl+S]',
  'File > Save As... [CmdOrCtrl+Shift+S]',
  'File > Save All [CmdOrCtrl+Alt+S]',
  'File > ---',
  'File > Home',
  'File > Settings',
  'File > ---',
  'File > Exit',
  'Edit',
  'Edit > role:undo',
  'Edit > role:redo',
  'Edit > ---',
  'Edit > role:cut',
  'Edit > role:copy',
  'Edit > role:paste',
  'Edit > role:delete',
  'Edit > role:selectAll',
  'Edit > ---',
  'Edit > Find [CmdOrCtrl+F]',
  'Edit > Replace [CmdOrCtrl+H]',
  'Edit > Find in Files [CmdOrCtrl+Shift+F]',
  'Edit > ---',
  'Edit > Format Document [Shift+Alt+F]',
  'Edit > Rename Symbol [F2]',
  'Edit > Go to Definition [F12]',
  'Edit > Find References [Shift+F12]',
  'Edit > Go to Symbol in Workspace... [CmdOrCtrl+T]',
  'Edit > Switch Header/Source [Alt+O]',
  'View',
  'View > Show Command Palette [CmdOrCtrl+Shift+P]',
  'View > ---',
  'View > Increase Font Size [CmdOrCtrl+=]',
  'View > Decrease Font Size [CmdOrCtrl+-]',
  'View > Reset Font Size [CmdOrCtrl+0]',
  'View > ---',
  'View > Toggle Terminal [Ctrl+`]',
  'View > Output',
  'View > Problems [CmdOrCtrl+Shift+M]',
  'View > Outline',
  'Contract',
  'Contract > Project Settings [CmdOrCtrl+,]',
  'Contract > ---',
  'Contract > Build [CmdOrCtrl+B]',
  'Contract > Deploy',
  'Contract > Deploy to Account...',
  'Contract > Simulate Deploy',
  'Accounts',
  'Accounts > Create Account...',
  'Accounts > Create Testnet Account...',
  'Accounts > ---',
  'Accounts > Manage Keypairs...',
  'Accounts > Lock Vault',
  'Accounts > ---',
  'Accounts > Clear Contract Code...',
  'Network',
  'Network > Select Network',
  'Network > Select Network > WAX Testnet',
  'Network > ---',
  'Network > Add Network...',
  'Network > Manage Networks...',
  'Network > ---',
  'Network > Open Transaction by Id...',
  'Help',
  'Help > Documentation',
  'Help > Ask a Question',
  'Help > Report an Issue',
  'Help > Request a Feature',
  'Help > ---',
  'Help > Setup',
  'Help > Check for Updates',
  'Help > Verify This Download',
  'Help > ---',
  'Help > About WAX Master'
]

function walkModel(items: readonly MenuModelItem[], fn: (i: MenuModelItem) => void): void {
  for (const i of items) {
    fn(i)
    if (i.kind === 'submenu') walkModel(i.items, fn)
  }
}

describe('menu model (one source for the application menu and the drawn menu bar)', () => {
  it('the application menu built from the model has the same items, order and keys as before', () => {
    expect(describeTemplate(template().items)).toEqual(BEFORE)
  })

  it('the drawn menu bar shows the same menus, labels and keys as the application menu', () => {
    const t = template().items
    expect(MENU_MODEL.map((m) => m.label)).toEqual(t.map((i) => i.label))
    const fromModel: string[] = []
    const walk = (items: readonly MenuModelItem[], path: string): void => {
      for (const i of items) {
        if (i.kind === 'separator') fromModel.push(`${path}---`)
        else if (i.kind === 'role') fromModel.push(`${path}role:${i.role}`)
        else if (i.kind === 'command') fromModel.push(`${path}${i.label}${i.accelerator ? ` [${i.accelerator}]` : ''}`)
        else if (i.kind === 'network-list') fromModel.push(`${path}${i.label}`, `${path}${i.label} > WAX Testnet`)
        else if (i.kind === 'submenu') {
          fromModel.push(`${path}${i.label}`)
          walk(i.items, `${path}${i.label} > `)
        } else fromModel.push(`${path}${i.label}`)
      }
    }
    for (const m of MENU_MODEL) {
      fromModel.push(m.label)
      walk(m.items, `${m.label} > `)
    }
    expect(fromModel).toEqual(BEFORE)
  })

  it('every command item of the application menu sends the command named in the model', () => {
    const t = template()
    const byLabel = new Map<string, Item>()
    const index = (items: Item[]): void => {
      for (const i of items) {
        if (i.label) byLabel.set(i.label, i)
        if (i.submenu) index(i.submenu)
      }
    }
    index(t.items)
    let count = 0
    for (const m of MENU_MODEL) {
      walkModel(m.items, (i) => {
        if (i.kind !== 'command') return
        t.sent.length = 0
        byLabel.get(i.label)?.click?.()
        expect(t.sent, i.label).toEqual([i.command])
        count++
      })
    }
    expect(count).toBeGreaterThan(40)
  })

  it('links, Exit and network items call what they called before', () => {
    const t = template([
      { id: 'a', name: 'Net A', current: false },
      { id: 'b', name: 'Net B', current: true }
    ])
    const help = t.items.find((i) => i.label === 'Help')!.submenu!
    help.find((i) => i.label === 'Documentation')!.click!()
    help.find((i) => i.label === 'Verify This Download')!.click!()
    expect(t.links).toEqual(['https://github.com/gulkonster/wax-master#readme', 'https://github.com/gulkonster/wax-master#verify-your-download'])
    t.items.find((i) => i.label === 'File')!.submenu!.find((i) => i.label === 'Exit')!.click!()
    expect(t.quits).toBe(1)
    const select = t.items.find((i) => i.label === 'Network')!.submenu!.find((i) => i.label === 'Select Network')!.submenu!
    expect(select.map((i) => [i.label, i.type, i.checked])).toEqual([
      ['Net A', 'radio', false],
      ['Net B', 'radio', true]
    ])
    select[0].click!()
    expect(t.selected).toEqual(['a'])
    expect(t.sent).toEqual([])
  })

  it('the help links of the model are the fixed repository addresses', () => {
    const urls: string[] = []
    for (const m of MENU_MODEL) walkModel(m.items, (i) => i.kind === 'link' && urls.push(i.url))
    expect(urls).toHaveLength(5)
    for (const u of urls) expect(u.startsWith('https://github.com/gulkonster/wax-master')).toBe(true)
  })

  it('shows Ctrl for CmdOrCtrl in drawn shortcuts', () => {
    expect(shortcutText('CmdOrCtrl+Shift+N')).toBe('Ctrl+Shift+N')
    expect(shortcutText('Ctrl+`')).toBe('Ctrl+`')
    expect(shortcutText('Shift+Alt+F')).toBe('Shift+Alt+F')
  })

  it('the drawn menu bar runs commands through the same function as the menu event', () => {
    const app = readFileSync(join(__dirname, '../../src/renderer/src/App.tsx'), 'utf8')
    expect(app).toContain(`window.wax.on('menu', runMenuCommand)`)
    expect(app).toContain('<TitleBar run={runMenuCommand} exit={() => void exitApp()} />')
  })
})

describe('Accounts menu: one vault item that follows the vault state', () => {
  const accounts = (vault: 'none' | 'locked' | 'unlocked'): Item[] => {
    buildMenu(() => null, () => undefined, () => undefined, [], () => undefined, vault)
    return (built.template as Item[]).find((i) => i.label === 'Accounts')!.submenu!
  }

  it('reads Create Vault..., Unlock Vault... or Lock Vault, with no accelerator, at the same place', () => {
    for (const [state, label] of [
      ['none', 'Create Vault...'],
      ['locked', 'Unlock Vault...'],
      ['unlocked', 'Lock Vault']
    ] as const) {
      const items = accounts(state)
      expect(items[4].label, state).toBe(label)
      expect(items[4].accelerator).toBeUndefined()
      expect(items.filter((i) => /Vault/.test(i.label ?? ''))).toHaveLength(1)
    }
  })

  it('every label sends the same command; the editor decides by the state', () => {
    const sent: string[] = []
    for (const state of ['none', 'locked', 'unlocked'] as const) {
      buildMenu(() => ({ webContents: { send: (_c: string, cmd: string) => sent.push(cmd) } }) as never, () => undefined, () => undefined, [], () => undefined, state)
      ;(built.template as Item[]).find((i) => i.label === 'Accounts')!.submenu![4].click!()
    }
    expect(sent).toEqual(['vault', 'vault', 'vault'])
  })

  it('the drawn menu uses the same labels and state rule', () => {
    const item = MENU_MODEL.find((m) => m.label === 'Accounts')!.items.find((i) => i.kind === 'command' && i.command === 'vault')!
    expect(itemLabel(item, vaultMenuState({ exists: false, unlocked: false }))).toBe(VAULT_ITEM_LABELS.none)
    expect(itemLabel(item, vaultMenuState({ exists: true, unlocked: false }))).toBe('Unlock Vault...')
    expect(itemLabel(item, vaultMenuState({ exists: true, unlocked: true }))).toBe('Lock Vault')
    const titleBar = readFileSync(join(__dirname, '../../src/renderer/src/components/TitleBar.tsx'), 'utf8')
    expect(titleBar).toContain('itemLabel(item, vaultState)')
    expect(titleBar).toContain('vaultMenuState(useStore(vaultStore))')
  })

  it('the main process rebuilds the menu when the vault changes', () => {
    const index = readFileSync(join(__dirname, '../../src/main/index.ts'), 'utf8')
    expect(index).toContain('vault().onChange(() => refreshMenu())')
  })
})

describe('menu-bar key (F10 or an Alt tap)', () => {
  const key = (type: 'keyDown' | 'keyUp', k: string, mods: Partial<MenuKeyInput> = {}): MenuKeyInput => ({
    type,
    key: k,
    alt: false,
    control: false,
    shift: false,
    meta: false,
    isAutoRepeat: false,
    ...mods
  })

  it('F10 without modifiers focuses the menu bar', () => {
    const d = menuKeyDetector()
    expect(d(key('keyDown', 'F10'))).toBe(true)
    expect(d(key('keyUp', 'F10'))).toBe(false)
    expect(d(key('keyDown', 'F10', { shift: true }))).toBe(false)
    expect(d(key('keyDown', 'F10', { control: true }))).toBe(false)
  })

  it('an Alt tap focuses the menu bar on release', () => {
    const d = menuKeyDetector()
    expect(d(key('keyDown', 'Alt', { alt: true }))).toBe(false)
    expect(d(key('keyDown', 'Alt', { alt: true, isAutoRepeat: true }))).toBe(false)
    expect(d(key('keyUp', 'Alt'))).toBe(true)
  })

  it('Alt with another key (Alt+O, Shift+Alt+F, Ctrl+Alt+S) is not a tap', () => {
    const d = menuKeyDetector()
    d(key('keyDown', 'Alt', { alt: true }))
    d(key('keyDown', 'o', { alt: true }))
    d(key('keyUp', 'o', { alt: true }))
    expect(d(key('keyUp', 'Alt'))).toBe(false)

    d(key('keyDown', 'Shift', { shift: true }))
    d(key('keyDown', 'Alt', { alt: true, shift: true }))
    d(key('keyDown', 'F', { alt: true, shift: true }))
    expect(d(key('keyUp', 'Alt', { shift: true }))).toBe(false)

    d(key('keyDown', 'Control', { control: true }))
    d(key('keyDown', 'Alt', { alt: true, control: true }))
    expect(d(key('keyUp', 'Alt', { control: true }))).toBe(false)
  })

  it('a release without its press does not count', () => {
    const d = menuKeyDetector()
    expect(d(key('keyUp', 'Alt'))).toBe(false)
  })
})
