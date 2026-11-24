import { useApp } from '../state'
import { Modal } from './Modal'
import { AppLogo } from './Icons'

export function AboutDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { state } = useApp()
  const i = state.info
  return (
    <Modal
      size="s"
      name="about"
      help="about"
      title="About WAX Master"
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div style={{ userSelect: 'text', lineHeight: 'var(--lh-card)' }}>
        <AppLogo size={64} />
        <div style={{ fontSize: 'var(--fs-card)', fontWeight: 600 }}>WAX Master</div>
        <div>Version {i?.version}</div>
        <div>
          Commit <span className="code-tag">{i?.commit}</span>
        </div>
        <div>Mainnet signing: {i?.mainnetSigning ? 'on' : 'off in this build'}</div>
        <div style={{ marginTop: 'var(--sp-3)', color: 'var(--text-2)' }}>
          Open-source studio for Antelope smart contracts, made for WAX. MIT license.
        </div>
        <div style={{ marginTop: 'var(--sp-2)' }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              void window.wax.app.openExternal('https://github.com/gulkonster/wax-master')
            }}
            style={{ color: 'var(--accent-text)' }}
          >
            github.com/gulkonster/wax-master
          </a>
        </div>
      </div>
    </Modal>
  )
}
