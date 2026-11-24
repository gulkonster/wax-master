// The 36 px title bar of the main window: app icon, the menu bar drawn from the
// shared menu model, and the window title. Windows draws the caption buttons to
// the right of it. A click on a menu item calls the same function the `menu`
// event from the main process calls; nothing new reaches the main process.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MenuCommand } from '../../../shared/api'
import { MENU_MODEL, shortcutText, type MenuModelItem, type MenuRole } from '../../../shared/menu-model'
import { monaco } from '../lib/monaco'
import { on } from '../lib/bus'
import { networkStore, selectNetwork } from '../lib/networks'
import { useStore } from '../lib/stores'
import { toast } from '../lib/toast'
import { useApp } from '../state'
import { AppIcon, IconCheck, IconChevronRight } from './Icons'

/** One drawn menu entry, resolved from the model for the current state. */
interface VItem {
  label: string
  sep?: boolean
  disabled?: boolean
  checked?: boolean
  mainnet?: boolean
  shortcut?: string
  items?: VItem[]
  run?: () => void
}

/** Where the keyboard focus and selection were when the menu opened (for the Edit items). */
interface FocusTarget {
  element: Element | null
  editor: monaco.editor.ICodeEditor | null
}

const EDITOR_ACTION: Record<Exclude<MenuRole, 'paste'>, string> = {
  undo: 'undo',
  redo: 'redo',
  cut: 'editor.action.clipboardCutAction',
  copy: 'editor.action.clipboardCopyAction',
  delete: 'deleteRight',
  selectAll: 'editor.action.selectAll'
}

function editableField(el: Element | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el
  if (el instanceof HTMLInputElement) {
    const textual = ['text', 'search', 'url', 'email', 'tel', 'password', 'number', ''].includes(el.type)
    return textual && !el.readOnly && !el.disabled ? el : null
  }
  return null
}

function captureFocus(): FocusTarget {
  const editor = monaco.editor.getEditors().find((e) => e.hasTextFocus()) ?? null
  return { element: document.activeElement, editor }
}

function runRole(role: MenuRole, target: FocusTarget): void {
  if (role === 'paste') {
    toast('Paste with Ctrl+V', 'The menu cannot read the clipboard.')
    return
  }
  if (target.editor) {
    const ed = target.editor
    ed.focus()
    const id = EDITOR_ACTION[role]
    const action = ed.getAction(id)
    if (action) void action.run()
    else ed.trigger('menu', id, null)
    return
  }
  const field = editableField(target.element)
  if (!field) return
  field.focus()
  document.execCommand(role === 'selectAll' ? 'selectAll' : role)
}

const isItem = (v: VItem): boolean => !v.sep && !v.disabled

export function TitleBar({ run, exit }: { run: (cmd: MenuCommand) => void; exit: () => void }): React.JSX.Element {
  const { state } = useApp()
  const nets = useStore(networkStore)
  /** Index of the open menu, or null. */
  const [open, setOpen] = useState<number | null>(null)
  /** True while the menu bar has the keyboard (F10, Alt, or a menu opened). */
  const [active, setActive] = useState(false)
  /** Label that has the keyboard while no menu is open. */
  const [hot, setHot] = useState(0)
  /** Highlighted item in the open menu, and in its open submenu. */
  const [sel, setSel] = useState(-1)
  const [sub, setSub] = useState<{ index: number; sel: number } | null>(null)
  const target = useRef<FocusTarget>({ element: null, editor: null })
  /** Where the keyboard focus goes back to when the bar is left with Esc. */
  const restoreTo = useRef<Element | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const labelRefs = useRef<(HTMLButtonElement | null)[]>([])
  /** True once the current Alt press has seen a mouse click or another key: its release is not a menu key. */
  const altUsed = useRef(false)

  const editable = (): boolean => !!target.current.editor || !!editableField(target.current.element)

  const resolve = (item: MenuModelItem): VItem => {
    switch (item.kind) {
      case 'separator':
        return { label: '', sep: true }
      case 'command':
        return { label: item.label, shortcut: item.accelerator && shortcutText(item.accelerator), run: () => run(item.command) }
      case 'role':
        return {
          label: item.label,
          shortcut: item.shortcut,
          disabled: item.role !== 'paste' && !editable(),
          run: () => runRole(item.role, target.current)
        }
      case 'link':
        return { label: item.label, run: () => void window.wax.app.openExternal(item.url) }
      case 'exit':
        return { label: item.label, run: exit }
      case 'network-list':
        return {
          label: item.label,
          items: nets.list.map((n) => ({
            label: n.name,
            checked: n.id === nets.current?.id,
            mainnet: n.kind === 'mainnet',
            run: () => {
              if (n.id !== nets.current?.id) void selectNetwork(n.id)
            }
          }))
        }
      case 'submenu':
        return { label: item.label, items: item.items.map(resolve) }
    }
  }

  const menus = MENU_MODEL.map((m) => ({ label: m.label, items: m.items.map(resolve) }))

  const firstItem = (items: VItem[], from = 0, step = 1): number => {
    const n = items.length
    for (let k = 0; k < n; k++) {
      const i = (((from + k * step) % n) + n) % n
      if (isItem(items[i])) return i
    }
    return -1
  }

  const openMenu = (i: number, highlightFirst: boolean): void => {
    setOpen(i)
    setHot(i)
    // With the keyboard on the bar, the focus follows the open menu's label.
    if (active) labelRefs.current[i]?.focus()
    setSub(null)
    setSel(highlightFirst ? firstItem(menus[i].items) : -1)
  }

  /** Leaves the menu bar; with `restore`, the keyboard goes back to where it was. */
  const leave = useCallback((restore: boolean) => {
    setOpen(null)
    setSub(null)
    setSel(-1)
    setActive(false)
    const back = restoreTo.current
    restoreTo.current = null
    if (restore && back instanceof HTMLElement && back.isConnected) back.focus()
  }, [])

  /** Takes the keyboard: focus moves to the bar so keys reach it from any frame. */
  const takeKeyboard = (index: number): void => {
    if (!restoreTo.current) restoreTo.current = document.activeElement
    setActive(true)
    labelRefs.current[index]?.focus()
  }

  const activate = (item: VItem | undefined, level: 0 | 1): void => {
    if (!item || !isItem(item)) return
    if (item.items) {
      if (level === 0 && sel >= 0) setSub({ index: sel, sel: firstItem(item.items) })
      return
    }
    // Close first and give the focus back, then run: a dialog opened by the
    // command keeps the focus it takes when it appears.
    leave(true)
    item.run?.()
  }

  // F10 or an Alt tap (sent by the main process as `focus-menu`).
  useEffect(
    () =>
      on('focus-menu', () => {
        if (altUsed.current) return
        if (active) {
          leave(true)
          return
        }
        target.current = captureFocus()
        setHot(0)
        takeKeyboard(0)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, leave]
  )

  // Alt+click in the editor adds a cursor, and Alt with another key is a shortcut:
  // neither counts as an Alt tap. A new Alt press starts clean.
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (e.altKey) altUsed.current = true
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') {
        if (!e.repeat) altUsed.current = false
      } else if (e.altKey) altUsed.current = true
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [])

  // A click anywhere else closes the menus.
  useEffect(() => {
    if (open === null && !active) return
    const h = (e: MouseEvent): void => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) leave(false)
    }
    const blur = (): void => leave(false)
    window.addEventListener('mousedown', h)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('mousedown', h)
      window.removeEventListener('blur', blur)
    }
  }, [open, active, leave])

  // Keyboard while the bar is active or a menu is open (capture phase, before the editor and dialogs).
  useEffect(() => {
    if (open === null && !active) return
    const h = (e: KeyboardEvent): void => {
      const key = e.key
      const consume = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }
      if (key === 'Alt' || key === 'Control' || key === 'Shift') return
      if (key === 'Tab') {
        consume()
        leave(true)
        return
      }
      const count = menus.length
      if (open === null) {
        // On the bar.
        if (key === 'ArrowRight' || key === 'ArrowLeft') {
          consume()
          const next = (hot + (key === 'ArrowRight' ? 1 : count - 1)) % count
          setHot(next)
          labelRefs.current[next]?.focus()
        } else if (key === 'ArrowDown' || key === 'Enter' || key === ' ') {
          consume()
          openMenu(hot, true)
        } else if (key === 'Escape') {
          consume()
          leave(true)
        } else if (key === 'Home' || key === 'End') {
          consume()
          const next = key === 'Home' ? 0 : count - 1
          setHot(next)
          labelRefs.current[next]?.focus()
        } else if (key.length === 1 && !e.ctrlKey && !e.altKey) {
          consume()
          const i = menus.findIndex((m) => m.label[0].toLowerCase() === key.toLowerCase())
          if (i >= 0) openMenu(i, true)
        }
        return
      }
      const items = menus[open].items
      const subItems = sub ? (items[sub.index]?.items ?? []) : null
      const list = subItems ?? items
      const cur = subItems ? sub!.sel : sel
      const setCur = (i: number): void => (subItems ? setSub({ index: sub!.index, sel: i }) : setSel(i))
      consume()
      switch (key) {
        case 'ArrowDown':
          setCur(firstItem(list, cur + 1, 1))
          break
        case 'ArrowUp':
          setCur(firstItem(list, cur < 0 ? list.length - 1 : cur - 1, -1))
          break
        case 'Home':
          setCur(firstItem(list, 0, 1))
          break
        case 'End':
          setCur(firstItem(list, list.length - 1, -1))
          break
        case 'ArrowRight':
          if (!subItems && cur >= 0 && items[cur]?.items && isItem(items[cur])) setSub({ index: cur, sel: firstItem(items[cur].items!) })
          else openMenu((open + 1) % count, true)
          break
        case 'ArrowLeft':
          if (subItems) setSub(null)
          else openMenu((open + count - 1) % count, true)
          break
        case 'Enter':
        case ' ':
          if (subItems) activate(subItems[cur], 1)
          else activate(items[cur], 0)
          break
        case 'Escape':
          if (subItems) setSub(null)
          else {
            setOpen(null)
            setSel(-1)
            if (active) labelRefs.current[open]?.focus()
            else leave(true)
          }
          break
        default:
          if (key.length === 1 && !e.ctrlKey && !e.altKey) {
            const n = list.length
            for (let k = 1; k <= n; k++) {
              const i = (cur + k + n) % n
              if (isItem(list[i]) && list[i].label.toLowerCase().startsWith(key.toLowerCase())) {
                setCur(i)
                break
              }
            }
          }
      }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  })

  const onLabelDown = (e: React.MouseEvent, i: number): void => {
    e.preventDefault()
    if (e.button !== 0) return
    if (open === i) {
      leave(active)
      return
    }
    if (open === null && !active) {
      target.current = captureFocus()
      // A frame (the terminal) keeps its keys to itself; take the keyboard so the arrows work.
      if (document.activeElement instanceof HTMLIFrameElement) takeKeyboard(i)
    }
    openMenu(i, false)
  }

  const title = state.project ? `${state.project.name} - WAX Master` : 'WAX Master'

  const renderItems = (items: VItem[], level: 0 | 1, current: number, setCurrent: (i: number) => void): React.ReactNode =>
    items.map((it, i) =>
      it.sep ? (
        <div key={`s${i}`} className="dd-sep" role="separator" />
      ) : (
        <div
          key={it.label}
          role={it.checked !== undefined ? 'menuitemradio' : 'menuitem'}
          aria-checked={it.checked}
          aria-disabled={it.disabled || undefined}
          aria-haspopup={it.items ? 'menu' : undefined}
          aria-expanded={it.items ? level === 0 && sub?.index === i : undefined}
          className={`dd-item${i === current ? ' hot' : ''}${it.disabled ? ' disabled' : ''}${it.checked ? ' current' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => {
            setCurrent(i)
            if (level === 0) setSub(it.items && !it.disabled ? { index: i, sel: -1 } : null)
          }}
          onClick={() => {
            if (it.items) {
              if (level === 0 && !it.disabled) setSub({ index: i, sel: firstItem(it.items) })
              return
            }
            activate(it, level)
          }}
        >
          <span className="dd-lead">{it.checked && <IconCheck />}</span>
          <span className={`dd-label${it.mainnet ? ' mainnet-text' : ''}`}>{it.label}</span>
          {it.shortcut && <span className="dd-key">{it.shortcut}</span>}
          {it.items && (
            <span className="dd-sub">
              <IconChevronRight size={12} />
            </span>
          )}
          {it.items && level === 0 && sub?.index === i && (
            <div className="dropdown submenu" role="menu" onMouseDown={(e) => e.preventDefault()}>
              {it.items.length === 0 ? (
                <div className="dd-note">No networks</div>
              ) : (
                renderItems(it.items, 1, sub.sel, (k) => setSub({ index: i, sel: k }))
              )}
            </div>
          )}
        </div>
      )
    )

  return (
    <div className={`titlebar${open !== null || active ? ' engaged' : ''}${active ? ' keys' : ''}`}>
      <div className="titlebar-icon" aria-hidden="true">
        <AppIcon />
      </div>
      <div className="menubar" role="menubar" ref={barRef}>
        {menus.map((m, i) => (
          <div key={m.label} className="menubar-item">
            <button
              ref={(el) => {
                labelRefs.current[i] = el
              }}
              className={`menubar-label${open === i ? ' open' : ''}`}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open === i}
              tabIndex={active && hot === i ? 0 : -1}
              onMouseDown={(e) => onLabelDown(e, i)}
              onMouseEnter={() => open !== null && open !== i && openMenu(i, false)}
              onFocus={() => setHot(i)}
            >
              {m.label}
            </button>
            {open === i && (
              <div className="dropdown menubar-menu" role="menu" aria-label={m.label} onMouseDown={(e) => e.preventDefault()}>
                {renderItems(m.items, 0, sel, setSel)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="titlebar-title" title={title}>
        {title}
      </div>
    </div>
  )
}
