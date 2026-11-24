import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { installWindowErrorReports } from './lib/window-errors'

installWindowErrorReports()
createRoot(document.getElementById('root')!).render(<App />)
