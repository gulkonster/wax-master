// Rules for project headers that are only a piece of another file (decision B98)
// and the summary line for a header with errors of its own (decision B97).

const SOURCE_EXT = /\.(cpp|cc|cxx|c)$/i

/** True for a project path that is a header: anything that is not a C or C++ source file. */
export function isHeaderPath(path: string): boolean {
  return path.length > 0 && !SOURCE_EXT.test(path)
}

/**
 * The target of an `#include` line: `<x>`, `"x"`, spaces before and after the `#`,
 * a trailing comment. `start` and `end` are character offsets in the line and cover
 * the name with its brackets or quotes (`end` is exclusive). Null when the line is not
 * an include line.
 */
export function includeTarget(line: string): { start: number; end: number; name: string } | null {
  const m = /^\s*#\s*include\s*(?:<([^<>\r\n]*)>|"([^"\r\n]*)")/.exec(line)
  if (!m) return null
  const inner = m[1] ?? m[2] ?? ''
  const name = inner.trim()
  if (name === '') return null
  const end = m[0].length
  const start = end - inner.length - 2
  return { start, end, name }
}

function cleanRel(p: string): string {
  const out: string[] = []
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      // A leading `..` cannot be resolved here; the match is by trailing part.
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

/**
 * True when a line that starts with `#include` in a file other than the header itself
 * names the header. `searchLines` are the lines found by one file search for the header's
 * name; `headerRel` is the header's path relative to the project. The include name
 * matches when it is the header's path or a trailing part of it, at a folder boundary.
 */
export function namedInInclude(searchLines: { file: string; text: string }[], headerRel: string): boolean {
  const header = cleanRel(headerRel)
  if (header === '') return false
  for (const l of searchLines) {
    if (cleanRel(l.file) === header) continue
    const t = includeTarget(l.text)
    if (!t) continue
    const name = cleanRel(t.name)
    if (name === '') continue
    if (name === header || header.endsWith('/' + name)) return true
  }
  return false
}

/** B98 point 1: all three conditions hold. `mainFileErrors` is null while it is not known. */
export function isPiece(input: { headerErrors: number; mainFileErrors: number | null; included: boolean }): boolean {
  return input.headerErrors > 0 && input.mainFileErrors === 0 && input.included
}

/**
 * B97 point 4: the one line for an include line whose header has errors of its own.
 * `errors[].line` is 1-based, as shown to the user. Null when there is no error.
 */
export function headerSummary(file: string, errors: { line: number; message: string }[]): string | null {
  const first = errors[0]
  if (!first) return null
  return `${file} has ${errors.length} ${errors.length === 1 ? 'error' : 'errors'}; first: line ${first.line}: ${first.message}`
}

/** B98 point 2: the information mark on line 1 of a piece. */
export function pieceNotice(mainFile: string): string {
  return `This header is not complete on its own: it uses what ${mainFile} includes before it. It is checked as part of that file, which has no errors.`
}
