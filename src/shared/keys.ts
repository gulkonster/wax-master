// One owner per key. Editor keys belong to Monaco; the application menu shows
// them but does not register them. Application keys belong to the menu; a
// Monaco default binding on the same key is removed when the editor is created.
// Accelerators use Electron's spelling.

export const EDITOR_KEYS: readonly string[] = ['F12', 'Shift+F12', 'F2', 'Shift+Alt+F', 'CmdOrCtrl+F', 'CmdOrCtrl+H']

export const APP_KEYS: readonly string[] = [
  'CmdOrCtrl+Shift+N',
  'CmdOrCtrl+Shift+O',
  'CmdOrCtrl+N',
  'CmdOrCtrl+O',
  'CmdOrCtrl+S',
  'CmdOrCtrl+Shift+S',
  'CmdOrCtrl+Alt+S',
  'CmdOrCtrl+Shift+F',
  'CmdOrCtrl+T',
  'Alt+O',
  'CmdOrCtrl+B',
  'Ctrl+`',
  'CmdOrCtrl+,',
  'CmdOrCtrl+Shift+M',
  'CmdOrCtrl+Shift+P',
  'CmdOrCtrl+=',
  'CmdOrCtrl+-',
  'CmdOrCtrl+0'
]

/** Application keys on which Monaco has a default binding that is switched off. */
export const MONACO_DEFAULTS_REMOVED: readonly string[] = ['CmdOrCtrl+Shift+O']

export function isEditorKey(accelerator: string): boolean {
  return EDITOR_KEYS.includes(accelerator)
}

/** Canonical form for comparing keys: Ctrl for CmdOrCtrl, modifiers sorted. */
export function normalizeKey(accelerator: string): string {
  const parts = accelerator.replace(/CmdOrCtrl|CommandOrControl|Control/gi, 'Ctrl').split(/\+(?=.)/)
  const key = parts.pop() ?? ''
  const mods = parts.map((m) => m[0].toUpperCase() + m.slice(1).toLowerCase()).sort()
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+')
}
