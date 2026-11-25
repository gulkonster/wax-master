// The format check (`npm run check:editor`): Format Document must change nothing
// in a project made from any of the twelve shipped template folders (the three
// project templates, resources/templates/hello and the eight examples). For each
// folder the project is made as New Project makes it, both source files are
// opened in the editor engine and `textDocument/formatting` is asked: 0 edits.
//
// With WAX_FORMAT_WRITE=1 the test instead formats the shipped sources: the
// project is made with a placeholder contract name, the engine's edits are
// applied, the markers %CONTRACT% and %CLASS% are put back and the text is
// written into resources/templates. A file whose markers cannot be put back one
// to one (the unformatted text must come back unchanged) makes the test fail;
// such a file is formatted by hand. Run the check again without the variable
// afterwards (the sources are read when the run starts).
//
// It needs WSL and the toolchain (Help > Setup); the distro comes from
// WAX_DISTRO (default waxmaster-wax-cdt-4.1.1wax01).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classNameFor, codeIdentifiers, fillTemplate } from '../../src/main/templates'
import { toWslPath } from '../../src/main/toolchain'
import { EXAMPLES, TEMPLATES, type TemplateId } from '../../src/shared/project'
import { distroInstalled, distroName, EngineClient, makeProject, type CheckProject } from './lsp-harness'

const DISTRO = distroName()
const AVAILABLE = distroInstalled(DISTRO)
if (!AVAILABLE) console.log(`format check skipped: the distro "${DISTRO}" is not listed by "wsl.exe -l -q" (set WAX_DISTRO, or install the toolchain with Help > Setup).`)

const WRITE = process.env.WAX_FORMAT_WRITE === '1'
const TEMPLATE_ROOT = join(__dirname, '../../resources/templates')
/** A contract name that does not occur in any shipped source, with its class name. */
const PLACEHOLDER = 'zz.contra'

interface Edit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  newText: string
}

interface Folder {
  /** Folder under resources/templates. */
  dir: string
  /** The id New Project knows the folder by; null for resources/templates/hello. */
  id: TemplateId | null
  /** The project name New Project offers. */
  name: string
}

const FOLDERS: Folder[] = [
  ...TEMPLATES.map((t) => ({ dir: `project/${t.id}`, id: t.id as TemplateId, name: t.id === 'empty' ? 'contract' : t.id })),
  { dir: 'hello', id: null, name: 'hello' },
  ...EXAMPLES.map((e) => ({ dir: `examples/${e.id}`, id: e.id as TemplateId, name: e.name }))
]

function offsetOf(text: string, line: number, character: number): number {
  let off = 0
  for (let i = 0; i < line; i++) {
    const nl = text.indexOf('\n', off)
    if (nl < 0) return text.length
    off = nl + 1
  }
  return Math.min(off + character, text.length)
}

function applyEdits(text: string, edits: Edit[]): string {
  const spans = edits
    .map((e) => ({ from: offsetOf(text, e.range.start.line, e.range.start.character), to: offsetOf(text, e.range.end.line, e.range.end.character), text: e.newText }))
    .sort((a, b) => b.from - a.from)
  let out = text
  for (const s of spans) out = out.slice(0, s.from) + s.text + out.slice(s.to)
  return out
}

/** The project of a folder as New Project makes it (resources/templates/hello is written as it is). */
function projectOf(f: Folder, name: string): CheckProject {
  if (f.id) return makeProject(f.id, name)
  const base = mkdtempSync(join(tmpdir(), 'waxmaster-check-'))
  const root = join(base, 'project')
  const files: Record<string, string> = {}
  for (const rel of ['src/hello.cpp', '.clang-format']) {
    files[rel] = readFileSync(join(TEMPLATE_ROOT, f.dir, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n')
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), files[rel])
  }
  return {
    root,
    rootWsl: toWslPath(root),
    contract: name,
    files,
    cpp: 'src/hello.cpp',
    hpp: '',
    dispose: () => rmSync(base, { recursive: true, force: true })
  }
}

/** The sources of a project: [path in the project, path in the template folder]. */
function sourcesOf(f: Folder, p: CheckProject): [string, string][] {
  if (!f.id) return [['src/hello.cpp', 'src/hello.cpp']]
  return [
    [p.cpp, 'src/contract.cpp'],
    [p.hpp, 'include/contract.hpp']
  ]
}

async function formatEdits(client: EngineClient, rel: string): Promise<Edit[]> {
  const ask = (client as unknown as { request(m: string, p: unknown): Promise<unknown> }).request.bind(client)
  const r = (await ask('textDocument/formatting', { textDocument: { uri: client.serverUri(rel) }, options: { tabSize: 2, insertSpaces: true } })) as Edit[] | null
  return r ?? []
}

/** The text with the contract and class names replaced by the markers. */
function restoreMarkers(text: string, contract: string, className: string): string {
  return text.split(className).join('%CLASS%').split(contract).join('%CONTRACT%')
}

describe.skipIf(!AVAILABLE)(WRITE ? 'format the shipped sources' : 'Format Document on a new project', () => {
  for (const f of FOLDERS) {
    it(WRITE ? `${f.dir}: writes the formatted sources` : `${f.dir}: 0 edits`, async () => {
      const p = projectOf(f, WRITE ? PLACEHOLDER : f.name)
      const client = new EngineClient(p, DISTRO)
      try {
        await client.start()
        for (const [rel] of sourcesOf(f, p)) await client.open(rel, p.files[rel])
        for (const [rel, templateRel] of sourcesOf(f, p)) {
          const edits = await formatEdits(client, rel)
          if (!WRITE) {
            expect(edits.length, `${f.dir}: ${rel} needs ${edits.length} edit(s); first at line ${edits[0] ? edits[0].range.start.line + 1 : 0}`).toBe(0)
            continue
          }
          const path = join(TEMPLATE_ROOT, f.dir, ...templateRel.split('/'))
          const raw = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
          const used = codeIdentifiers(
            sourcesOf(f, p)
              .map(([, t]) => readFileSync(join(TEMPLATE_ROOT, f.dir, ...t.split('/')), 'utf8'))
              .join('\n')
          )
          const className = f.id ? classNameFor(PLACEHOLDER, used) : PLACEHOLDER
          // The markers must come back one to one from the unformatted text.
          expect(restoreMarkers(fillTemplate(raw, PLACEHOLDER, className), PLACEHOLDER, className), `${f.dir}: ${templateRel} markers`).toBe(raw)
          const formatted = restoreMarkers(applyEdits(p.files[rel], edits), PLACEHOLDER, className)
          writeFileSync(path, formatted)
        }
      } finally {
        await client.stop()
        // The engine may still hold the folder for a moment on Windows.
        await new Promise((r) => setTimeout(r, 500))
        try {
          p.dispose()
        } catch {
          // left in the system temp folder
        }
      }
    })
  }
})
