// The one notice shown when a folder opens and a value of waxmaster.json or .eosproj
// was not valid or not safe and was replaced by its default (or left out).

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_FILE, replacedConfigValues, replacedEosprojValues } from '../shared/project'
import { readJson } from './jsonfile'

export function openNotices(root: string): string[] {
  const cfg = join(root, PROJECT_FILE)
  if (existsSync(cfg)) {
    const names = replacedConfigValues(readJson<unknown>(cfg, {}))
    return names.length === 0 ? [] : [`${PROJECT_FILE}: ${names.join(', ')} not valid or not safe; the default is used instead.`]
  }
  const file = join(root, '.eosproj')
  try {
    if (!existsSync(file) || statSync(file).size > 64 * 1024) return []
    const names = replacedEosprojValues(JSON.parse(readFileSync(file, 'utf8')))
    return names.length === 0 ? [] : [`.eosproj: ${names.join(', ')} not valid or not safe; left out.`]
  } catch {
    return []
  }
}
