import { Modal } from '../components/Modal'

const LABELS: Record<string, string> = {
  contract: 'Contract page',
  account: 'Account page',
  keys: 'Manage Keypairs',
  settings: 'Settings',
  setup: 'Setup',
  build: 'Build',
  deploy: 'Deploy',
  'deploy-to-account': 'Deploy to Account',
  'simulate-deploy': 'Simulate Deploy',
  'create-account': 'Create Account',
  'create-testnet-account': 'Create Testnet Account',
  'manage-keypairs': 'Manage Keypairs',
  'lock-vault': 'Lock Vault',
  'clear-code': 'Clear Contract Code',
  'add-network': 'Add Network',
  'manage-networks': 'Manage Networks',
  'open-transaction': 'Open Transaction by Id',
  'check-updates': 'Check for Updates'
}

export function ComingLater({ what, dialog, onClose }: { what: string; dialog?: boolean; onClose?: () => void }): React.JSX.Element {
  const label = LABELS[what] ?? what
  const text = `${label} is not available in this build yet. It arrives in a later build.`
  if (dialog) {
    return (
      <Modal
        title={label}
        onClose={onClose}
        footer={
          <button className="btn" onClick={onClose}>
            OK
          </button>
        }
      >
        {text}
      </Modal>
    )
  }
  return (
    <div className="coming">
      <h2>{label}</h2>
      <div>{text}</div>
    </div>
  )
}
