// Monaco setup: only the editor core, C++ and JSON, with local workers.

import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/languages/definitions/cpp/register.js'
import 'monaco-editor/languages/features/json/register.js'
import 'monaco-editor/features/register.all.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import { MONACO_DEFAULTS_REMOVED, normalizeKey } from '../../../shared/keys'

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker(id: string, label: string): Worker }
  }
}

self.MonacoEnvironment = {
  getWorker(_id: string, label: string): Worker {
    if (label === 'json') return new JsonWorker()
    return new EditorWorker()
  }
}

monaco.editor.defineTheme('wax-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1e1f21',
    'editorGutter.background': '#1e1f21',
    'minimap.background': '#1e1f21'
  }
})

/** Monaco key code of the last part of an accelerator, e.g. 'O', 'F12', ','. */
function keyCodeOf(key: string): number | undefined {
  const K = monaco.KeyCode
  if (/^[A-Z]$/.test(key)) return K[('Key' + key) as keyof typeof K] as number
  if (/^[0-9]$/.test(key)) return K[('Digit' + key) as keyof typeof K] as number
  if (/^F([1-9]|1[0-9])$/.test(key)) return K[key as keyof typeof K] as number
  const punctuation: Record<string, number> = { ',': K.Comma, '.': K.Period, '-': K.Minus, '=': K.Equal, '`': K.Backquote }
  return punctuation[key]
}

/** Monaco keybinding number for an Electron accelerator (Ctrl on Windows and Linux). */
export function keybindingOf(accelerator: string): number | undefined {
  const parts = normalizeKey(accelerator).split(/\+(?=.)/)
  const code = keyCodeOf(parts.pop() ?? '')
  if (code === undefined) return undefined
  let mods = 0
  for (const m of parts) {
    if (m === 'Ctrl') mods |= monaco.KeyMod.CtrlCmd
    else if (m === 'Shift') mods |= monaco.KeyMod.Shift
    else if (m === 'Alt') mods |= monaco.KeyMod.Alt
    else return undefined
  }
  return mods | code
}

// Application keys belong to the menu. Where Monaco has a default binding on
// one of them, the binding is switched off for every editor.
for (const accelerator of MONACO_DEFAULTS_REMOVED) {
  const keybinding = keybindingOf(accelerator)
  if (keybinding !== undefined) monaco.editor.addKeybindingRule({ keybinding, command: null })
}

export function languageFor(path: string): string {
  const p = path.toLowerCase()
  if (/\.(cpp|cc|cxx|hpp|hh|hxx|h|c|ipp|tpp)$/.test(p)) return 'cpp'
  if (p.endsWith('.json') || p.endsWith('.abi')) return 'json'
  return 'plaintext'
}

export { monaco }
