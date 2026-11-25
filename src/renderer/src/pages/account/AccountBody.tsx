// The wallet of one account: header with the control badge, the summary band,
// and the sections in a list on the left. Every section shows its data for any
// account; signing buttons work only when the vault controls the account.

import { useCallback, useEffect, useState } from 'react'
import type { AccountView, SystemFeatures, TokenRow, WalletTokens } from '../../../../shared/chain-types'
import { on, emit } from '../../lib/bus'
import { networkStore } from '../../lib/networks'
import { useStore } from '../../lib/stores'
import { vaultStore } from '../../lib/vault'
import { errorText } from '../../lib/toast'
import { isWaxTestnet } from '../../components/FaucetButton'
import { HelpButton } from '../../components/HelpButton'
import { IconKey } from '../../components/Icons'
import { fmtBytes, fmtTime, fmtUs, Gauge, pct, useReadsAfterSend, viewOnlyReason, type WalletContext } from './common'
import { missingAccountText, NEW_ACCOUNT_WAIT_TEXT, newAccountRead, nextNewAccountRead } from './wallet-form'
import { TokensSection } from './TokensSection'
import { TransferSection } from './TransferSection'
import { RamSection } from './RamSection'
import { CpuNetSection } from './CpuNetSection'
import { PermissionsSection } from './PermissionsSection'
import { FaucetSection } from './FaucetSection'
import { LocalTokensSection } from './LocalTokensSection'
import { LOCAL_CHAIN_NETWORK_ID } from '../../../../shared/local-chain'
import { TransactionsSection } from './TransactionsSection'
import { LinksSection } from './LinksSection'
import { ContractSection } from './ContractSection'
import { CreateAccountSection } from './CreateAccountSection'
import { VotingSection } from './VotingSection'
import { PowerupSection } from './PowerupSection'
import { NameBidsSection } from './NameBidsSection'

type SectionId = 'tokens' | 'transfer' | 'ram' | 'cpunet' | 'keys' | 'links' | 'contract' | 'create' | 'namebids' | 'voting' | 'powerup' | 'faucet' | 'localtokens' | 'transactions'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'transfer', label: 'Transfer' },
  { id: 'ram', label: 'RAM' },
  { id: 'cpunet', label: 'CPU / NET' },
  { id: 'keys', label: 'Keys and permissions' },
  { id: 'links', label: 'Linked actions' },
  { id: 'contract', label: 'Contract' },
  { id: 'create', label: 'Create account' },
  { id: 'namebids', label: 'Name bids' },
  { id: 'voting', label: 'Voting and rewards' },
  { id: 'powerup', label: 'PowerUp' },
  { id: 'faucet', label: 'Testnet faucet' },
  { id: 'localtokens', label: 'Local tokens' },
  { id: 'transactions', label: 'Transactions' }
]

// The open section of each account tab ("<network id>:<account>"), for this session only:
// a tab that is shown again opens where it was left.
const openSections = new Map<string, SectionId>()

/** Forgets the open section of a closed account tab. */
export function forgetAccountSection(key: string): void {
  openSections.delete(key)
}

export function AccountBody({ name }: { name: string }): React.JSX.Element {
  const net = useStore(networkStore).current
  const sectionKey = `${net?.id ?? ''}:${name}`
  const vault = useStore(vaultStore)
  const [view, setView] = useState<AccountView | null>(null)
  const [error, setError] = useState('')
  const [tokens, setTokens] = useState<WalletTokens | null>(null)
  const [tokensError, setTokensError] = useState('')
  const [section, setSectionState] = useState<SectionId>(() => openSections.get(sectionKey) ?? 'tokens')
  const setSection = (id: SectionId): void => {
    openSections.set(sectionKey, id)
    setSectionState(id)
  }
  const [transferToken, setTransferToken] = useState<TokenRow | null>(null)
  // A name won in Name bids, filled into Create account when that section is opened from there.
  const [createName, setCreateName] = useState('')
  // Sections offered by the chain's system contract; hidden until the chain says it has them.
  const [system, setSystem] = useState<SystemFeatures>({ voting: false, powerup: false, nameBids: false })
  useEffect(() => {
    let live = true
    window.wax.wallet.system().then(
      (f) => live && setSystem(f),
      () => live && setSystem({ voting: false, powerup: false, nameBids: false })
    )
    return () => {
      live = false
    }
  }, [net?.id])

  // An account created a moment ago may not be on the node yet: it is read again a few times
  // (NEW_ACCOUNT_READS_MS) with a plain line before a failed read is shown.
  const [waitingNew, setWaitingNew] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  const load = useCallback(async () => {
    setError('')
    try {
      setView(await window.wax.chain.account(name))
      newAccountRead(name)
      setWaitingNew(false)
    } catch (e) {
      setView(null)
      const wait = nextNewAccountRead(name)
      if (wait === null) {
        setWaitingNew(false)
        const text = errorText(e)
        setError(missingAccountText(text, name, networkStore.get().current?.name ?? 'this network') ?? text)
      } else {
        setWaitingNew(true)
        setTimeout(() => setRetryTick((t) => t + 1), wait)
      }
    }
  }, [name])

  const loadTokens = useCallback(async () => {
    setTokensError('')
    try {
      setTokens(await window.wax.wallet.tokens(name))
    } catch (e) {
      setTokensError(errorText(e))
    }
  }, [name])

  const reload = useCallback(() => {
    void load()
    void loadTokens()
  }, [load, loadTokens])

  // After a sent transaction: account, tokens and stakes at once, after 1.5 s and after 4 s; the Transactions list with the last.
  const [readTick, setReadTick] = useState(0)
  const [txTick, setTxTick] = useState(0)
  const afterSend = useReadsAfterSend(
    () => {
      reload()
      setReadTick((t) => t + 1)
    },
    () => setTxTick((t) => t + 1)
  )

  // Read again when the vault's keys change: the badge follows them.
  useEffect(() => {
    reload()
  }, [reload, vault.keys])

  useEffect(
    () =>
      on('account-refresh', (n) => {
        if (n === name) reload()
      }),
    [name, reload]
  )

  useEffect(() => {
    if (retryTick > 0) reload()
  }, [retryTick, reload])

  if (error) {
    return (
      <div className="page-scroll">
        <div className="error-text wallet-error">{error}</div>
      </div>
    )
  }
  if (!view) return <div className="coming">{waitingNew ? NEW_ACCOUNT_WAIT_TEXT : `Loading ${name}...`}</div>

  const viewOnly = view.control.length === 0
  const ctx: WalletContext = { view, viewOnly, reason: viewOnlyReason(view.name), reload, afterSend, readTick }
  const testnet = isWaxTestnet(net)
  const localChain = net?.id === LOCAL_CHAIN_NETWORK_ID
  const shown = SECTIONS.filter(
    (s) => (s.id !== 'faucet' || testnet) && (s.id !== 'localtokens' || localChain) && (s.id !== 'voting' || system.voting) && (s.id !== 'powerup' || system.powerup) && (s.id !== 'namebids' || system.nameBids)
  )
  const current = shown.some((s) => s.id === section) ? section : 'tokens'

  return (
    <div className="page-scroll">
      <div className="wallet-head">
        <div className="wallet-title">
          <h2 className="mono">{view.name}</h2>
          {view.created && <span className="wallet-created">Created {fmtTime(view.created)}</span>}
          <HelpButton place="walletOverview" />
        </div>
        {viewOnly ? (
          <div className="control-badge view-only">
            <span>View only: no key of this account is in the vault.</span>
            <button className="btn subtle sm" onClick={() => emit('open-keys', view.name)}>
              <IconKey size="sm" /> Import key
            </button>
          </div>
        ) : (
          <div className="control-badge controlled" title="The vault's keys reach the threshold of these permissions">
            <IconKey size="sm" /> You control: {view.control.join(', ')}
          </div>
        )}
      </div>

      <div className="wallet-summary">
        <div className="sum-card">
          <span className="sum-label">Total balance</span>
          <span className="sum-value">{view.total}</span>
        </div>
        <div className="sum-card">
          <span className="sum-label">Available</span>
          <span className="sum-value">{view.liquid}</span>
        </div>
        <div className="sum-card">
          <span className="sum-label">Staked (CPU / NET)</span>
          <span className="sum-value">{view.staked}</span>
          <span className="sum-sub">
            CPU {view.cpuSelf} / NET {view.netSelf}
          </span>
        </div>
        <div className="sum-card">
          <span className="sum-label">Refunding</span>
          <span className="sum-value">{view.refund}</span>
          <span className="sum-sub">{view.stakedByOthers} staked by others</span>
        </div>
        <div className="sum-card sum-gauges">
          <Gauge label="RAM" text={`${fmtBytes(view.ram.usage)} / ${fmtBytes(view.ram.quota)}`} value={pct(view.ram.usage, view.ram.quota)} />
          <Gauge label="CPU" text={`${fmtUs(view.cpu.used)} / ${fmtUs(view.cpu.max)}`} value={pct(view.cpu.used, view.cpu.max)} />
          <Gauge label="NET" text={`${fmtBytes(view.net.used)} / ${fmtBytes(view.net.max)}`} value={pct(view.net.used, view.net.max)} />
        </div>
      </div>

      <div className="wallet-layout">
        <nav className="wallet-nav" aria-label="Wallet sections">
          {shown.map((s) => (
            <button
              key={s.id}
              className={`wallet-nav-item${s.id === current ? ' active' : ''}`}
              aria-current={s.id === current}
              onClick={() => {
                setSection(s.id)
                setCreateName('')
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="wallet-content">
          {current === 'tokens' && (
            <TokensSection
              ctx={ctx}
              tokens={tokens}
              error={tokensError}
              reloadTokens={() => void loadTokens()}
              onTransfer={(t) => {
                setTransferToken(t)
                setSection('transfer')
              }}
            />
          )}
          {current === 'transfer' && <TransferSection ctx={ctx} tokens={tokens} initial={transferToken} />}
          {current === 'ram' && <RamSection ctx={ctx} />}
          {current === 'cpunet' && <CpuNetSection ctx={ctx} />}
          {current === 'keys' && <PermissionsSection ctx={ctx} />}
          {current === 'links' && <LinksSection ctx={ctx} />}
          {current === 'contract' && <ContractSection ctx={ctx} />}
          {current === 'create' && <CreateAccountSection key={createName} ctx={ctx} initialName={createName} />}
          {current === 'namebids' && (
            <NameBidsSection
              ctx={ctx}
              onCreate={(n) => {
                setCreateName(n)
                setSection('create')
              }}
            />
          )}
          {current === 'voting' && <VotingSection ctx={ctx} />}
          {current === 'powerup' && <PowerupSection ctx={ctx} />}
          {current === 'faucet' && <FaucetSection ctx={ctx} />}
          {current === 'localtokens' && <LocalTokensSection ctx={ctx} />}
          {current === 'transactions' && <TransactionsSection name={view.name} refresh={txTick} />}
        </div>
      </div>
    </div>
  )
}
