import { createRoot } from 'react-dom/client'

function Confirm(): React.JSX.Element {
  return <div style={{ padding: 24, color: '#ddd', fontFamily: 'Segoe UI, sans-serif' }}>No transaction to confirm.</div>
}

createRoot(document.getElementById('root')!).render(<Confirm />)
