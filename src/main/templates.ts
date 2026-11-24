// Contract templates for File > New Project. The files live in
// resources/templates/project/<template>/ and are compiled into the app; the
// markers %CONTRACT% (contract name) and %CLASS% (C++ class name) are replaced
// when a project is made. (resources/templates/hello is the separate sample the
// toolchain setup builds.)

import type { TemplateId } from '../shared/project'

import emptyCpp from '../../resources/templates/project/empty/src/contract.cpp?raw'
import emptyHpp from '../../resources/templates/project/empty/include/contract.hpp?raw'
import emptyContracts from '../../resources/templates/project/empty/resource/contract.contracts.md?raw'
import emptyClauses from '../../resources/templates/project/empty/resource/contract.clauses.md?raw'
import helloCpp from '../../resources/templates/project/hello/src/contract.cpp?raw'
import helloHpp from '../../resources/templates/project/hello/include/contract.hpp?raw'
import helloContracts from '../../resources/templates/project/hello/resource/contract.contracts.md?raw'
import helloClauses from '../../resources/templates/project/hello/resource/contract.clauses.md?raw'
import tokenCpp from '../../resources/templates/project/token/src/contract.cpp?raw'
import tokenHpp from '../../resources/templates/project/token/include/contract.hpp?raw'
import tokenContracts from '../../resources/templates/project/token/resource/contract.contracts.md?raw'
import tokenClauses from '../../resources/templates/project/token/resource/contract.clauses.md?raw'

interface TemplateSource {
  cpp: string
  hpp: string
  contracts: string
  clauses: string
}

const SOURCES: Record<TemplateId, TemplateSource> = {
  empty: { cpp: emptyCpp, hpp: emptyHpp, contracts: emptyContracts, clauses: emptyClauses },
  hello: { cpp: helloCpp, hpp: helloHpp, contracts: helloContracts, clauses: helloClauses },
  token: { cpp: tokenCpp, hpp: tokenHpp, contracts: tokenContracts, clauses: tokenClauses }
}

/** A C++ class name for a contract name ("my.tok" -> "my_tok", "1abc" -> "c_1abc"). */
export function classNameFor(contract: string): string {
  const id = contract.replace(/[^a-z0-9_]/g, '_')
  return /^[0-9]/.test(id) ? `c_${id}` : id
}

/** Fills the template markers; line ends are always "\n" whatever the checkout used. */
export function fillTemplate(text: string, contract: string, className: string): string {
  return text.replace(/\r\n/g, '\n').replace(/%CONTRACT%/g, contract).replace(/%CLASS%/g, className)
}

export function templateFiles(template: TemplateId, contract: string): Record<string, string> {
  const s = SOURCES[template]
  const name = classNameFor(contract)
  const fill = (text: string): string => fillTemplate(text, contract, name)
  return {
    [`src/${contract}.cpp`]: fill(s.cpp),
    [`include/${contract}.hpp`]: fill(s.hpp),
    [`resource/${contract}.contracts.md`]: fill(s.contracts),
    [`resource/${contract}.clauses.md`]: fill(s.clauses)
  }
}
