// Monaco setup: only the editor core, C++ and JSON, with local workers.

import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/languages/definitions/cpp/register.js'
import 'monaco-editor/languages/features/json/register.js'
import 'monaco-editor/features/register.all.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'

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

export function languageFor(path: string): string {
  const p = path.toLowerCase()
  if (/\.(cpp|cc|cxx|hpp|hh|hxx|h|c|ipp|tpp)$/.test(p)) return 'cpp'
  if (p.endsWith('.json') || p.endsWith('.abi')) return 'json'
  return 'plaintext'
}

export { monaco }
