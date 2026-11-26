import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const h = vi.hoisted(() => ({ data: '' }))
h.data = mkdtempSync(join(tmpdir(), 'wm-list-order-'))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => h.data, getAppPath: () => h.data, on: () => undefined }
}))

import { listProjects, setStar, upsertProject } from '../../src/main/store'

afterAll(() => rmSync(h.data, { recursive: true, force: true }))

describe('the project list (E62)', () => {
  it('keeps the order in which projects were added; opening or starring one does not move it', () => {
    const names = ['chickentoken', 'chickandtick', 'roostwellads', 'chickandland', 'chickandrich']
    names.forEach((name, i) => upsertProject({ path: join(h.data, name), name, lastOpened: 1000 + i }))
    expect(listProjects().map((p) => p.name)).toEqual(names)
    // Opened later, one after another, in another order.
    ;['chickandrich', 'chickentoken', 'roostwellads'].forEach((name, i) => upsertProject({ path: join(h.data, name), name, lastOpened: 5000 + i }))
    setStar(join(h.data, 'chickandland'), true)
    expect(listProjects().map((p) => p.name)).toEqual(names)
    // A new project goes at the end.
    upsertProject({ path: join(h.data, 'newone'), name: 'newone', lastOpened: 9000 })
    expect(listProjects().map((p) => p.name)).toEqual([...names, 'newone'])
  })
})
