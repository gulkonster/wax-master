// The one description of the application menu. The main process builds the
// (hidden) Electron menu from it, which owns the accelerators; the editor page
// draws the menu bar in the title bar from it. Labels, order and keys come
// from here only, so the two cannot drift apart.

import type { MenuCommand } from './api'

export const REPO_URL = 'https://github.com/gulkonster/wax-master'

/** Edit roles handled by the system menu for the keyboard and by the page for the mouse. */
export type MenuRole = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll'

/** State of the key vault as the Accounts menu shows it. */
export type VaultMenuState = 'none' | 'locked' | 'unlocked'

/** The one state-dependent label of the menu: the vault item of the Accounts menu (no accelerator). */
export const VAULT_ITEM_LABELS: Readonly<Record<VaultMenuState, string>> = {
  none: 'Create Vault...',
  locked: 'Unlock Vault...',
  unlocked: 'Lock Vault'
}

export function vaultMenuState(s: { exists: boolean; unlocked: boolean }): VaultMenuState {
  return !s.exists ? 'none' : s.unlocked ? 'unlocked' : 'locked'
}

export type MenuModelItem =
  | {
      kind: 'command'
      label: string
      command: MenuCommand
      accelerator?: string
      /** Labels by vault state; `label` is the one for an unlocked vault. */
      vaultLabels?: Readonly<Record<VaultMenuState, string>>
    }
  | { kind: 'role'; label: string; role: MenuRole; shortcut?: string }
  | { kind: 'link'; label: string; url: string }
  | { kind: 'exit'; label: string }
  | { kind: 'network-list'; label: string }
  | { kind: 'submenu'; label: string; items: MenuModelItem[] }
  | { kind: 'separator' }

export interface MenuModelMenu {
  label: string
  items: MenuModelItem[]
}

const cmd = (label: string, command: MenuCommand, accelerator?: string): MenuModelItem =>
  accelerator === undefined ? { kind: 'command', label, command } : { kind: 'command', label, command, accelerator }
const role = (label: string, r: MenuRole, shortcut?: string): MenuModelItem =>
  shortcut === undefined ? { kind: 'role', label, role: r } : { kind: 'role', label, role: r, shortcut }
const link = (label: string, url: string): MenuModelItem => ({ kind: 'link', label, url })
const sep: MenuModelItem = { kind: 'separator' }

export const MENU_MODEL: readonly MenuModelMenu[] = [
  {
    label: 'File',
    items: [
      cmd('New Project...', 'new-project', 'CmdOrCtrl+Shift+N'),
      cmd('Open Project...', 'open-project', 'CmdOrCtrl+Shift+O'),
      {
        kind: 'submenu',
        label: 'New from Template',
        items: [cmd('Empty', 'template-empty'), cmd('Hello World', 'template-hello'), cmd('Token', 'template-token')]
      },
      sep,
      cmd('New File', 'new-file', 'CmdOrCtrl+N'),
      cmd('Open...', 'open-file', 'CmdOrCtrl+O'),
      sep,
      cmd('Save', 'save', 'CmdOrCtrl+S'),
      cmd('Save As...', 'save-as', 'CmdOrCtrl+Shift+S'),
      cmd('Save All', 'save-all', 'CmdOrCtrl+Alt+S'),
      sep,
      cmd('Home', 'home'),
      cmd('Settings', 'settings'),
      sep,
      { kind: 'exit', label: 'Exit' }
    ]
  },
  {
    label: 'Edit',
    items: [
      // Labels and shortcuts of Electron's own roles on Windows; the roles own these keys.
      role('Undo', 'undo', 'Ctrl+Z'),
      role('Redo', 'redo', 'Ctrl+Y'),
      sep,
      role('Cut', 'cut', 'Ctrl+X'),
      role('Copy', 'copy', 'Ctrl+C'),
      role('Paste', 'paste', 'Ctrl+V'),
      role('Delete', 'delete'),
      role('Select All', 'selectAll', 'Ctrl+A'),
      sep,
      cmd('Find', 'find', 'CmdOrCtrl+F'),
      cmd('Replace', 'replace', 'CmdOrCtrl+H'),
      cmd('Find in Files', 'find-in-files', 'CmdOrCtrl+Shift+F'),
      sep,
      cmd('Format Document', 'format', 'Shift+Alt+F'),
      cmd('Rename Symbol', 'rename-symbol', 'F2'),
      cmd('Go to Definition', 'go-to-definition', 'F12'),
      cmd('Find References', 'find-references', 'Shift+F12'),
      cmd('Go to Symbol in Workspace...', 'workspace-symbol', 'CmdOrCtrl+T'),
      cmd('Switch Header/Source', 'switch-header-source', 'Alt+O')
    ]
  },
  {
    label: 'View',
    items: [
      cmd('Show Command Palette', 'command-palette', 'CmdOrCtrl+Shift+P'),
      sep,
      cmd('Increase Font Size', 'font-increase', 'CmdOrCtrl+='),
      cmd('Decrease Font Size', 'font-decrease', 'CmdOrCtrl+-'),
      cmd('Reset Font Size', 'font-reset', 'CmdOrCtrl+0'),
      sep,
      cmd('Toggle Terminal', 'toggle-terminal', 'Ctrl+`'),
      cmd('Output', 'show-output'),
      cmd('Problems', 'show-problems', 'CmdOrCtrl+Shift+M'),
      cmd('Outline', 'show-outline')
    ]
  },
  {
    label: 'Contract',
    items: [
      cmd('Project Settings', 'project-settings', 'CmdOrCtrl+,'),
      sep,
      cmd('Build', 'build', 'CmdOrCtrl+B'),
      cmd('Deploy', 'deploy'),
      cmd('Deploy to Account...', 'deploy-to-account'),
      cmd('Simulate Deploy', 'simulate-deploy')
    ]
  },
  {
    label: 'Accounts',
    items: [
      cmd('Create Account...', 'create-account'),
      cmd('Create Testnet Account...', 'create-testnet-account'),
      sep,
      cmd('Manage Keypairs...', 'manage-keypairs'),
      { kind: 'command', label: VAULT_ITEM_LABELS.unlocked, command: 'vault', vaultLabels: VAULT_ITEM_LABELS },
      sep,
      cmd('Clear Contract Code...', 'clear-code')
    ]
  },
  {
    label: 'Network',
    items: [
      { kind: 'network-list', label: 'Select Network' },
      sep,
      cmd('Add Network...', 'add-network'),
      cmd('Manage Networks...', 'manage-networks'),
      cmd('Network Page', 'network-page'),
      sep,
      cmd('Open Transaction by Id...', 'open-transaction')
    ]
  },
  {
    label: 'Help',
    items: [
      link('Documentation', `${REPO_URL}#readme`),
      link('Ask a Question', `${REPO_URL}/discussions`),
      link('Report an Issue', `${REPO_URL}/issues/new`),
      link('Request a Feature', `${REPO_URL}/issues/new?labels=enhancement`),
      sep,
      cmd('Setup', 'setup'),
      cmd('Check for Updates', 'check-updates'),
      link('Verify This Download', `${REPO_URL}#verify-your-download`),
      sep,
      cmd('About WAX Master', 'about')
    ]
  }
]

/** Label of an item for the vault's state (only the vault item depends on it). */
export function itemLabel(item: MenuModelItem, vault: VaultMenuState): string {
  if (item.kind === 'separator') return ''
  if (item.kind === 'command' && item.vaultLabels) return item.vaultLabels[vault]
  return item.label
}

/** Shortcut text as shown in a drawn menu (Ctrl on Windows). */
export function shortcutText(accelerator: string): string {
  return accelerator.replace(/CmdOrCtrl|CommandOrControl/g, 'Ctrl')
}
