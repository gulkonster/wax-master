// Contract templates and example projects for File > New Project. Templates
// live in resources/templates/project/<template>/, examples in
// resources/templates/examples/<example>/ (each with a README.md); both are
// compiled into the app, and the markers %CONTRACT% (contract name) and
// %CLASS% (C++ class name) are replaced when a project is made.
// (resources/templates/hello is the separate sample the toolchain setup builds.)

import { EXAMPLES, type ExampleId, type ProjectTemplateId, type TemplateId } from '../shared/project'

import emptyCpp from '../../resources/templates/project/empty/src/contract.cpp?raw'
import emptyHpp from '../../resources/templates/project/empty/include/contract.hpp?raw'
import emptyContracts from '../../resources/templates/project/empty/resource/contract.contracts.md?raw'
import emptyClauses from '../../resources/templates/project/empty/resource/contract.clauses.md?raw'
import emptyStyle from '../../resources/templates/project/empty/.clang-format?raw'
import helloCpp from '../../resources/templates/project/hello/src/contract.cpp?raw'
import helloHpp from '../../resources/templates/project/hello/include/contract.hpp?raw'
import helloContracts from '../../resources/templates/project/hello/resource/contract.contracts.md?raw'
import helloClauses from '../../resources/templates/project/hello/resource/contract.clauses.md?raw'
import helloStyle from '../../resources/templates/project/hello/.clang-format?raw'
import tokenCpp from '../../resources/templates/project/token/src/contract.cpp?raw'
import tokenHpp from '../../resources/templates/project/token/include/contract.hpp?raw'
import tokenContracts from '../../resources/templates/project/token/resource/contract.contracts.md?raw'
import tokenClauses from '../../resources/templates/project/token/resource/contract.clauses.md?raw'
import tokenStyle from '../../resources/templates/project/token/.clang-format?raw'

interface TemplateSource {
  cpp: string
  hpp: string
  contracts: string
  clauses: string
  /** The `.clang-format` of the folder: Format Document keeps the layout of the shipped files. */
  style: string
  /** Examples only. */
  readme?: string
}

const SOURCES: Record<ProjectTemplateId, TemplateSource> = {
  empty: { cpp: emptyCpp, hpp: emptyHpp, contracts: emptyContracts, clauses: emptyClauses, style: emptyStyle },
  hello: { cpp: helloCpp, hpp: helloHpp, contracts: helloContracts, clauses: helloClauses, style: helloStyle },
  token: { cpp: tokenCpp, hpp: tokenHpp, contracts: tokenContracts, clauses: tokenClauses, style: tokenStyle }
}

/** The files every example folder holds, relative to the folder. */
export const EXAMPLE_FILES = ['src/contract.cpp', 'include/contract.hpp', 'resource/contract.contracts.md', 'resource/contract.clauses.md', 'README.md', '.clang-format'] as const

const EXAMPLE_TEXTS = {
  ...import.meta.glob('../../resources/templates/examples/*/**/*', { query: '?raw', import: 'default', eager: true }),
  // A pattern that names the dot file is needed: the first one does not match it.
  ...import.meta.glob('../../resources/templates/examples/*/.clang-format', { query: '?raw', import: 'default', eager: true })
}

/** The files of every example folder, by folder name and path inside the folder. */
export function readExampleFolders(texts: Record<string, string>): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  for (const [path, text] of Object.entries(texts)) {
    const m = /\/templates\/examples\/([^/]+)\/(.+)$/.exec(path.replace(/\\/g, '/'))
    if (!m) continue
    if (!out.has(m[1])) out.set(m[1], new Map())
    out.get(m[1])!.set(m[2], text)
  }
  return out
}

function exampleSource(id: ExampleId): TemplateSource {
  const files = readExampleFolders(EXAMPLE_TEXTS).get(id)
  const get = (rel: (typeof EXAMPLE_FILES)[number]): string => {
    const text = files?.get(rel)
    if (text === undefined) throw new Error(`The example "${id}" is incomplete: ${rel} is missing`)
    return text
  }
  return {
    cpp: get('src/contract.cpp'),
    hpp: get('include/contract.hpp'),
    contracts: get('resource/contract.contracts.md'),
    clauses: get('resource/contract.clauses.md'),
    style: get('.clang-format'),
    readme: get('README.md')
  }
}

function isExample(id: TemplateId): id is ExampleId {
  return EXAMPLES.some((e) => e.id === id)
}

/** C++ keywords, and the base class and namespace every contract uses: a class cannot be named after them. */
const RESERVED_NAMES = new Set(
  ('contract eosio alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept ' +
    'const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double ' +
    'dynamic_cast else enum explicit export extern false final float for friend goto if import inline int long module mutable ' +
    'namespace new noexcept not not_eq nullptr operator or or_eq override private protected public register reinterpret_cast ' +
    'requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true ' +
    'try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq').split(' ')
)

/** The identifiers a template's code uses (comments, strings and markers left out). */
export function codeIdentifiers(code: string): Set<string> {
  const bare = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, ' ')
    .replace(/%[A-Z]+%/g, ' ')
  return new Set(bare.match(/[A-Za-z_]\w*/g) ?? [])
}

/**
 * A C++ class name for a contract name ("my.tok" -> "my_tok", "1abc" -> "c_1abc").
 * A name that is a C++ keyword or one of the identifiers the template's code
 * uses (`contract` is the base class eosio::contract; `name`; a member such as
 * `transfer`) gets the prefix too: "contract" -> "c_contract".
 */
export function classNameFor(contract: string, used: ReadonlySet<string> = new Set()): string {
  const id = contract.replace(/[^a-z0-9_]/g, '_')
  return /^[0-9]/.test(id) || RESERVED_NAMES.has(id) || used.has(id) ? `c_${id}` : id
}

/** Fills the template markers; line ends are always "\n" whatever the checkout used. */
export function fillTemplate(text: string, contract: string, className: string): string {
  return text.replace(/\r\n/g, '\n').replace(/%CONTRACT%/g, contract).replace(/%CLASS%/g, className)
}

export function templateFiles(template: TemplateId, contract: string): Record<string, string> {
  const s = isExample(template) ? exampleSource(template) : SOURCES[template]
  const name = classNameFor(contract, codeIdentifiers(s.hpp + '\n' + s.cpp))
  const fill = (text: string): string => fillTemplate(text, contract, name)
  const files: Record<string, string> = {
    [`src/${contract}.cpp`]: fill(s.cpp),
    [`include/${contract}.hpp`]: fill(s.hpp),
    [`resource/${contract}.contracts.md`]: fill(s.contracts),
    [`resource/${contract}.clauses.md`]: fill(s.clauses),
    '.clang-format': s.style
  }
  if (s.readme !== undefined) files['README.md'] = fill(s.readme)
  return files
}
