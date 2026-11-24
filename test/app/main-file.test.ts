import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'wm-main-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false, getAppPath: () => process.cwd() } }))

import { openProject, setMainFile } from '../../src/main/projects'

function folder(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'wm-mf-'))
  mkdirSync(join(root, 'src'))
  for (const f of files) writeFileSync(join(root, f), '')
  return root
}

describe('choosing the main file', () => {
  it('refuses a file whose name starts with "-" (it would read as a compiler option)', () => {
    openProject(folder(['src/-x.cpp']))
    expect(() => setMainFile('src/-x.cpp')).toThrow(/starts with "-"/)
  })

  it('accepts a normal file', () => {
    openProject(folder(['src/token.cpp']))
    expect(setMainFile('src/token.cpp').config.main).toBe('src/token.cpp')
  })
})
