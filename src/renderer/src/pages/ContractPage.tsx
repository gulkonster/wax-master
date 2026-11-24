import { useCallback, useEffect, useState } from 'react'
import type { ContractAbiView } from '../../../shared/chain-types'
import { on, emit } from '../lib/bus'
import { networkStore, toggleStar } from '../lib/networks'
import { useStore } from '../lib/stores'
import { errorText } from '../lib/toast'
import { lastOpened } from '../components/ChainButtons'
import { ActionForm } from '../components/ActionForm'
import { TableView } from '../components/TableView'
import { IconClose, IconContract, IconPlus, IconRefresh, IconStar } from '../components/Icons'

const NAME = /^[a-z1-5.]{1,12}[a-j1-5]?$/

export function ContractPage(): React.JSX.Element {
  const net = useStore(networkStore)
  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [input, setInput] = useState('')

  const open = useCallback((name: string) => {
    if (!NAME.test(name)) return
    setTabs((t) => (t.includes(name) ? t : [...t, name]))
    setActive(name)
    setInput(name)
    lastOpened.set({ ...lastOpened.get(), contract: name })
  }, [])

  useEffect(() => on('open-contract', (n) => open(n as string)), [open])

  const select = (name: string | null): void => {
    setActive(name)
    setInput(name ?? '')
    if (name) lastOpened.set({ ...lastOpened.get(), contract: name })
  }

  const close = (name: string): void => {
    const next = tabs.filter((t) => t !== name)
    setTabs(next)
    if (active === name) select(next[next.length - 1] ?? null)
  }

  const starred = active ? net.stars.includes(active) : false

  return (
    <div className="chain-page">
      <div className="page-tabs">
        {tabs.map((t) => (
          <div key={t} className={`editor-tab${t === active ? ' active' : ''}`} onClick={() => select(t)}>
            {t}
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation()
                close(t)
              }}
            >
              <IconClose size={12} />
            </span>
          </div>
        ))}
        <button className="icon-btn" title="New tab" onClick={() => select(null)}>
          <IconPlus />
        </button>
      </div>
      <div className="address-bar">
        <button className="icon-btn" title="Refresh" onClick={() => active && emit('contract-refresh', active)}>
          <IconRefresh />
        </button>
        <div className="address-input">
          <IconContract size={14} />
          <input
            value={input}
            placeholder="Contract account"
            spellCheck={false}
            onChange={(e) => setInput(e.target.value.trim().toLowerCase())}
            onKeyDown={(e) => e.key === 'Enter' && open(input)}
          />
          <button className={`icon-btn small${starred ? " on" : ""}`} disabled={!active} title={starred ? 'Unstar' : 'Star'} onClick={() => active && void toggleStar(active)}>
            <IconStar filled={starred} />
          </button>
        </div>
      </div>
      {active && net.current ? (
        <ContractBody key={`${net.current.id}:${active}`} name={active} />
      ) : (
        <div className="coming">
          <div>Enter a contract account name and press Enter.</div>
        </div>
      )}
    </div>
  )
}

function ContractBody({ name }: { name: string }): React.JSX.Element {
  const net = useStore(networkStore)
  const [view, setView] = useState<ContractAbiView | null>(null)
  const [error, setError] = useState('')
  // Changing the generation remounts the panes (clears forms and rows).
  const [gen, setGen] = useState(0)

  const load = useCallback(
    async (refresh: boolean) => {
      setError('')
      try {
        setView(await window.wax.contract.abi(name, refresh))
        setGen((g) => g + 1)
      } catch (e) {
        setView(null)
        setError(errorText(e))
      }
    },
    [name]
  )

  useEffect(() => void load(false), [load])
  useEffect(() => on('contract-refresh', (n) => n === name && void load(true)), [name, load])

  if (error) return <div className="page-scroll"><div className="error-text" style={{ margin: 16 }}>{error}</div></div>
  if (!view || !net.current) return <div className="coming">Loading {name}...</div>
  if (!view.hasAbi) {
    return <div className="contract-note">This account has no contract (no ABI) on {net.current.name}</div>
  }
  return (
    <div className="contract-body">
      <ActionForm key={`a${gen}`} account={name} view={view} network={net.current} />
      <TableView key={`t${gen}`} account={name} view={view} />
    </div>
  )
}
