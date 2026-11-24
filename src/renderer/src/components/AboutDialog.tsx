import { useApp } from '../state'
import { Modal } from './Modal'

export function AboutDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { state } = useApp()
  const i = state.info
  return (
    <Modal
      title="About WAX Master"
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div style={{ userSelect: 'text', lineHeight: 1.7 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>WAX Master</div>
        <div>Version {i?.version}</div>
        <div>
          Commit <span className="code-tag">{i?.commit}</span>
        </div>
        <div>Mainnet signing: {i?.mainnetSigning ? 'on' : 'off in this build'}</div>
        <div style={{ marginTop: 12, color: 'var(--text-2)' }}>
          Open-source studio for Antelope smart contracts, made for WAX. MIT license.
        </div>
        <div style={{ marginTop: 8 }}>
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
