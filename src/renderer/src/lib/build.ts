// Build from the window: saves open files, runs the build, fills Output and Problems.

import type { BuildCheck, BuildResult } from '../../../shared/api'
import { emit } from './bus'
import { appendOutput, clearOutput, problemsStore, recordBuiltVersions, refreshMerged } from './stores'
import { errorText, toast } from './toast'

let running = false

/** Asks the editor to save all files and waits until it reports back. */
function saveAll(): Promise<void> {
  return new Promise((resolve) => emit('save-all-then', resolve))
}

export async function startBuild(showPanel: (tab: 'output' | 'problems') => void): Promise<BuildResult | null> {
  if (running) return null
  running = true
  try {
    await saveAll()
    recordBuiltVersions()
    clearOutput()
    showPanel('output')
    const r = await window.wax.build.run()
    if (r.needsApproval) {
      appendOutput('Build cancelled: the custom build command was not approved.\n')
      return r
    }
    problemsStore.set(r.problems)
    refreshMerged()
    emit('problems-updated')
    if (r.outcome === 'abi-not-deployable') {
      toast('Built, ABI not deployable', 'The ABI check explains the cause and the fix in Output and Problems.', 'error')
    } else if (r.ok) toast('Build succeeded', r.outputs.join(', '), 'success')
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

/**
 * Build if needed (Deploy, Check, Simulate Deploy) or always (Rebuild): saves
 * open files first, as Build does. When a build ran, Output and Problems are
 * filled as for Build; when the stored build is up to date, nothing is compiled
 * and the stored ABI findings are put back into Problems.
 */
export async function ensureBuild(showPanel: (tab: 'output' | 'problems') => void, always = false): Promise<BuildCheck | null> {
  if (running) return null
  running = true
  try {
    await saveAll()
    recordBuiltVersions()
    if (always) {
      clearOutput()
      showPanel('output')
    }
    const r = always ? await window.wax.build.rebuild() : await window.wax.build.ensure()
    if (r.build) {
      if (r.build.needsApproval) {
        appendOutput('Build cancelled: the custom build command was not approved.\n')
        return r
      }
      problemsStore.set(r.build.problems)
    } else {
      // Up to date: keep the other problems, refresh the ABI ones.
      problemsStore.set([...problemsStore.get().filter((p) => p.source !== 'abi'), ...r.abiProblems])
    }
    refreshMerged()
    emit('problems-updated')
    return r
  } catch (e) {
    appendOutput(`${errorText(e)}\n`)
    toast('Build could not start', errorText(e), 'error')
    return null
  } finally {
    running = false
  }
}
