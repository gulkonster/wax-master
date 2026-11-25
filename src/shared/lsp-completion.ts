// Completion rules for contract code: which names the engine's lists lose, where a table's row lambda
// is, which row type a table object has, and the snippets offered at the start of a statement or member.

interface CompletionLike {
  label: string
  filterText?: string
  insertText?: string
  textEdit?: { newText: string }
}

/** Prefixes (with their scope marker) of names that are library internals. */
const INTERNAL_PREFIXES = ['internal_use_do_not_use::', 'bluegrass::', 'detail::', '_multi_index_detail::', '_datastream_detail::', 'impl::', 'std::__']

/** The same scopes as bare names, as they show up when the namespace itself is completed (`eosio::`). */
const INTERNAL_SCOPES = ['internal_use_do_not_use', 'bluegrass', 'detail', '_multi_index_detail', '_datastream_detail', 'impl']

/** The macros the app's own flags define, and the three version macros. */
const FLAG_MACROS = [
  'BOOST_DISABLE_ASSERTS',
  'BOOST_EXCEPTION_DISABLE',
  '_GNU_SOURCE',
  '__eosio_cdt__',
  '__eosio_cdt_major__',
  '__eosio_cdt_minor__',
  '__eosio_cdt_patchlevel__'
]

/** Clangd marks some labels with a leading bullet or spaces. */
function plain(text: string | undefined): string {
  return (text ?? '').replace(/^[\s•]+/, '')
}

function startsWithInternal(text: string): boolean {
  return INTERNAL_PREFIXES.some((p) => text.startsWith(p))
}

/** Whether an item of the engine's list is shown. `inInclude`: the cursor is inside an `#include` line. */
export function keepCompletion(item: CompletionLike, inInclude: boolean): boolean {
  const label = plain(item.label)
  const filter = plain(item.filterText)
  const insert = plain(item.insertText)
  const edit = plain(item.textEdit?.newText)
  const forms = [label, filter, insert, edit].filter((s) => s !== '')
  const name = filter || label

  if (name.startsWith('_bluegrass_') || name.startsWith('__')) return false
  if (inInclude) return !(name.startsWith('_') || name.startsWith('Availability'))
  for (const f of forms) {
    if (startsWithInternal(f)) return false
  }
  if (INTERNAL_SCOPES.includes(name.replace(/::$/, ''))) return false
  const bare = name.replace(/[<(\s].*$/s, '')
  if (FLAG_MACROS.includes(bare)) return false
  return true
}

// ---- the row lambda ----------------------------------------------------------------------------

interface Open {
  ch: string
  pos: number
}

const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/** The brackets still open at `offset`, outermost first; strings, characters and comments are skipped. */
function openBrackets(text: string, offset: number): Open[] {
  const stack: Open[] = []
  const end = Math.min(offset, text.length)
  let i = 0
  while (i < end) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      const nl = text.indexOf('\n', i)
      i = nl < 0 ? end : nl + 1
      continue
    }
    if (c === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2)
      i = close < 0 ? end : close + 2
      continue
    }
    if (c === '"') {
      // A raw string: R"delim( ... )delim"
      const raw = i > 0 && text[i - 1] === 'R' ? /^"([^()\\\s]{0,16})\(/.exec(text.slice(i, i + 20)) : null
      if (raw) {
        const close = text.indexOf(`)${raw[1]}"`, i + raw[0].length)
        i = close < 0 ? end : close + raw[1].length + 2
        continue
      }
      i++
      while (i < end && text[i] !== '"' && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1
      i++
      continue
    }
    if (c === "'") {
      // A digit separator (1'000) is not a character literal.
      if (i > 0 && /[0-9a-fA-F]/.test(text[i - 1]) && next !== undefined && /[0-9a-fA-F]/.test(next)) {
        i++
        continue
      }
      i++
      while (i < end && text[i] !== "'" && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1
      i++
      continue
    }
    if (c === '(' || c === '[' || c === '{') stack.push({ ch: c, pos: i })
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.length > 0 && stack[stack.length - 1].ch === CLOSERS[c]) stack.pop()
    }
    i++
  }
  return stack
}

function skipSpaceBack(text: string, from: number): number {
  let i = from
  while (i > 0 && /\s/.test(text[i - 1])) i--
  return i
}

/** The position of the bracket that opens the group closed at `closeAt` (text[closeAt] is the closer). */
function matchBack(text: string, closeAt: number): number {
  const closer = text[closeAt]
  const opener = CLOSERS[closer]
  let depth = 0
  for (let i = closeAt; i >= 0; i--) {
    const c = text[i]
    if (c === closer) depth++
    else if (c === opener) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Whether the open `{` at `stack[index]` is the body of `[...](auto& id) mutable` that is an argument of `.emplace(` or `.modify(`. */
function lambdaAtBrace(text: string, stack: Open[], index: number): { param: string; tableExprEnd: number } | null {
  let i = skipSpaceBack(text, stack[index].pos)
  // `mutable`, `noexcept`, `constexpr` between the parameters and the body
  for (;;) {
    const m = /(?:mutable|noexcept|constexpr)$/.exec(text.slice(Math.max(0, i - 10), i))
    if (!m) break
    i = skipSpaceBack(text, i - m[0].length)
  }
  if (text[i - 1] !== ')') return null
  const paramsOpen = matchBack(text, i - 1)
  if (paramsOpen < 0) return null
  const param = /^\s*auto\s*&\s*([A-Za-z_]\w*)\s*$/.exec(text.slice(paramsOpen + 1, i - 1))
  if (!param) return null
  const j = skipSpaceBack(text, paramsOpen)
  if (text[j - 1] !== ']') return null
  const captureOpen = matchBack(text, j - 1)
  if (captureOpen < 0) return null
  const k = skipSpaceBack(text, captureOpen)
  if (text[k - 1] !== ',' && text[k - 1] !== '(') return null
  // The group the lambda is an argument of must be the next open bracket below the body.
  const outer = index > 0 ? stack[index - 1] : null
  if (!outer || outer.ch !== '(') return null
  const callee = skipSpaceBack(text, outer.pos)
  const name = /(?:emplace|modify)$/.exec(text.slice(Math.max(0, callee - 8), callee))
  if (!name) return null
  const dotEnd = skipSpaceBack(text, callee - name[0].length)
  let exprEnd: number
  if (text[dotEnd - 1] === '.') exprEnd = skipSpaceBack(text, dotEnd - 1)
  else if (text[dotEnd - 1] === '>' && text[dotEnd - 2] === '-') exprEnd = skipSpaceBack(text, dotEnd - 2)
  else return null
  if (exprEnd <= 0) return null
  return { param: param[1], tableExprEnd: exprEnd }
}

/**
 * Whether `offset` is inside the body of a lambda `[...](auto& id)` (also `auto &id`, also followed by `mutable`)
 * that is an argument of `<expr>.emplace(` or `<expr>.modify(`. Gives the parameter's name and the end offset
 * (exclusive) of `<expr>`. Brackets are counted; strings, characters and comments are skipped; macros are not expanded.
 */
export function rowLambdaAt(text: string, offset: number): { param: string; tableExprEnd: number } | null {
  const stack = openBrackets(text, offset)
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].ch !== '{') continue
    const found = lambdaAtBrace(text, stack, i)
    if (found) return found
  }
  return null
}

/**
 * What the cursor line says when it ends in `<id>.`, `<id>.<letters>` or `<id>-><letters>`: the identifier and what
 * is already typed of the member. Null for anything else.
 */
export function memberAccessBefore(lineBeforeCursor: string): { id: string; typed: string } | null {
  const m = /([A-Za-z_]\w*)\s*(?:\.|->)\s*([A-Za-z_]\w*)?$/.exec(lineBeforeCursor)
  if (!m) return null
  return { id: m[1], typed: m[2] ?? '' }
}

/** Splits template arguments at the commas of the top level. `text` starts right after the opening `<`. */
function templateArguments(text: string): string[] | null {
  const args: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'") {
      i++
      while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1
    } else if (c === '<' || c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === '>') {
      if (depth === 0) {
        args.push(text.slice(start, i))
        return args
      }
      depth--
    } else if (c === ',' && depth === 0) {
      args.push(text.slice(start, i))
      start = i + 1
    }
  }
  return null
}

/**
 * The row type of a table object from the engine's hover text: the second argument of the first `multi_index<...>`
 * in it (`stats (aka multi_index<operator""_n<char, 's', 't', 'a', 't'>(), currency_stats>)` gives `currency_stats`;
 * `class eosio::multi_index<123, mytoken::currency_stats>` gives `mytoken::currency_stats`). A secondary index
 * object is shown with its enclosing `multi_index<...>`, so the same rule gives its row.
 */
export function rowTypeOf(hoverText: string): string | null {
  const m = /\bmulti_index\s*</.exec(hoverText)
  if (!m) return null
  const args = templateArguments(hoverText.slice(m.index + m[0].length))
  if (!args || args.length < 2) return null
  const row = args[1]
    .trim()
    .replace(/^(?:(?:class|struct|const)\s+)+/, '')
    .trim()
  if (row === 'auto') return null
  if (!/^(?:::)?[A-Za-z_]\w*(?:<[^]*>)?(?:::[A-Za-z_]\w*(?:<[^]*>)?)*$/.test(row)) return null
  return row
}

// ---- snippets ----------------------------------------------------------------------------------

/**
 * The snippets offered at the start of a statement (`statement`) or of a class member (`member`). The bodies are
 * in the editor's snippet syntax; a placeholder repeated with the same number is one place. Filled with the default
 * texts, each body is valid inside the Token template: the statement ones in the body of a function that has
 * `statstable`, `st`, `quantity` and `memo` (as `retire` has them), the member ones in the contract class.
 */
export const SNIPPETS: readonly { label: string; detail: string; body: string; where: 'statement' | 'member' }[] = [
  {
    label: 'action',
    detail: 'Action declaration',
    body: ['[[eosio::action]]', 'void ${1:myaction}(${2:const name& user});'].join('\n'),
    where: 'member'
  },
  {
    label: 'table',
    detail: 'Table row and its multi_index type',
    body: [
      'struct [[eosio::table]] ${1:row} {',
      '  uint64_t ${2:id};',
      '  uint64_t primary_key() const { return ${2:id}; }',
      '};',
      'typedef eosio::multi_index<"${3:rows}"_n, ${1:row}> ${4:rows_table};'
    ].join('\n'),
    where: 'member'
  },
  {
    label: 'notify',
    detail: 'Handler of a notification from another contract',
    body: [
      '[[eosio::on_notify("${1:eosio.token}::${2:transfer}")]]',
      'void ${3:on_transfer}(const name& from, const name& to, const asset& quantity, const std::string& memo) {',
      '  $0',
      '}'
    ].join('\n'),
    where: 'member'
  },
  {
    label: 'find',
    detail: 'Find a row and check that it exists',
    body: ['auto ${1:found} = ${2:statstable}.find(${3:quantity.symbol.code().raw()});', 'check(${1:found} != ${2:statstable}.end(), "${4:row not found}");'].join(
      '\n'
    ),
    where: 'statement'
  },
  {
    label: 'emplace',
    detail: 'Add a row to a table',
    body: ['${1:statstable}.emplace(${2:get_self()}, [&](auto& ${3:row}) {', '  $0', '});'].join('\n'),
    where: 'statement'
  },
  {
    label: 'modify',
    detail: 'Change a row of a table',
    body: ['${1:statstable}.modify(${2:st}, ${3:same_payer}, [&](auto& ${4:row}) {', '  $0', '});'].join('\n'),
    where: 'statement'
  },
  {
    label: 'erase',
    detail: 'Remove a row from a table',
    body: '${1:statstable}.erase(${2:st});',
    where: 'statement'
  },
  {
    label: 'require_auth',
    detail: 'Require the signature of an account',
    body: 'require_auth(${1:get_self()});',
    where: 'statement'
  },
  {
    label: 'check',
    detail: 'Fail the action with a message when a condition is false',
    body: 'check(${1:true}, "${2:message}");',
    where: 'statement'
  },
  {
    label: 'inline',
    detail: 'Send an inline action',
    body: 'action(permission_level{get_self(), "active"_n}, ${1:"eosio.token"_n}, ${2:"transfer"_n}, std::make_tuple(${3:get_self()}, ${4:get_self()}, ${5:quantity}, ${6:memo})).send();',
    where: 'statement'
  },
  {
    label: 'singleton',
    detail: 'A table that holds one row (needs eosio/singleton.hpp)',
    body: [
      '// needs: #include <eosio/singleton.hpp>',
      'struct [[eosio::table]] ${1:config_row} {',
      '  uint64_t ${2:value} = 0;',
      '};',
      'typedef eosio::singleton<"${3:config}"_n, ${1:config_row}> ${4:config_table};'
    ].join('\n'),
    where: 'member'
  }
]
