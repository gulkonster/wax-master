// Filters of the Transactions list: an action name and a time range. The page
// turns local days into UTC times; the main process checks the filter and
// turns it into the query of the history service.

import type { AccountActionsFilter } from './chain-types'

const ACTION = /^[a-z1-5.]{1,12}[a-j1-5]?$/
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z$/
const DAY = /^\d{4}-\d\d-\d\d$/

/** Rows per page of the Transactions list. */
export const ACTIONS_PAGE = 20

/** The start of a local day ("2026-11-24") as a UTC time; '' when it is not a day. */
export function dayStart(day: string): string {
  if (!DAY.test(day)) return ''
  const d = new Date(`${day}T00:00:00`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/** The end of a local day as a UTC time (the last millisecond); '' when it is not a day. */
export function dayEnd(day: string): string {
  if (!DAY.test(day)) return ''
  const d = new Date(`${day}T23:59:59.999`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

function isTime(v: string): boolean {
  return ISO_UTC.test(v) && !Number.isNaN(new Date(v).getTime())
}

/**
 * The filter checked: the action a valid name, the times UTC ISO times, the
 * start not after the end. Throws with the reason otherwise. Absent and empty
 * values mean no filter.
 */
export function checkActionsFilter(raw: unknown): AccountActionsFilter {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('filter: expected an object')
  const o = raw as Record<string, unknown>
  const out: AccountActionsFilter = {}
  for (const key of ['action', 'after', 'before'] as const) {
    const v = o[key]
    if (v === undefined || v === null || v === '') continue
    if (typeof v !== 'string' || v.length > 32) throw new Error(`filter.${key}: expected short text`)
    if (key === 'action' ? !ACTION.test(v) : !isTime(v)) throw new Error(`filter.${key}: not a valid ${key === 'action' ? 'action name' : 'time'}`)
    out[key] = v
  }
  if (out.after && out.before && new Date(out.after).getTime() > new Date(out.before).getTime()) throw new Error('filter: the start is after the end')
  return out
}

/**
 * The query text of a checked filter for the history service's get_actions:
 * `filter=*:<action>` (any contract, this action name), `after` and `before`.
 */
export function actionsQuery(f: AccountActionsFilter): string {
  let q = ''
  if (f.action) q += `&filter=${encodeURIComponent(`*:${f.action}`)}`
  if (f.after) q += `&after=${encodeURIComponent(f.after)}`
  if (f.before) q += `&before=${encodeURIComponent(f.before)}`
  return q
}

/** Number of pages for a total of rows (0 when the total is not known). */
export function pageCount(total: number, perPage = ACTIONS_PAGE): number {
  return total > 0 ? Math.ceil(total / perPage) : 0
}

/** The filter of the Transactions fields (action, first and last local day), or the reason it cannot be used. */
export function filterOf(action: string, from: string, to: string): { filter: AccountActionsFilter } | { problem: string } {
  const a = action.trim()
  if (a && !ACTION.test(a)) return { problem: 'The action is not a valid action name (for example transfer).' }
  const after = from ? dayStart(from) : ''
  const before = to ? dayEnd(to) : ''
  if ((from && !after) || (to && !before)) return { problem: 'Enter the dates as days.' }
  if (after && before && after > before) return { problem: 'The first day is after the last day.' }
  return { filter: { ...(a ? { action: a } : {}), ...(after ? { after } : {}), ...(before ? { before } : {}) } }
}
