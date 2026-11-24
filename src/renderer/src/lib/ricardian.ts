// Contract > Create Ricardian Files: builds when the stored build is not up to
// date, writes or extends the Ricardian files from the ABI, then opens the
// contracts file at the first new section.

import { emit } from './bus'
import { ensureBuild } from './build'
import { errorText, toast } from './toast'

let running = false

export async function createRicardianFiles(showPanel: (tab: 'output' | 'problems') => void, showProject: () => void): Promise<void> {
  if (running) return
  running = true
  try {
    const check = await ensureBuild(showPanel)
    if (!check || check.build?.needsApproval) return
    if (check.result === 'failed' || check.result === null) {
      toast('Build failed', 'Create Ricardian Files reads the actions from the built ABI. Fix the build errors first.', 'error')
      showPanel('problems')
      return
    }
    const r = await window.wax.ricardian.create()
    toast('Ricardian files', r.message, 'success')
    showProject()
    emit('reveal', { file: r.contractsFile, line: r.line, column: 1 })
  } catch (e) {
    toast('Could not create the Ricardian files', errorText(e), 'error')
  } finally {
    running = false
  }
}
