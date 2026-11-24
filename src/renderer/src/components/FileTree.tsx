import { useEffect, useState } from 'react'
import type { TreeNode } from '../../../shared/api'
import { IconChevronDown, IconChevronRight, IconFile, IconFolder, IconFolderOpen } from './Icons'

export interface TreeMenuAction {
  label: string
  run: () => void
  separatorBefore?: boolean
}

export function FileTree({
  root,
  selected,
  onOpen,
  menuFor
}: {
  root: TreeNode | null
  selected: string | null
  onOpen: (node: TreeNode) => void
  menuFor: (node: TreeNode) => TreeMenuAction[]
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['', 'src', 'include']))
  const [menu, setMenu] = useState<{ x: number; y: number; items: TreeMenuAction[] } | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const toggle = (path: string): void =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(path)) n.delete(path)
      else n.add(path)
      return n
    })

  const row = (node: TreeNode, depth: number): React.ReactNode => {
    const open = expanded.has(node.path)
    return (
      <div key={node.path || '/'}>
        <div
          className={`tree-row${selected === node.path ? ' selected' : ''}`}
          style={{ paddingLeft: 4 + depth * 12 }}
          onClick={() => (node.dir ? toggle(node.path) : onOpen(node))}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, items: menuFor(node) })
          }}
          title={node.path || node.name}
        >
          <span className="twisty">{node.dir ? open ? <IconChevronDown /> : <IconChevronRight /> : null}</span>
          {node.dir ? open ? <IconFolderOpen className="tree-glyph" /> : <IconFolder className="tree-glyph" /> : <IconFile className="tree-glyph" />}
          <span className="tree-name">{node.name}</span>
        </div>
        {node.dir && open && node.children?.map((c) => row(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="tree">
      {root && row(root, 0)}
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {menu.items.map((it) => (
            <div key={it.label}>
              {it.separatorBefore && <div className="cm-sep" />}
              <div
                className="cm-item"
                onClick={() => {
                  setMenu(null)
                  it.run()
                }}
              >
                {it.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
