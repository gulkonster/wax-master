// Models for files the engine points at but that are not open in a tab:
// project files (for previews in "Find References" and "Peek") and the
// toolchain's read-only headers. Opening such a file in a tab adopts the model.

import { monaco, languageFor } from '../monaco'

/** Background models: uri -> alternative version id that matches the file on disk. */
const background = new Map<string, number>()
const loading = new Map<string, Promise<monaco.editor.ITextModel | null>>()

export function projectUri(rel: string): monaco.Uri {
  return monaco.Uri.parse(`project:///${rel.split('/').map(encodeURIComponent).join('/')}`)
}

/** project:///src/a.cpp -> src/a.cpp */
export function relOf(uri: monaco.Uri): string {
  return uri.path.replace(/^\//, '')
}

export function isToolchain(uri: monaco.Uri): boolean {
  return uri.scheme === 'toolchain'
}

/** Returns the model for a project file or toolchain header, loading it in the background if needed. */
export function ensureModel(uri: monaco.Uri): Promise<monaco.editor.ITextModel | null> {
  const existing = monaco.editor.getModel(uri)
  if (existing) return Promise.resolve(existing)
  if (uri.scheme !== 'project' && uri.scheme !== 'toolchain') return Promise.resolve(null)
  const key = uri.toString()
  const busy = loading.get(key)
  if (busy) return busy
  const p = (async (): Promise<monaco.editor.ITextModel | null> => {
    try {
      let text: string
      let lang: string
      if (uri.scheme === 'project') {
        const rel = relOf(uri)
        const f = await window.wax.files.read(rel)
        if (f.binary || f.tooLarge) return null
        text = f.content
        lang = languageFor(rel)
      } else {
        text = await window.wax.editor.readToolchainFile(key)
        lang = 'cpp'
      }
      const again = monaco.editor.getModel(uri)
      if (again) return again
      const model = monaco.editor.createModel(text, lang, uri)
      background.set(key, model.getAlternativeVersionId())
      return model
    } catch {
      return null
    } finally {
      loading.delete(key)
    }
  })()
  loading.set(key, p)
  return p
}

/** Ensures models for many locations (at most `limit` distinct files). */
export async function ensureModels(uris: monaco.Uri[], limit = 100): Promise<void> {
  const distinct = [...new Map(uris.map((u) => [u.toString(), u])).values()].slice(0, limit)
  await Promise.all(distinct.map((u) => ensureModel(u)))
}

/**
 * When a tab opens a file that already has a background model, the tab takes
 * it over. Returns the model and the version that matches the disk content.
 */
export function adoptModel(uri: monaco.Uri): { model: monaco.editor.ITextModel; savedVersion: number } | null {
  const key = uri.toString()
  const model = monaco.editor.getModel(uri)
  if (!model) return null
  const v = background.get(key)
  background.delete(key)
  return { model, savedVersion: v ?? model.getAlternativeVersionId() }
}

export function isBackground(uri: monaco.Uri): boolean {
  return background.has(uri.toString())
}

/** After a background model was changed to match a file written to disk. */
export function markBackgroundSaved(model: monaco.editor.ITextModel): void {
  if (background.has(model.uri.toString())) background.set(model.uri.toString(), model.getAlternativeVersionId())
}

monaco.editor.onWillDisposeModel((m) => background.delete(m.uri.toString()))

/** Disposes every background model (when the project closes). */
export function disposeBackgroundModels(): void {
  for (const key of [...background.keys()]) monaco.editor.getModel(monaco.Uri.parse(key))?.dispose()
  background.clear()
}
