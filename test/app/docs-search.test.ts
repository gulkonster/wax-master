// Everyday questions to the documentation search: each one must bring its
// page among the first three results. The search documents are built from the
// shipped topics exactly as the Documentation page builds them.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDocsIndex, searchDocs, topicFile, type SearchDoc } from '../../src/shared/docs'
import { documentText, parseMarkdown } from '../../src/shared/markdown'

const DOCS = join(__dirname, '../../docs/help')
const index = parseDocsIndex(readFileSync(join(DOCS, 'index.json'), 'utf8'))
const docs: SearchDoc[] = index.groups.flatMap((g) =>
  g.topics.map((t) => ({
    id: t.id,
    title: t.title,
    group: g.title,
    keywords: t.keywords.join(' '),
    ...documentText(parseMarkdown(readFileSync(join(DOCS, topicFile(t.id)), 'utf8')))
  }))
)

/** The question as a user types it, and the page that answers it. */
const QUESTIONS: [string, string][] = [
  ['add eosio.code', 'eosio-code'],
  ['buy ram', 'resources-ram'],
  ['forgot password', 'vault'],
  ['unknown type in abi', 'abi-check'],
  ['linkauth', 'linked-actions'],
  ['inline action', 'contract-inline-actions'],
  ['singleton', 'contract-singletons'],
  ['table payer', 'contract-tables'],
  ['on_notify', 'contract-notifications'],
  ['transfer listener', 'contract-notifications'],
  ['random number', 'contract-random'],
  ['current time', 'contract-time'],
  ['assertion failure', 'contract-errors'],
  ['symbol precision', 'contract-assets'],
  ['require_auth', 'contract-actions-auth'],
  ['read another contract table', 'contract-read-other-table'],
  ['upgrade contract', 'contract-upgrade'],
  ['stake cpu', 'resources-cpu-net'],
  ['testnet faucet', 'create-testnet-account'],
  ['ricardian', 'ricardian'],
  ['transaction refused', 'troubleshooting'],
  ['glossary', 'glossary']
]

describe('documentation search: everyday questions', () => {
  it('every expected page exists', () => {
    const ids = new Set(docs.map((d) => d.id))
    for (const [, id] of QUESTIONS) expect(ids.has(id), id).toBe(true)
  })

  for (const [question, id] of QUESTIONS) {
    it(`"${question}" finds ${id} in the first three results`, () => {
      const top = searchDocs(question, docs)
        .slice(0, 3)
        .map((h) => h.id)
      expect(top, `top three: ${top.join(', ')}`).toContain(id)
    })
  }
})
