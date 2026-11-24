// Build from the window: saves open files, runs the build, fills Output and Problems.

import type { BuildResult } from '../../../shared/api'
import { emit } from './bus'
import { appendOutput, clearOutput, problemsStore } from './stores'
import { errorText, toast } from './toast'

let running = false

/** Asks the editor to save all files and waits until it reports back. */
function saveAll(): Promise<void> {
  return new Promise((resolve) => emit('save-all-then', resolve))
}

export async function startBuild(showPanel: (tab: 'output' | 'problems') => void, approveCommand?: string): Promise<BuildResult | null> {
  if (running) return null
  running = true
  try {
    await saveAll()
    clearOutput()
    showPanel('output')
    const r = await window.wax.build.run(approveCommand)
    if (r.needsApproval && r.command) {
      emit('build-approval', r.command)
      return r
    }
    problemsStore.set(r.problems)
    emit('problems-updated')
    if (r.ok) toast('Build succeeded', r.outputs.join(', '), 'success')
    else {
      toast('Build failed', `${r.problems.filter((p) => p.severity === 'error').length} error(s)`, 'error')
      if (r.problems.length) showPanel('problems')
    }
    return r
  } catch (e) {
    appendOutput(`${errorText(e)}\n`)
    toast('Build could not start', errorText(e), 'error')
    return null
  } finally {
    running = false
  }
}
