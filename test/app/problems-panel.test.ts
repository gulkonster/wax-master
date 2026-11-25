import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { on } from '../../src/renderer/src/lib/bus'
import { appendOutput, outputStore, panelsFollowProject, problemsStore } from '../../src/renderer/src/lib/stores'
import { templateFiles } from '../../src/main/templates'

describe('Output and Problems follow the open project', () => {
  it('empties both when another project is opened or the project is closed, not on the first project or a reopen', () => {
    let updates = 0
    const off = on('problems-updated', () => updates++)
    const fill = (): void => {
      appendOutput('Build finished in 1.0 s.\n')
      problemsStore.set([{ file: 'src/a.cpp', line: 1, column: 1, severity: 'warning', message: 'x', source: 'build' }])
    }
    fill()
    panelsFollowProject('C:\\p\\a')
    expect(outputStore.get()).not.toBe('')
    expect(problemsStore.get()).toHaveLength(1)
    panelsFollowProject('C:\\p\\a')
    expect(problemsStore.get()).toHaveLength(1)
    panelsFollowProject('C:\\p\\b')
    expect(outputStore.get()).toBe('')
    expect(problemsStore.get()).toEqual([])
    expect(updates).toBe(1)
    fill()
    panelsFollowProject(null)
    expect(outputStore.get()).toBe('')
    expect(problemsStore.get()).toEqual([])
    off()
  })

  it('the bottom panel calls it with the open project and lists the merged problems', () => {
    const src = readFileSync(join(__dirname, '../../src/renderer/src/components/BottomPanel.tsx'), 'utf8')
    expect(src).toMatch(/useEffect\(\(\) => \{\s*panelsFollowProject\(projectPath\)\s*\}, \[projectPath\]\)/)
    expect(src).toContain('useStore(mergedProblemsStore)')
    expect(src).toContain('{problems.map((p, i) => (')
  })
})

describe('ABI check entry in Problems', () => {
  it('shows the source "abi" next to Read more', () => {
    const src = readFileSync(join(__dirname, '../../src/renderer/src/components/BottomPanel.tsx'), 'utf8')
    const block = src.slice(src.indexOf("{p.source === 'abi' && ("))
    expect(block.slice(0, 400)).toMatch(/>abi<\/span> <ReadMore place="abiCheck" \/>/)
  })
})

describe('editor colours of the Token header', () => {
  it('reads the commented-out transfers block as a comment with the cpp tokenizer the editor uses', async () => {
    const M = '../../node_modules/monaco-editor/esm/vs/'
    const { compile } = await import(M + 'editor/standalone/common/monarch/monarchCompile.js')
    const { MonarchTokenizer } = await import(M + 'editor/standalone/common/monarch/monarchLexer.js')
    const { language } = await import(M + 'languages/definitions/cpp/cpp.js')
    const config = { getValue: () => 20000, onDidChangeConfiguration: () => ({ dispose() {} }) }
    const tokenizer = new MonarchTokenizer({ requestRichLanguageFeatures() {} }, {}, 'cpp', compile('cpp', language), config)
    const lines = templateFiles('token', 'token')['include/token.hpp'].split('\n')
    const start = lines.indexOf('  /*')
    const end = lines.indexOf('  */')
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    let state = tokenizer.getInitialState()
    lines.forEach((line, i) => {
      const r = tokenizer.tokenize(line, true, state)
      state = r.endState
      if (i < start || i > end || line.trim() === '') return
      const kinds = r.tokens.filter((t: { offset: number }) => t.offset < line.length).map((t: { type: string }) => t.type)
      for (const k of kinds.slice(i === start ? 1 : 0)) expect(k, `line ${i + 1}`).toMatch(/^comment\.cpp$/)
    })
  })
})
