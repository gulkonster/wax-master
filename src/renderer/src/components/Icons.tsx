// Small inline icon set (no icon font or package).

import type { CSSProperties } from 'react'

interface P {
  size?: number
  style?: CSSProperties
  className?: string
}

function Svg({ size = 16, style, className, children, viewBox = '0 0 16 16' }: P & { children: React.ReactNode; viewBox?: string }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill="currentColor" style={style} className={className} aria-hidden="true">
      {children}
    </svg>
  )
}

export const IconPlus = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M7 2h2v5h5v2H9v5H7V9H2V7h5z" />
  </Svg>
)
export const IconHammer = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M9.5 1.5l5 5-1.4 1.4-1.1-1.1-1.8 1.8-1.6-1.6L1.9 13.7.3 12.1l6.7-6.7L5.4 3.8l1.8-1.8L8.1 1z" />
  </Svg>
)
export const IconShip = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M7 1h2v2h3v4l2.5 1-2 5H3.5l-2-5L4 7V3h3zm-1 4v1.4L8 5.6l2 .8V5zM1 14.5c1.2 0 1.8-.6 2.5-.6s1.3.6 2.5.6 1.8-.6 2.5-.6 1.3.6 2.5.6 1.8-.6 2.5-.6.8.3 1.5.5V16c-.8-.2-1-.5-1.5-.5-.7 0-1.3.6-2.5.6s-1.8-.6-2.5-.6-1.3.6-2.5.6-1.8-.6-2.5-.6-1.3.6-2.5.6z" />
  </Svg>
)
export const IconGear = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6.8 1h2.4l.4 1.9 1.2.5 1.6-1.1 1.7 1.7-1.1 1.6.5 1.2 1.9.4v2.4l-1.9.4-.5 1.2 1.1 1.6-1.7 1.7-1.6-1.1-1.2.5-.4 1.9H6.8l-.4-1.9-1.2-.5-1.6 1.1-1.7-1.7 1.1-1.6-.5-1.2L.6 9.2V6.8l1.9-.4.5-1.2-1.1-1.6 1.7-1.7 1.6 1.1 1.2-.5zM8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z" />
  </Svg>
)
export const IconFolder = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M1 3h5l1.5 1.5H15V13H1z" />
  </Svg>
)
export const IconFolderOpen = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M1 3h5l1.5 1.5H13V6H3.5L1 12zm2.8 4H16l-2.6 6H1.2z" />
  </Svg>
)
export const IconFile = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3 1h6l4 4v10H3zm6 1v3h3" />
  </Svg>
)
export const IconFileCode = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3 1h6.5L13 4.5V15H3zm1 1v12h8V5H9V2zm1.6 6.2L7 6.8l.7.7-.7.7.7.7-.7.7.7.7zm4.8 0L9 9.6l-.7-.7.7-.7-.7-.7.7-.7z" />
  </Svg>
)
export const IconChevronDown = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3.5 6h9L8 11z" />
  </Svg>
)
export const IconChevronRight = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6 3.5v9L11 8z" />
  </Svg>
)
export const IconStar = ({ filled, ...p }: P & { filled?: boolean }): React.JSX.Element => (
  <Svg {...p}>
    {filled ? (
      <path d="M8 1l2.1 4.5 4.9.6-3.6 3.3 1 4.8L8 11.8l-4.4 2.4 1-4.8L1 6.1l4.9-.6z" />
    ) : (
      <path d="M8 1l2.1 4.5 4.9.6-3.6 3.3 1 4.8L8 11.8l-4.4 2.4 1-4.8L1 6.1l4.9-.6zm0 2.4L6.6 6.4l-3.3.4 2.4 2.2-.6 3.2L8 10.6l2.9 1.6-.6-3.2 2.4-2.2-3.3-.4z" />
    )}
  </Svg>
)
export const IconKey = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M10.5 1a4.5 4.5 0 11-1.6 8.7L7.6 11H6v1.5H4.5V14H1v-2.9l5.3-5.3A4.5 4.5 0 0110.5 1zm1 2a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
  </Svg>
)
export const IconUser = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 1a3.5 3.5 0 110 7 3.5 3.5 0 010-7zM1.5 15c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5z" />
  </Svg>
)
export const IconContract = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3 1h10v14H3zm2 3v1h6V4zm0 3v1h6V7zm0 3v1h4v-1z" />
  </Svg>
)
export const IconGlobe = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm0 1.5c-.8 0-1.8 1.7-2.1 4.5h4.2C9.8 4.2 8.8 2.5 8 2.5zM4.4 7c.1-1.7.5-3.1 1-4A5.5 5.5 0 002.6 7zm7.2 0h1.8a5.5 5.5 0 00-2.8-4c.5.9.9 2.3 1 4zM2.6 9a5.5 5.5 0 002.8 4c-.5-.9-.9-2.3-1-4zm3.3 0c.3 2.8 1.3 4.5 2.1 4.5s1.8-1.7 2.1-4.5zm5.7 0c-.1 1.7-.5 3.1-1 4a5.5 5.5 0 002.8-4z" />
  </Svg>
)
export const IconClose = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4.2 3.1L8 6.9l3.8-3.8 1.1 1.1L9.1 8l3.8 3.8-1.1 1.1L8 9.1l-3.8 3.8-1.1-1.1L6.9 8 3.1 4.2z" />
  </Svg>
)
export const IconTerminal = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M1 2h14v12H1zm1.5 1.5v9h11v-9zM4 5l3 3-3 3-.8-.8L5.4 8 3.2 5.8zm4 5h4v1H8z" />
  </Svg>
)
export const IconError = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 1a7 7 0 110 14A7 7 0 018 1zM5.6 4.5L4.5 5.6 6.9 8l-2.4 2.4 1.1 1.1L8 9.1l2.4 2.4 1.1-1.1L9.1 8l2.4-2.4-1.1-1.1L8 6.9z" />
  </Svg>
)
export const IconWarning = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 1l7.5 13.5H.5zm-.8 4.5v4.5h1.6V5.5zm0 5.8V13h1.6v-1.7z" />
  </Svg>
)
export const IconRefresh = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M13.5 2v4.5H9l1.7-1.7A4 4 0 104.3 10l-1.4.8A5.6 5.6 0 1111.8 3.7z" />
  </Svg>
)
export const IconHome = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 1l7 6h-2v7H9.5v-4h-3v4H3V7H1z" />
  </Svg>
)
export const IconList = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M1 2h3v3H1zm5 .5h9v2H6zM1 6.5h3v3H1zM6 7h9v2H6zm-5 4h3v3H1zm5 .5h9v2H6z" />
  </Svg>
)
export const IconPencil = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M11.5 1.5l3 3-9 9H2.5v-3zm-1 2.4L4 10.4l1.6 1.6 6.5-6.5z" />
  </Svg>
)
