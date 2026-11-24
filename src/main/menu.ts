// Application menu: File, Edit, View, Contract, Accounts, Network, Help.
// Items send a command to the editor window; the window decides what it means.

import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/api'

const REPO = 'https://github.com/gulkonster/wax-master'

export function buildMenu(
  getWindow: () => BrowserWindow | null,
  openLink: (url: string) => void,
  quit: () => void
): Menu {
  const send = (cmd: MenuCommand) => (): void => {
    getWindow()?.webContents.send('menu', cmd)
  }
  const item = (label: string, cmd: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: send(cmd)
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        item('New Project...', 'new-project', 'CmdOrCtrl+Shift+N'),
        item('Open Project...', 'open-project', 'CmdOrCtrl+Shift+O'),
        {
          label: 'New from Template',
          submenu: [item('Empty', 'template-empty'), item('Hello World', 'template-hello'), item('Token', 'template-token')]
        },
        { type: 'separator' },
        item('New File', 'new-file', 'CmdOrCtrl+N'),
        item('Open...', 'open-file', 'CmdOrCtrl+O'),
        { type: 'separator' },
        item('Save', 'save', 'CmdOrCtrl+S'),
        item('Save As...', 'save-as', 'CmdOrCtrl+Shift+S'),
        item('Save All', 'save-all', 'CmdOrCtrl+Alt+S'),
        { type: 'separator' },
        item('Home', 'home'),
        item('Settings', 'settings'),
        { type: 'separator' },
        { label: 'Exit', click: quit }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        item('Find', 'find', 'CmdOrCtrl+F'),
        item('Replace', 'replace', 'CmdOrCtrl+H'),
        item('Find in Files', 'find-in-files', 'CmdOrCtrl+Shift+F'),
        { type: 'separator' },
        item('Format Document', 'format', 'Shift+Alt+F'),
        item('Rename Symbol', 'rename-symbol', 'F2'),
        item('Go to Definition', 'go-to-definition', 'F12'),
        item('Find References', 'find-references', 'Shift+F12')
      ]
    },
    {
      label: 'View',
      submenu: [
        item('Show Command Palette', 'command-palette', 'CmdOrCtrl+Shift+P'),
        { type: 'separator' },
        item('Increase Font Size', 'font-increase', 'CmdOrCtrl+='),
        item('Decrease Font Size', 'font-decrease', 'CmdOrCtrl+-'),
        item('Reset Font Size', 'font-reset', 'CmdOrCtrl+0'),
        { type: 'separator' },
        item('Toggle Terminal', 'toggle-terminal', 'Ctrl+`'),
        item('Output', 'show-output'),
        item('Problems', 'show-problems', 'CmdOrCtrl+Shift+M'),
        item('Outline', 'show-outline')
      ]
    },
    {
      label: 'Contract',
      submenu: [
        item('Project Settings', 'project-settings', 'CmdOrCtrl+,'),
        { type: 'separator' },
        item('Build', 'build', 'CmdOrCtrl+B'),
        item('Deploy', 'deploy'),
        item('Deploy to Account...', 'deploy-to-account'),
        item('Simulate Deploy', 'simulate-deploy')
      ]
    },
    {
      label: 'Accounts',
      submenu: [
        item('Create Account...', 'create-account'),
        item('Create Testnet Account...', 'create-testnet-account'),
        { type: 'separator' },
        item('Manage Keypairs...', 'manage-keypairs'),
        item('Lock Vault', 'lock-vault'),
        { type: 'separator' },
        item('Clear Contract Code...', 'clear-code')
      ]
    },
    {
      label: 'Network',
      submenu: [
        item('Add Network...', 'add-network'),
        item('Manage Networks...', 'manage-networks'),
        { type: 'separator' },
        item('Open Transaction by Id...', 'open-transaction')
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Documentation', click: () => openLink(`${REPO}#readme`) },
        { label: 'Ask a Question', click: () => openLink(`${REPO}/discussions`) },
        { label: 'Report an Issue', click: () => openLink(`${REPO}/issues/new`) },
        { label: 'Request a Feature', click: () => openLink(`${REPO}/issues/new?labels=enhancement`) },
        { type: 'separator' },
        item('Setup', 'setup'),
        item('Check for Updates', 'check-updates'),
        { label: 'Verify This Download', click: () => openLink(`${REPO}#verify-your-download`) },
        { type: 'separator' },
        item('About WAX Master', 'about')
      ]
    }
  ]
  return Menu.buildFromTemplate(template)
}
