// Create Ricardian Files: sections from the ABI, appending only, the same file
// on a second run, and every path inside the project.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ dataDir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => h.dataDir, isPackaged: false, getAppPath: () => h.dataDir }, BrowserWindow: class {}, dialog: {} }))
import {
  actionsFromAbi,
  containedPath,
  contractSectionNames,
  createRicardianFiles,
  extendContracts,
  ricardianClauses,
  ricardianPaths,
  ricardianSection
} from '../../src/main/ricardian'
import { normalizeConfig } from '../../src/shared/project'
import { RICARDIAN_HINT, classifyLine, isRicardianWarning } from '../../src/shared/output-lines'
import { parseProblems } from '../../src/main/build'

const ABI = readFileSync(join(__dirname, '../fixtures/ricardian/hello.abi'), 'utf8')
const config = (extra: Record<string, unknown> = {}) => normalizeConfig({ contract: 'hello', main: 'src/hello.cpp', ...extra }, 'hello')

function project(extra: Record<string, unknown> = {}): { root: string; cfg: ReturnType<typeof config> } {
  const root = mkdtempSync(join(tmpdir(), 'wm-ric-'))
  const cfg = config(extra)
  writeFileSync(join(root, ricardianPaths(cfg).abi), ABI)
  return { root, cfg }
}

describe('sections from the ABI', () => {
  it('reads every action with its parameters, through aliases and base structs', () => {
    expect(actionsFromAbi(ABI)).toEqual([
      { name: 'hi', params: [{ name: 'user', type: 'name' }] },
      {
        name: 'move',
        params: [
          { name: 'from', type: 'name' },
          { name: 'to', type: 'name' },
          { name: 'quantity', type: 'asset' }
        ]
      },
      { name: 'ping', params: [] },
      {
        name: 'setmsg',
        params: [
          { name: 'user', type: 'name' },
          { name: 'msg', type: 'string' },
          { name: 'others', type: 'name[]' }
        ]
      }
    ])
  })

  it('writes the heading, the front block, the place for the text and the typed parameters', () => {
    expect(ricardianSection({ name: 'setmsg', params: [{ name: 'user', type: 'name' }, { name: 'others', type: 'name[]' }] })).toBe(
      [
        '<h1 class="contract">setmsg</h1>',
        '',
        '---',
        'spec_version: "0.2.0"',
        'title: "Setmsg"',
        "summary: 'TODO: one line about setmsg. Values: {{user}}, {{others}}'",
        '---',
        '',
        'TODO: say in plain words what the signer agrees to.',
        '',
        'Parameters:',
        '- user (name)',
        '- others (name[])',
        ''
      ].join('\n')
    )
    expect(ricardianSection({ name: 'ping', params: [] })).toContain("summary: 'TODO: one line about ping'\n")
    expect(ricardianSection({ name: 'ping', params: [] })).toContain('Parameters: none.\n')
    expect(ricardianSection({ name: 'ping', params: [] }, '\r\n')).not.toMatch(/[^\r]\n/)
    expect(ricardianClauses()).toMatch(/^<h1 class="clause">terms<\/h1>\n/)
  })

  it('writes both files into the resource folder and reports what it did', async () => {
    const { root, cfg } = project()
    const r = await createRicardianFiles(root, cfg)
    expect(r).toMatchObject({
      contractsFile: 'resource/hello.contracts.md',
      clausesFile: 'resource/hello.clauses.md',
      added: ['hi', 'move', 'ping', 'setmsg'],
      kept: [],
      clausesCreated: true,
      line: 1
    })
    expect(r.message).toBe('resource/hello.contracts.md: added 4, kept 0; resource/hello.clauses.md created.')
    const text = readFileSync(join(root, 'resource/hello.contracts.md'), 'utf8')
    expect([...contractSectionNames(text)]).toEqual(['hi', 'move', 'ping', 'setmsg'])
    expect(text).toContain("summary: 'TODO: one line about move. Values: {{from}}, {{to}}, {{quantity}}'")
    expect(readFileSync(join(root, 'resource/hello.clauses.md'), 'utf8')).toBe(ricardianClauses())
  })

  it('uses the resource and output folders of the project settings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wm-ric-'))
    const cfg = config({ resource: 'docs/ric', output: 'build/hello.wasm' })
    mkdirSync(join(root, 'build'))
    writeFileSync(join(root, 'build/hello.abi'), ABI)
    const r = await createRicardianFiles(root, cfg)
    expect(r.contractsFile).toBe('docs/ric/hello.contracts.md')
    expect(existsSync(join(root, 'docs/ric/hello.clauses.md'))).toBe(true)
  })

  it('asks for a build when there is no ABI', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wm-ric-'))
    await expect(createRicardianFiles(root, config())).rejects.toThrow(/hello\.abi was not found\. Build the contract first/)
    expect(existsSync(join(root, 'resource'))).toBe(false)
  })
})

describe('run twice: the same file', () => {
  it('adds nothing and changes no byte on the second run', async () => {
    const { root, cfg } = project()
    await createRicardianFiles(root, cfg)
    const first = readFileSync(join(root, 'resource/hello.contracts.md'))
    const clauses = readFileSync(join(root, 'resource/hello.clauses.md'))
    const r = await createRicardianFiles(root, cfg)
    expect(r.added).toEqual([])
    expect(r.kept).toEqual(['hi', 'move', 'ping', 'setmsg'])
    expect(r.clausesCreated).toBe(false)
    expect(r.message).toBe('resource/hello.contracts.md: added 0, kept 4.')
    expect(readFileSync(join(root, 'resource/hello.contracts.md')).equals(first)).toBe(true)
    expect(readFileSync(join(root, 'resource/hello.clauses.md')).equals(clauses)).toBe(true)
  })
})

describe('existing text is untouched', () => {
  const own = [
    '# My contract',
    '',
    '<h1 class="contract">setmsg</h1>',
    '',
    '---',
    'spec_version: "0.2.0"',
    'title: "Set a message"',
    "summary: '{{user}} sets a message'",
    '---',
    '',
    'My own words.',
    '',
    '<h1 class="contract">oldaction</h1>',
    'Text of an action the contract no longer has.'
  ].join('\r\n')

  it('appends only the missing sections, after the old text, in its line ends', async () => {
    const { root, cfg } = project()
    mkdirSync(join(root, 'resource'))
    writeFileSync(join(root, 'resource/hello.contracts.md'), own)
    writeFileSync(join(root, 'resource/hello.clauses.md'), 'my clauses')
    const r = await createRicardianFiles(root, cfg)
    expect(r.added).toEqual(['hi', 'move', 'ping'])
    expect(r.kept).toEqual(['setmsg'])
    expect(r.clausesCreated).toBe(false)
    const text = readFileSync(join(root, 'resource/hello.contracts.md'), 'utf8')
    expect(text.startsWith(own)).toBe(true)
    expect(text.slice(own.length)).toMatch(/^\r\n\r\n<h1 class="contract">hi<\/h1>\r\n/)
    expect(text.slice(own.length)).not.toMatch(/[^\r]\n/)
    expect(text.split('\n')[r.line - 1]).toBe('<h1 class="contract">hi</h1>\r')
    expect(readFileSync(join(root, 'resource/hello.clauses.md'), 'utf8')).toBe('my clauses')
    // The order of the old sections and the stale one stay as they were.
    expect([...contractSectionNames(text)]).toEqual(['setmsg', 'oldaction', 'hi', 'move', 'ping'])
  })

  it('extends text without a final line end and empty text', () => {
    const actions = [{ name: 'hi', params: [] }]
    const a = extendContracts('intro', actions)
    expect(a.text).toBe('intro\n\n' + ricardianSection(actions[0]))
    expect(a.firstAddedLine).toBe(3)
    const b = extendContracts('', actions)
    expect(b.text).toBe(ricardianSection(actions[0]))
    expect(b.firstAddedLine).toBe(1)
    const c = extendContracts('intro\n\n', actions)
    expect(c.text).toBe('intro\n\n' + ricardianSection(actions[0]))
  })
})

describe('paths stay inside the project', () => {
  it('refuses paths that leave the project folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'wm-ric-'))
    for (const bad of ['../x.md', 'a/../../x.md', 'C:/x.md', '/x.md', 'a:b', '.git/x.md', 'GIT~1/x.md']) {
      expect(() => containedPath(root, bad)).toThrow()
    }
    expect(containedPath(root, 'resource/hello.contracts.md')).toBe(join(root, 'resource', 'hello.contracts.md'))
  })

  it('refuses a resource folder outside the project in the settings', async () => {
    const { root } = project()
    await expect(createRicardianFiles(root, { ...config(), resource: '../outside' })).rejects.toThrow()
    expect(existsSync(join(root, '..', 'outside'))).toBe(false)
  })

  it('refuses a resource folder that is a link to a folder outside the project', async () => {
    const { root, cfg } = project()
    const outside = mkdtempSync(join(tmpdir(), 'wm-ric-out-'))
    try {
      symlinkSync(outside, join(root, 'resource'), 'junction')
    } catch {
      return // links cannot be made here
    }
    await expect(createRicardianFiles(root, cfg)).rejects.toThrow('outside the project')
    expect(existsSync(join(outside, 'hello.contracts.md'))).toBe(false)
  })

  it('refuses a contracts or clauses file that is a link, also one that points nowhere', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'wm-ric-out-'))
    const cases: { file: string; target: string }[] = [
      { file: 'hello.contracts.md', target: join(outside, 'existing.md') },
      { file: 'hello.contracts.md', target: join(outside, 'missing.md') },
      { file: 'hello.clauses.md', target: join(outside, 'missing-clauses.md') }
    ]
    writeFileSync(join(outside, 'existing.md'), 'outside text')
    for (const c of cases) {
      const { root, cfg } = project()
      mkdirSync(join(root, 'resource'))
      try {
        symlinkSync(c.target, join(root, 'resource', c.file), 'file')
      } catch {
        // Without the right to make file links, a junction stands in for the link.
        try {
          symlinkSync(c.target, join(root, 'resource', c.file), 'junction')
        } catch {
          return // links cannot be made here
        }
      }
      await expect(createRicardianFiles(root, cfg)).rejects.toThrow(`resource/${c.file} is a link; it is not written`)
    }
    expect(readFileSync(join(outside, 'existing.md'), 'utf8')).toBe('outside text')
    expect(existsSync(join(outside, 'missing.md'))).toBe(false)
    expect(existsSync(join(outside, 'missing-clauses.md'))).toBe(false)
  })
})

describe('only plain names are written', () => {
  const withBadNames = (): string => {
    const abi = JSON.parse(ABI)
    abi.structs.push({ name: 'odd', base: '', fields: [{ name: 'ok', type: 'name' }, { name: 'bad<b>', type: 'name' }, { name: 'alsook', type: 'x\ny' }] })
    abi.actions.push({ name: 'x</h1>\n<h1 class="contract">hi', type: 'ping', ricardian_contract: '' })
    abi.actions.push({ name: 'odd', type: 'odd', ricardian_contract: '' })
    return JSON.stringify(abi)
  }

  it('lists a parameter only with a plain name and type', () => {
    const odd = actionsFromAbi(withBadNames()).find((a) => a.name === 'odd')
    expect(odd?.params).toEqual([{ name: 'ok', type: 'name' }])
    expect(
      actionsFromAbi(JSON.stringify({ ...JSON.parse(ABI), structs: [{ name: 'hi', base: '', fields: [{ name: 'v', type: 'pair_name_uint64[]?' }, { name: 'w', type: 'uint8$' }] }] }))[0].params
    ).toEqual([
      { name: 'v', type: 'pair_name_uint64[]?' },
      { name: 'w', type: 'uint8$' }
    ])
  })

  it('writes nothing for an action name that is not a chain name, and a second run changes no byte', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wm-ric-'))
    const cfg = config()
    writeFileSync(join(root, ricardianPaths(cfg).abi), withBadNames())
    const r = await createRicardianFiles(root, cfg)
    expect(r.added).toEqual(['hi', 'move', 'ping', 'setmsg', 'odd'])
    expect(r.message).toBe('resource/hello.contracts.md: added 5, kept 0; skipped 1: not a valid action name; resource/hello.clauses.md created.')
    const first = readFileSync(join(root, 'resource/hello.contracts.md'))
    expect(first.toString('utf8')).not.toContain('x</h1>')
    expect(first.toString('utf8')).not.toContain('bad<b>')
    const again = await createRicardianFiles(root, cfg)
    expect(again.added).toEqual([])
    expect(again.message).toBe('resource/hello.contracts.md: added 0, kept 5; skipped 1: not a valid action name.')
    expect(readFileSync(join(root, 'resource/hello.contracts.md')).equals(first)).toBe(true)
  })
})

describe('old bytes are never written again', () => {
  it('keeps a file with a byte-order mark and bytes that are not UTF-8 exactly as the start of the new file', async () => {
    const { root, cfg } = project()
    mkdirSync(join(root, 'resource'))
    const old = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('Intro é\n', 'utf8'),
      Buffer.from([0xff, 0xfe, 0x80, 0xc3]),
      Buffer.from('\n<h1 class="contract">hi</h1>\nown text', 'latin1')
    ])
    writeFileSync(join(root, 'resource/hello.contracts.md'), old)
    const r = await createRicardianFiles(root, cfg)
    expect(r.added).toEqual(['move', 'ping', 'setmsg'])
    expect(r.kept).toEqual(['hi'])
    const now = readFileSync(join(root, 'resource/hello.contracts.md'))
    expect(now.length).toBeGreaterThan(old.length)
    expect(now.subarray(0, old.length).equals(old)).toBe(true)
    expect(now.subarray(old.length).toString('utf8')).toMatch(/^\n\n<h1 class="contract">move<\/h1>\n/)
    const lines = now.toString('utf8').split('\n')
    expect(lines[r.line - 1]).toBe('<h1 class="contract">move</h1>')
  })
})

describe('Problems hint on the Ricardian warnings', () => {
  it('marks the ABI generator warnings and nothing else', () => {
    const out = [
      'Warning, empty ricardian clause file',
      'Warning, action <hi> does not have a ricardian contract',
      '/mnt/c/p/src/hello.cpp:8:22: warning: abigen warning (Action <hi> does not have a ricardian contract)',
      'Warning, something else'
    ].join('\n')
    const problems = parseProblems(out, 'C:\\p')
    expect(problems.map((p) => isRicardianWarning(p.message))).toEqual([true, true, true, false])
    expect(classifyLine('Warning, empty ricardian clause file').severity).toBe('warning')
    expect(RICARDIAN_HINT).toBe('Contract > Create Ricardian Files writes the missing sections')
  })

  it('the editor preload exposes the call', () => {
    const preload = readFileSync(join(__dirname, '../../src/preload/index.ts'), 'utf8')
    expect(preload).toContain("call('ricardian:create')")
  })
})
