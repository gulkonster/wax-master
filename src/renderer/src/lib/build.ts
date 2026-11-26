// Build from the window: saves open files, runs the build, fills Output and Problems.

import type { BuildCheck, BuildResult } from '../../../shared/api'
import { emit } from './bus'
import { appendOutput, clearOutput, problemsStore, recordBuiltVersions, refreshMerged } from './stores'
import { errorText, toast } from './toast'
import { networkStore } from './networks'

let running = false

/** The key of the build notice: "Building..." is replaced by the result (E60). */
const BUILD_NOTICE = 'build'
let buildingName = ''

/** A build started (Build, Rebuild, or Deploy's check): the notice says so until it ends. */
export function buildStarted(name: string): void {
  buildingName = name
  toast('Building contract...', name ? `Building ${name}...` : 'Building the project...', 'progress', BUILD_NOTICE)
}

/** The first error of a failed build, as the notice shows it. */
function firstError(r: BuildResult): string {
  const errors = r.problems.filter((p) => p.severity === 'error')
  if (errors.length === 0) return 'See Output for the reason.'
  const e = errors[0]
  const where = e.file ? `${e.file}${e.line ? `:${e.line}` : ''}: ` : ''
  return `${errors.length} error(s). First: ${where}${e.message}`
}

/** Replaces the "Building..." notice with the result. */
function buildEnded(r: BuildResult | null, startError?: string): void {
  const name = buildingName ? `${buildingName}: ` : ''
  if (startError !== undefined) toast('Build failed', `${name}the build could not start. ${startError}`, 'error', BUILD_NOTICE)
  else if (!r) return
  else if (r.needsApproval) toast('Build cancelled', 'The custom build command was not approved.', 'info', BUILD_NOTICE)
  else if (r.outcome === 'abi-not-deployable') toast('Built, ABI not deployable', `${name}the ABI check explains the cause and the fix in Output and Problems.`, 'error', BUILD_NOTICE)
  else if (r.ok) toast('Build completed', `${name}${r.outputs.join(', ')} (${(r.durationMs / 1000).toFixed(1)} s)`, 'success', BUILD_NOTICE)
  else toast('Build failed', name + firstError(r), 'error', BUILD_NOTICE)
}

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
    const r = await window.wax.build.run(networkStore.get().current?.id)
    if (r.needsApproval) {
      appendOutput('Build cancelled: the custom build command was not approved.\n')
      buildEnded(r)
      return r
    }
    problemsStore.set(r.problems)
    refreshMerged()
    emit('problems-updated')
    buildEnded(r)
    if (!r.ok && r.problems.length) showPanel('problems')
    return r
  } catch (e) {
    appendOutput(`${errorText(e)}\n`)
    buildEnded(null, errorText(e))
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
/** `networkId`: the network the build is for (E64: its testnet or mainnet build); default the selected one. */
export async function ensureBuild(showPanel: (tab: 'output' | 'problems') => void, always = false, networkId?: string): Promise<BuildCheck | null> {
  if (running) return null
  running = true
  try {
    await saveAll()
    recordBuiltVersions()
    if (always) {
      clearOutput()
      showPanel('output')
    }
    const net = networkId ?? networkStore.get().current?.id
    const r = always ? await window.wax.build.rebuild(net) : await window.wax.build.ensure(net)
    if (r.build) {
      buildEnded(r.build)
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
    buildEnded(null, errorText(e))
    return null
  } finally {
    running = false
  }
}
