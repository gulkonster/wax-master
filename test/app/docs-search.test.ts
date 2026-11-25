// Everyday questions to the documentation search: each one must bring its
// page among the first three results. The search documents are built from the
// shipped topics exactly as the Documentation page builds them, with the
// shipped similar-word list.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NO_SEARCH_WORDS, SEARCH_WORDS_FILE, parseDocsIndex, parseSearchWords, searchDocs, searchDocumentation, topicFile, type SearchDoc, type SearchWords } from '../../src/shared/docs'
import { documentText, parseMarkdown } from '../../src/shared/markdown'

const DOCS = join(__dirname, '../../docs/help')
const index = parseDocsIndex(readFileSync(join(DOCS, 'index.json'), 'utf8'))
/** A topic whose file cannot be read is searched by its title and keywords, as on the Documentation page. */
const docs: SearchDoc[] = index.groups.flatMap((g) =>
  g.topics.map((t) => {
    const file = join(DOCS, topicFile(t.id))
    const text = existsSync(file) ? documentText(parseMarkdown(readFileSync(file, 'utf8'))) : { headings: '', body: '' }
    return { id: t.id, title: t.title, group: g.title, keywords: t.keywords, ...text }
  })
)
const searchWords: SearchWords = parseSearchWords(readFileSync(join(DOCS, SEARCH_WORDS_FILE), 'utf8'))

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

/** Plurals, verb forms, question words and words joined by `_` or `.`. */
const FORMS: [string, string][] = [
  ['staking cpu', 'resources-cpu-net'],
  ['deploying', 'deploy'],
  ['transfers', 'transfers'],
  ['creating accounts', 'create-account'],
  ['endpoints', 'endpoints'],
  ['singletons', 'contract-singletons'],
  ['notifications', 'contract-notifications'],
  ['random numbers', 'contract-random'],
  ['linked action', 'linked-actions'],
  ['thresholds', 'multisig-threshold'],
  ['backing up keys', 'key-backups'],
  ['changing keys', 'change-key-safely'],
  ['reading tables', 'read-tables'],
  ['run action', 'run-actions'],
  ['simulating a transaction', 'simulate-inspector'],
  ['upgrades', 'contract-upgrade'],
  ['on notify', 'contract-notifications'],
  ['require auth', 'contract-actions-auth'],
  ['how do i buy ram', 'resources-ram'],
  ['what is a singleton', 'contract-singletons']
]

/** Typing mistakes: a word of the documentation one or two edits away. */
const TYPOS: [string, string, string][] = [
  ['stakng', 'example-staking', 'staking'],
  ['singelton', 'contract-singletons', 'singleton'],
  ['ricardain', 'ricardian', 'ricardian'],
  ['permision', 'permissions-overview', 'permission'],
  ['transfre', 'transfers', 'transfer'],
  ['faucett', 'create-testnet-account', 'faucet'],
  ['precsion', 'contract-assets', 'precision'],
  ['notifcation', 'contract-notifications', 'notification'],
  ['endpiont', 'endpoints', 'endpoint'],
  ['multisg', 'multisig-threshold', 'multisig']
]

/** Words that mean the same as the words of the page. */
const SIMILAR: [string, string][] = [
  ['send tokens', 'transfers'],
  ['erase row', 'contract-tables'],
  ['memory', 'resources-ram'],
  ['free wax', 'create-testnet-account'],
  ['callback', 'contract-notifications'],
  ['block producer', 'voting-rewards'],
  ['ticker', 'contract-assets'],
  ['rent cpu', 'powerup'],
  ['msig', 'multisig-threshold'],
  ['username', 'accounts-and-names'],
  ['publish', 'deploy'],
  ['test network', 'mainnet-and-testnet']
]

/** Beginner questions whose pages exist today. */
const BEGINNER: [string, string][] = [
  ['negative amount', 'contract-validate-input'],
  ['minus quantity', 'contract-validate-input'],
  ['how do i send wax', 'transfers'],
  ['who pays for the table row', 'contract-tables']
]

/**
 * Questions about pages that are listed in the index while their text is being
 * written: they rely on the title and keywords of the index only.
 */
const NEW_PAGES: [string, string][] = [
  ['fake token', 'contract-accept-tokens'],
  ['scam token', 'contract-accept-tokens'],
  ['open pack', 'nft-packs'],
  ['loot box', 'nft-packs'],
  ['drop odds', 'nft-packs'],
  ['probability', 'nft-packs'],
  ['who pays ram', 'contract-who-pays'],
  ['free transactions for players', 'contract-who-pays'],
  ['add field to table', 'contract-table-migration'],
  ['how do i add a field to a table', 'contract-table-migration'],
  ['new column', 'contract-table-migration'],
  ['premium name', 'name-bids'],
  ['short name', 'name-bids'],
  ['craft nft', 'example-nft-blend'],
  ['merge nfts', 'example-nft-blend'],
  ['stake nft', 'example-nft-staking'],
  ['sell nft', 'nft-drops'],
  ['mainnet checklist', 'contract-checklist'],
  ['logtransfer', 'nft-notifications'],
  ['logmint', 'nft-notifications'],
  ['how do i accept payments in my contract', 'contract-accept-tokens'],
  ['someone sent fake wax', 'contract-accept-tokens'],
  ['accept two tokens', 'example-payments'],
  ['get_first_receiver', 'contract-accept-tokens'],
  ['who pays cpu', 'contract-who-pays'],
  ['first authorizer', 'contract-who-pays'],
  ['security checklist', 'contract-checklist'],
  ['limit text length', 'contract-validate-input'],
  ['table broken after deploy', 'contract-table-migration'],
  ['binary_extension', 'contract-table-migration'],
  ['whose nft', 'example-nft-staking'],
  ['unstake nft', 'example-nft-staking'],
  ['blend nfts', 'example-nft-blend'],
  ['nft recipe', 'example-nft-blend'],
  ['how to bid on a premium name', 'name-bids'],
  ['i was outbid', 'name-bids'],
  ['how do i create the name i won', 'name-bids'],
  ['how do i make a free drop', 'nft-drops'],
  ['drop whitelist', 'nft-drops'],
  ['how are pack odds set', 'nft-packs'],
  ['claimunboxed', 'nft-packs'],
  ['addnotifyacc', 'nft-notifications'],
  ['notification when an nft is transferred', 'nft-notifications'],
  ['mutable data', 'nft-atomicassets'],
  ['backed tokens', 'nft-atomicassets'],
  ['price oracle', 'wax-services'],
  ['random number does not answer on testnet', 'example-random-number'],
  ['autocomplete', 'editor'],
  ['red line', 'editor'],
  ['format', 'editor']
]

function topThree(question: string, words: SearchWords = searchWords): string[] {
  return searchDocs(question, docs, words)
    .slice(0, 3)
    .map((h) => h.id)
}

describe('documentation search: everyday questions', () => {
  it('every expected page is in the index', () => {
    const ids = new Set(docs.map((d) => d.id))
    for (const [, id] of [...QUESTIONS, ...FORMS, ...TYPOS, ...SIMILAR, ...BEGINNER, ...NEW_PAGES]) expect(ids.has(id), id).toBe(true)
  })

  for (const [question, id] of QUESTIONS) {
    it(`"${question}" finds ${id} in the first three results`, () => {
      const top = topThree(question)
      expect(top, `top three: ${top.join(', ')}`).toContain(id)
    })
    it(`"${question}" finds ${id} in the first three results without the similar-word list`, () => {
      const top = topThree(question, NO_SEARCH_WORDS)
      expect(top, `top three: ${top.join(', ')}`).toContain(id)
    })
  }
})

describe('documentation search: word forms, typing mistakes and similar words', () => {
  for (const [question, id] of [...FORMS, ...SIMILAR, ...BEGINNER, ...NEW_PAGES]) {
    it(`"${question}" finds ${id} in the first three results`, () => {
      const top = topThree(question)
      expect(top, `top three: ${top.join(', ')}`).toContain(id)
    })
  }
  for (const [question, id, word] of TYPOS) {
    it(`"${question}" is searched as "${word}" and finds ${id} in the first three results`, () => {
      const r = searchDocumentation(question, docs, searchWords)
      expect(r.corrected).toEqual([word])
      const top = r.hits.slice(0, 3).map((h) => h.id)
      expect(top, `top three: ${top.join(', ')}`).toContain(id)
    })
  }
  it('"ram" does not find a page only for the word "random"', () => {
    for (const h of searchDocs('ram', docs, searchWords)) {
      const d = docs.find((x) => x.id === h.id)!
      const text = `${d.title} ${typeof d.keywords === 'string' ? d.keywords : d.keywords.join(' ')} ${d.headings} ${d.body}`.toLowerCase()
      expect(/(^|[^a-z0-9])(ram|memory|storage)([^a-z0-9]|$)/.test(text), h.id).toBe(true)
    }
  })
  it('three words no page has together list the pages with some of them', () => {
    const r = searchDocumentation('singleton faucet producer', docs, searchWords)
    expect(r.partial).toBe(true)
    expect(r.hits.length).toBeGreaterThan(0)
  })
})

describe('the shipped similar-word list', () => {
  it('is read without problems and has the groups the pages need', () => {
    expect(searchWords.groups.length).toBeGreaterThanOrEqual(25)
  })
  it('names every word at most once per group', () => {
    for (const g of searchWords.groups) expect(new Set(g).size, g.join(', ')).toBe(g.length)
  })
})
