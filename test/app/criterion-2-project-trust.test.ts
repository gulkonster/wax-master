// Release criterion 2: opening a project runs nothing, and a project's own
// build command never runs without the main-process approval.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'wm-trust-'))
const answers: number[] = []
const shown: string[] = []

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => process.cwd() },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {
    showMessageBox: async (opts: { detail?: string }) => {
      shown.push(opts.detail ?? '')
      return { response: answers.shift() ?? 0 }
    }
  }
}))

const runs: { args: string[]; shell?: string }[] = []
vi.mock('../../src/main/toolchain', () => ({
  buildProject: async (_root: string, args: string[]) => {
    runs.push({ args })
    return { code: 0, output: '' }
  },
  buildProjectShell: async (_root: string, cmd: string) => {
    runs.push({ args: [], shell: cmd })
    return { code: 0, output: '' }
  },
  fromWslPath: () => null,
  toolchainForProject: () => ({ id: 'wax-cdt-4.1.1wax01', fallback: false })
}))

import { runBuild } from '../../src/main/build'
import { createProject, openProject } from '../../src/main/projects'

const sender = { isDestroyed: () => false, send: () => undefined } as never

function copiedProject(cmd: string): string {
  const root = mkdtempSync(join(tmpdir(), 'wm-proj-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'evil.cpp'), '')
  writeFileSync(join(root, 'waxmaster.json'), JSON.stringify({ main: 'src/evil.cpp', contract: 'evil', buildCommand: cmd }))
  return root
}

beforeEach(() => {
  runs.length = 0
  shown.length = 0
  answers.length = 0
})

describe('project trust', () => {
  it('opening a project starts nothing', () => {
    openProject(copiedProject('touch /tmp/pwned'))
    expect(runs).toHaveLength(0)
  })

  it('a custom command is shown and does not run when not approved', async () => {
    openProject(copiedProject('touch /tmp/pwned'))
    answers.push(0) // Cancel
    const r = await runBuild(sender)
    expect(r.needsApproval).toBe(true)
    expect(shown[0]).toContain('touch /tmp/pwned')
    expect(runs).toHaveLength(0)
  })

  it('an approved command runs and is remembered for the exact text only', async () => {
    const root = copiedProject('echo one')
    openProject(root)
    answers.push(1)
    await runBuild(sender)
    expect(runs.at(-1)?.shell).toBe('echo one')
    await runBuild(sender)
    expect(shown).toHaveLength(1)
    writeFileSync(join(root, 'waxmaster.json'), JSON.stringify({ main: 'src/evil.cpp', contract: 'evil', buildCommand: 'echo two' }))
    openProject(root)
    answers.push(0)
    await runBuild(sender)
    expect(shown).toHaveLength(2)
    expect(runs.filter((x) => x.shell === 'echo two')).toHaveLength(0)
  })

  it('a project created here gets no exemption', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'wm-new-'))
    const p = createProject('hello', 'mine', parent)
    writeFileSync(join(p.path, 'waxmaster.json'), JSON.stringify({ main: 'src/mine.cpp', contract: 'mine', buildCommand: 'echo sneaky' }))
    openProject(p.path)
    answers.push(0)
    await runBuild(sender)
    expect(shown).toHaveLength(1)
    expect(runs).toHaveLength(0)
  })

  it('the default command passes paths as ./ and never through a shell', async () => {
    openProject(copiedProject(''))
    await runBuild(sender)
    expect(runs[0].shell).toBeUndefined()
    expect(runs[0].args.slice(-3)).toEqual(['-o', './evil.wasm', 'src/evil.cpp'])
  })
})
