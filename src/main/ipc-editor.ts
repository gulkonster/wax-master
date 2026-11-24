// IPC for code intelligence: the editor engine channel, toolchain headers for
// read-only tabs, and Find in Files. Registered through the same checked
// `handle()` as every other call.

import { bool, int, obj, str } from '../shared/validate'
import { editorStatus, readToolchainFile, refreshEditor, sendToEditor, startEditor, stopEditor } from './clangd'
import { handle } from './ipc'
import { onProjectChange } from './projects'
import { searchProject } from './search'

const MAX_MESSAGE_CHARS = 16 * 1024 * 1024

export function registerEditorIpc(): void {
  onProjectChange((c) => {
    if (c === 'opened' || c === 'closed') stopEditor()
    else void refreshEditor()
  })

  handle('editor:start', (e) => startEditor(e.sender))
  handle('editor:status', () => editorStatus())
  handle('editor:send', (_e, session, message) => {
    const s = int(session, 'session', 0, Number.MAX_SAFE_INTEGER)
    const m = obj(message, 'message')
    // Structured clone already made a copy; measure it before doing anything else.
    if (JSON.stringify(m).length > MAX_MESSAGE_CHARS) throw new Error('message: too large')
    sendToEditor(s, m)
  })
  handle('editor:readToolchainFile', (_e, uri) => readToolchainFile(str(uri, 'uri', 1024)))
  handle('files:search', (_e, query, matchCase, wholeWord) =>
    searchProject(str(query, 'query', 500), bool(matchCase, 'matchCase'), bool(wholeWord, 'wholeWord'))
  )
}
