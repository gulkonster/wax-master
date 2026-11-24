// The wallet of one account: header with the control badge, the summary band,
// and the sections in a list on the left. Every section shows its data for any
// account; signing buttons work only when the vault controls the account.

import { useCallback, useEffect, useState } from 'react'
import type { AccountView, TokenRow, WalletTokens } from '../../../../shared/chain-types'
import { on, emit } from '../../lib/bus'
import { networkStore } from '../../lib/networks'
import { useStore } from '../../lib/stores'
import { vaultStore } from '../../lib/vault'
import { errorText } from '../../lib/toast'
import { isWaxTestnet } from '../../components/FaucetButton'
import { HelpButton } from '../../components/HelpButton'
import { IconKey } from '../../components/Icons'
import { fmtBytes, fmtTime, fmtUs, Gauge, pct, viewOnlyReason, type WalletContext } from './common'
import { TokensSection } from './TokensSection'
import { TransferSection } from './TransferSection'
import { RamSection } from './RamSection'
import { CpuNetSection } from './CpuNetSection'
import { PermissionsSection } from './PermissionsSection'
import { FaucetSection } from './FaucetSection'
import { TransactionsSection } from './TransactionsSection'

type SectionId = 'tokens' | 'transfer' | 'ram' | 'cpunet' | 'keys' | 'faucet' | 'transactions'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'transfer', label: 'Transfer' },
  { id: 'ram', label: 'RAM' },
  { id: 'cpunet', label: 'CPU / NET' },
  { id: 'keys', label: 'Keys and permissions' },
  { id: 'faucet', label: 'Testnet faucet' },
  { id: 'transactions', label: 'Transactions' }
]

export function AccountBody({ name }: { name: string }): React.JSX.Element {
  const net = useStore(networkStore).current
  const vault = useStore(vaultStore)
  const [view, setView] = useState<AccountView | null>(null)
  const [error, setError] = useState('')
  const [tokens, setTokens] = useState<WalletTokens | null>(null)
  const [tokensError, setTokensError] = useState('')
  const [section, setSection] = useState<SectionId>('tokens')
  const [transferToken, setTransferToken] = useState<TokenRow | null>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      setView(await window.wax.chain.account(name))
    } catch (e) {
      setView(null)
      setError(errorText(e))
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

  if (error) {
    return (
      <div className="page-scroll">
        <div className="error-text wallet-error">{error}</div>
      </div>
    )
  }
  if (!view) return <div className="coming">Loading {name}...</div>

  const viewOnly = view.control.length === 0
  const ctx: WalletContext = { view, viewOnly, reason: viewOnlyReason(view.name), reload }
  const testnet = isWaxTestnet(net)
  const shown = SECTIONS.filter((s) => s.id !== 'faucet' || testnet)
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
            <button key={s.id} className={`wallet-nav-item${s.id === current ? ' active' : ''}`} aria-current={s.id === current} onClick={() => setSection(s.id)}>
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
          {current === 'faucet' && <FaucetSection ctx={ctx} />}
          {current === 'transactions' && <TransactionsSection name={view.name} />}
        </div>
      </div>
    </div>
  )
}
