// Application menu: File, Edit, View, Contract, Accounts, Network, Help, built
// from the shared menu model. The window hides its menu bar (the page draws the
// menus); this menu stays installed and owns the accelerators and Edit roles.
// Items send a command to the editor window; the window decides what it means.

import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/api'
import { isEditorKey } from '../shared/keys'
import { MENU_MODEL, itemLabel, type MenuModelItem, type VaultMenuState } from '../shared/menu-model'

export interface MenuNetwork {
  id: string
  name: string
  current: boolean
}

export function buildMenu(
  getWindow: () => BrowserWindow | null,
  openLink: (url: string) => void,
  quit: () => void,
  networks: MenuNetwork[] = [],
  selectNetwork: (id: string) => void = () => {},
  /** The vault item's label follows this state; the menu is rebuilt when the vault changes. */
  vault: VaultMenuState = 'unlocked'
): Menu {
  const send = (cmd: MenuCommand) => (): void => {
    getWindow()?.webContents.send('menu', cmd)
  }
  const convert = (i: MenuModelItem): MenuItemConstructorOptions => {
    switch (i.kind) {
      case 'command':
        return {
          label: itemLabel(i, vault),
          accelerator: i.accelerator,
          // Editor keys are handled by the editor itself; the menu only shows them.
          registerAccelerator: i.accelerator === undefined || !isEditorKey(i.accelerator),
          click: send(i.command)
        }
      case 'role':
        return { role: i.role }
      case 'link':
        return { label: i.label, click: () => openLink(i.url) }
      case 'exit':
        return { label: i.label, click: quit }
      case 'network-list':
        return {
          label: i.label,
          submenu: networks.map((n) => ({ label: n.name, type: 'radio' as const, checked: n.current, click: () => selectNetwork(n.id) }))
        }
      case 'submenu':
        return { label: i.label, submenu: i.items.map(convert) }
      case 'separator':
        return { type: 'separator' }
    }
  }
  const template: MenuItemConstructorOptions[] = MENU_MODEL.map((m) => ({ label: m.label, submenu: m.items.map(convert) }))
  return Menu.buildFromTemplate(template)
}

/** Key events as `before-input-event` reports them. */
export interface MenuKeyInput {
  type: string
  key: string
  alt: boolean
  control: boolean
  shift: boolean
  meta: boolean
  isAutoRepeat: boolean
}

/**
 * Menu-bar access from the keyboard: F10 without modifiers, or Alt pressed and
 * released with no other key in between. Returns a function that takes each key
 * event and tells whether the menu bar should take the focus now.
 */
export function menuKeyDetector(): (input: MenuKeyInput) => boolean {
  let altAlone = false
  return (input) => {
    if (input.type === 'keyDown') {
      if (input.isAutoRepeat) return false
      if (input.key === 'Alt') {
        altAlone = !input.control && !input.shift && !input.meta
        return false
      }
      altAlone = false
      return input.key === 'F10' && !input.alt && !input.control && !input.shift && !input.meta
    }
    if (input.type === 'keyUp' && input.key === 'Alt') {
      const tap = altAlone
      altAlone = false
      return tap
    }
    return false
  }
}

/** Sends the `focus-menu` command when the menu key is pressed in any frame of the window. */
export function watchMenuKey(win: BrowserWindow): void {
  const detect = menuKeyDetector()
  win.webContents.on('before-input-event', (_e, input) => {
    if (detect(input)) win.webContents.send('menu', 'focus-menu' satisfies MenuCommand)
  })
  // A key held while the window lost the focus must not count as a tap afterwards.
  win.on('blur', () => detect({ type: 'keyDown', key: '', alt: false, control: false, shift: false, meta: false, isAutoRepeat: false }))
}
