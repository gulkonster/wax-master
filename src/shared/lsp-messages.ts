import { uint64ToName } from '../chain-core/name'

/** Templates of the contract library whose first argument is a name, written by the engine as a number. */
const NAME_TEMPLATES = 'multi_index|index|indexed_by|singleton|action_wrapper'

const LITERAL_OPERATOR = /operator\s*""\s*_n\s*<\s*char\s*((?:,\s*'[^'\n]'\s*)*)>\s*(?:\(\s*\))?/g
const NUMBER_ARGUMENT = new RegExp(`\\b((?:${NAME_TEMPLATES})\\s*<\\s*)(\\d{15,20})\\b`, 'g')
const MAX_UINT64 = (1n << 64n) - 1n

/** Reads the characters of `, 's', 't'` into the string they spell. */
function spell(list: string): string {
  let out = ''
  for (const m of list.matchAll(/'([^'\n])'/g)) out += m[1]
  return out
}

/**
 * Says the compiler's inside views of a name in the developer's words: `operator""_n<char, 's', 't'>()`
 * becomes `"st"_n`, and a 15 to 20 digit number that opens `multi_index<`, `index<`, `indexed_by<`,
 * `singleton<` or `action_wrapper<` becomes the name it encodes.
 */
export function prettyNames(text: string): string {
  if (!text) return text
  let out = text.replace(LITERAL_OPERATOR, (_all, list: string) => `"${spell(list)}"_n`)
  out = out.replace(NUMBER_ARGUMENT, (all, head: string, digits: string) => {
    const value = BigInt(digits)
    if (value > MAX_UINT64) return all
    const name = uint64ToName(value)
    return name ? `${head}"${name}"_n` : all
  })
  return out
}

const GROUP_LINE = /^\s*(?:@ingroup|@addtogroup|@defgroup)\b|^\s*@[{}]\s*$/
const SECTION_WORDS: Record<string, string> = { pre: 'Pre', post: 'Post', note: 'Note', details: 'Details', warning: 'Warning' }

/** One documentation line outside a code block, without its line break. */
function cleanLine(line: string): string {
  let out = line
  out = out.replace(/@brief\s*/g, '')
  out = out.replace(/^(\s*)@(?:param|tparam)(?:\[[^\]]*\])?\s+([A-Za-z_][\w]*)\s*(?:-\s*)?(.*)$/, (_all, lead: string, name: string, rest: string) => {
    const body = rest.trim()
    const tail = rest.endsWith('  ') ? '  ' : ''
    return `${lead}- \`${name}\`${body ? ` - ${body}` : ''}${tail}`
  })
  out = out.replace(/@returns?\b\s*/g, 'Returns: ')
  out = out.replace(/@(pre|post|note|details|warning)\b\s*/g, (_all, word: string) => `${SECTION_WORDS[word]}: `)
  out = out.replace(/@ref\s+/g, '')
  out = out.replace(/(^|[^\w%])%(?=[A-Za-z_])/g, '$1')
  return out
}

/**
 * Turns the comment marks of the toolchain headers into plain markdown: group lines and `@brief` go,
 * `@param` becomes a list line, `@return` and the section words become a word with a colon, `@ref x` and
 * `%x` become `x`, `@code ... @endcode` becomes a C++ code block. Fenced blocks already in the text stay as they are.
 */
export function cleanDoc(text: string): string {
  if (!text) return text
  const lines = text.split('\n')
  const out: string[] = []
  let fenced = false
  let inCode = false
  for (const raw of lines) {
    if (inCode) {
      const end = raw.indexOf('@endcode')
      if (end < 0) {
        out.push(raw.replace(/ {2}$/, ''))
        continue
      }
      const before = raw.slice(0, end).replace(/\s+$/, '')
      if (before) out.push(before)
      out.push('```')
      const after = raw.slice(end + '@endcode'.length)
      if (after.trim()) out.push(cleanLine(after.replace(/^\s+/, '')))
      inCode = false
      continue
    }
    if (/^\s*```/.test(raw)) {
      fenced = !fenced
      out.push(raw)
      continue
    }
    if (fenced) {
      out.push(raw)
      continue
    }
    if (GROUP_LINE.test(raw)) continue
    const open = /@code(?:\{[^}]*\})?/.exec(raw)
    if (open) {
      const before = raw.slice(0, open.index).replace(/\s+$/, '')
      if (before.trim()) out.push(cleanLine(before) + '  ')
      out.push('```cpp')
      const rest = raw.slice(open.index + open[0].length).replace(/^[ \t]+/, '')
      const end = rest.indexOf('@endcode')
      if (end >= 0) {
        const code = rest.slice(0, end).replace(/\s+$/, '')
        if (code) out.push(code)
        out.push('```')
        const after = rest.slice(end + '@endcode'.length)
        if (after.trim()) out.push(cleanLine(after.replace(/^\s+/, '')))
      } else {
        if (rest.trim()) out.push(rest.replace(/ {2}$/, ''))
        inCode = true
      }
      continue
    }
    out.push(cleanLine(raw))
  }
  if (inCode) out.push('```')
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** A diagnostic message as the window shows it: no fix hint, no template prefix, names in the developer's form. */
export function cleanMessage(text: string): string {
  if (!text) return text
  let out = text.replace(/ \(fix available\)/g, '')
  out = out.replace(/^In template: (\S)/, (_all, first: string) => first.toUpperCase())
  return prettyNames(out)
}
