// The pictures of the documentation: the only map from a picture name and a
// theme to an address. The files of docs/help/img are taken into the page
// bundle when the app is built, so every address is a file of the app itself.
// Text of a help file never becomes an address: a page names a picture, and
// the name is looked up here.

import type { ResolvedTheme } from '../../../shared/api'
import { isPictureName } from '../../../shared/markdown'

const files = import.meta.glob<string>('../../../../docs/help/img/*.png', { eager: true, query: '?url', import: 'default' })

const FILE = /^(.+)-(dark|light)\.png$/

const map = new Map<string, Partial<Record<ResolvedTheme, string>>>()
for (const [path, url] of Object.entries(files)) {
  const m = FILE.exec(path.slice(path.lastIndexOf('/') + 1))
  // A file outside the name rule is left out.
  if (!m || !isPictureName(m[1]) || typeof url !== 'string') continue
  const entry = map.get(m[1]) ?? {}
  entry[m[2] as ResolvedTheme] = url
  map.set(m[1], entry)
}

/** The address of a picture in a theme, or null when the app holds no such file. */
export function pictureUrl(name: string, theme: ResolvedTheme): string | null {
  return map.get(name)?.[theme] ?? null
}

/** The names that have a file in both themes, sorted. */
export function pictureNames(): string[] {
  return [...map.entries()]
    .filter(([, e]) => e.dark !== undefined && e.light !== undefined)
    .map(([n]) => n)
    .sort()
}
