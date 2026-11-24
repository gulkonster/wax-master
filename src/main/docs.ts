// The documentation shipped with the app: read-only files in one folder
// (resources/docs in the installed app, docs/help in the source tree). The
// editor page reads them through one call that accepts only `index.json` and
// `<topic id>.md`, and only files that really lie in that folder.

import { app } from 'electron'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DOCS_INDEX_FILE, MAX_DOCS_INDEX_BYTES, MAX_DOCS_TOPIC_BYTES, isDocsFileName } from '../shared/docs'

export function docsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources', 'docs') : join(app.getAppPath(), 'docs', 'help')
}

const same = (a: string, b: string): boolean => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

/** Reads one documentation file from `dir`. Throws for any other name, a file outside the folder, or a file over its size limit. */
export function readDocsFile(dir: string, name: unknown): string {
  if (!isDocsFileName(name)) throw new Error('Unknown documentation file')
  const root = resolve(dir)
  const full = resolve(root, name)
  if (!same(dirname(full), root)) throw new Error('Unknown documentation file')
  let realRoot: string
  let real: string
  try {
    realRoot = realpathSync(root)
    real = realpathSync(full)
  } catch {
    throw new Error(`The documentation file ${name} is missing`)
  }
  // A link inside the folder that points elsewhere is refused.
  if (!same(dirname(real), realRoot)) throw new Error('Unknown documentation file')
  const st = statSync(real)
  if (!st.isFile()) throw new Error('Unknown documentation file')
  const limit = name === DOCS_INDEX_FILE ? MAX_DOCS_INDEX_BYTES : MAX_DOCS_TOPIC_BYTES
  if (st.size > limit) throw new Error(`The documentation file ${name} is larger than ${limit / 1024} KB`)
  const text = readFileSync(real, 'utf8')
  if (text.includes('\u0000')) throw new Error(`The documentation file ${name} is not text`)
  return text.replace(/^﻿/, '')
}
