// Small inline icon set (no icon font or package). One style: 16 x 16 view
// box, 1.25 px outlines in the current text colour, round caps and joins.
// Filled shapes only where the fill carries a state (starred, play, hearts).

import type { CSSProperties } from 'react'

/** Icon sizes of the scale (styles.css): xs 14, sm 16, default 18 (rows and buttons), lg 20 (top bar). */
export type IconSize = 'xs' | 'sm' | 'lg'

interface P {
  size?: IconSize
  style?: CSSProperties
  className?: string
}

function Svg({ size, style, className, children }: P & { children: React.ReactNode }): React.JSX.Element {
  const classes = ['icon', size ? `icon-${size}` : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={classes}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const IconPlus = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Svg>
)
export const IconHammer = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6.5 6.5l4-4 3 3-4 4zM8 8l-5.5 5.5" />
  </Svg>
)
/** Deploy: an arrow up out of a tray. */
export const IconDeploy = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 10.5v-8M5 5.5l3-3 3 3M2.5 10.5v3h11v-3" />
  </Svg>
)
export const IconGear = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12.25 6L14.25 6.5L14.25 9.5L12.25 10L13.5 11.25L11.25 13.5L10 12.25L9.5 14.25L6.5 14.25L6 12.25L4.75 13.5L2.5 11.25L3.75 10L1.75 9.5L1.75 6.5L3.75 6L2.5 4.75L4.75 2.5L6 3.75L6.5 1.75L9.5 1.75L10 3.75L11.25 2.5L13.5 4.75z" />
    <circle cx="8" cy="8" r="2" />
  </Svg>
)
export const IconFolder = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M1.5 4.5v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5h-4a1 1 0 0 0-1 1z" />
  </Svg>
)
export const IconFolderOpen = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M1.5 12.5v-8a1 1 0 0 1 1-1h4L8 5h4.5a1 1 0 0 1 1 1v1.5M1.5 12.5l2-5h11l-2 5z" />
  </Svg>
)
export const IconFile = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3" />
  </Svg>
)
export const IconFileCode = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3M6.5 8L5 9.5 6.5 11M9.5 8L11 9.5 9.5 11" />
  </Svg>
)
export const IconChevronDown = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4.5 6.5L8 10l3.5-3.5" />
  </Svg>
)
export const IconChevronRight = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6.5 4.5L10 8l-3.5 3.5" />
  </Svg>
)
export const IconCheck = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Svg>
)
export const IconStar = ({ filled, ...p }: P & { filled?: boolean }): React.JSX.Element => (
  <Svg {...p}>
    <path
      d="M8 2L9.75 6.25L14.25 6.5L10.75 9.5L11.75 13.75L8 11.5L4.25 13.75L5.25 9.5L1.75 6.5L6.25 6.25z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </Svg>
)
export const IconKey = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="5.5" cy="10.5" r="3" />
    <path d="M7.6 8.4l5.9-5.9M11.5 4.5L13 6M10 6l1.5 1.5" />
  </Svg>
)
export const IconLock = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3.5" y="7.5" width="9" height="6.5" rx="1" />
    <path d="M5.5 7.5v-2a2.5 2.5 0 0 1 5 0v2" />
  </Svg>
)
export const IconUser = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3 13.5c.6-2.5 2.6-4 5-4s4.4 1.5 5 4" />
  </Svg>
)
export const IconContract = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3.5" y="1.5" width="9" height="13" rx="1" />
    <path d="M6 5h4M6 7.5h4M6 10h2.5" />
  </Svg>
)
export const IconGlobe = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.5" />
    <ellipse cx="8" cy="8" rx="2.75" ry="6.5" />
    <path d="M1.5 8h13" />
  </Svg>
)
export const IconClose = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </Svg>
)
export const IconTerminal = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
    <path d="M4.5 6l2 2-2 2M8 10.5h3.5" />
  </Svg>
)
export const IconError = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M6 6l4 4M10 6l-4 4" />
  </Svg>
)
export const IconWarning = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5v.01" />
  </Svg>
)
export const IconInfo = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M8 7.5v4M8 5v.01" />
  </Svg>
)
export const IconRefresh = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M12.5 1.5v3h-3" />
  </Svg>
)
export const IconHome = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M2.5 7.5L8 2.5l5.5 5M4 6.5v7h3V10h2v3.5h3v-7" />
  </Svg>
)
export const IconList = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
  </Svg>
)
export const IconPencil = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M10.5 2.5l3 3-8 8h-3v-3zM9 4l3 3" />
  </Svg>
)
export const IconPlay = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4.5 2.5v11l9-5.5z" fill="currentColor" />
  </Svg>
)
export const IconHeart = ({ filled, ...p }: P & { filled?: boolean }): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 13.5L2.6 8.3a3.2 3.2 0 0 1 4.6-4.5l.8.8.8-.8a3.2 3.2 0 0 1 4.6 4.5z" fill={filled ? 'currentColor' : 'none'} />
  </Svg>
)
export const IconClock = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M8 4.5V8l2.5 1.5" />
  </Svg>
)
export const IconTable = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
    <path d="M1.5 6h13M1.5 9.5h13M6 6v7.5" />
  </Svg>
)
export const IconCopy = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
    <path d="M10.5 5.5v-3a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3" />
  </Svg>
)
/** Three dots: more actions of a row. */
export const IconMore = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="3.5" cy="8" r="0.9" fill="currentColor" />
    <circle cx="8" cy="8" r="0.9" fill="currentColor" />
    <circle cx="12.5" cy="8" r="0.9" fill="currentColor" />
  </Svg>
)
/** The f of f(x): an action. */
export const IconFunction = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M11 2.5h-1a2 2 0 0 0-2 2v7a2 2 0 0 1-2 2H5M5.5 7h5" />
  </Svg>
)
export const IconArrowUp = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Svg>
)
export const IconArrowDown = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Svg>
)
export const IconArrowLeft = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M13 8H3M7 4L3 8l4 4" />
  </Svg>
)
export const IconArrowRight = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Svg>
)
/** A question mark in a circle: opens the documentation of the place. */
export const IconHelp = (p: P): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M6.2 6.3a1.9 1.9 0 0 1 3.7.4c0 1.3-1.9 1.6-1.9 2.8M8 11.5v.01" />
  </Svg>
)

const LOGO_LETTER = '0.15,0.25 0.28,0.25 0.36,0.58 0.44,0.25 0.56,0.25 0.64,0.58 0.72,0.25 0.85,0.25 0.71,0.75 0.59,0.75 0.5,0.43 0.41,0.75 0.29,0.75'
// The small form scales the letters 1.2 times about the face centre.
const LOGO_SMALL_SCALE = 'translate(0.5 0.5) scale(1.2) translate(-0.5 -0.5)'

/**
 * The application logo: an isometric cube with a W on the left face, the same letter turned upside down
 * (an M) on the right face and lines of code on the top face. Same drawing as build/icon.svg (large) and
 * build/icon-small.svg (small: three code lines and larger letters, for 16 to 24 px).
 */
function Logo({ small, className, size }: { small: boolean; className: string; size?: number }): React.JSX.Element {
  const scale = small ? `${LOGO_SMALL_SCALE} ` : ''
  return (
    <svg viewBox="0 0 180 180" className={className} width={size} height={size} aria-hidden="true">
      <g transform="translate(-80,-80)">
        <polygon className="logo-top" points="170,80 247.9,125 170,170 92.1,125" />
        <polygon className="logo-left" points="92.1,125 170,170 170,260 92.1,215" />
        <polygon className="logo-right" points="170,170 247.9,125 247.9,215 170,260" />
        <g transform="matrix(77.9,45,0,90,92.1,125)">
          <polygon className="logo-w" transform={small ? LOGO_SMALL_SCALE : undefined} points={LOGO_LETTER} />
        </g>
        <g transform="matrix(77.9,-45,0,90,170,170)">
          <polygon className="logo-m" transform={`${scale}rotate(180 0.5 0.5)`} points={LOGO_LETTER} />
        </g>
        <g className="logo-lines" transform="matrix(77.9,-45,77.9,45,92.1,125)">
          {small ? (
            <>
              <rect x="0.2" y="0.22" width="0.42" height="0.13" rx="0.06" />
              <rect x="0.32" y="0.44" width="0.48" height="0.13" rx="0.06" />
              <rect x="0.32" y="0.66" width="0.3" height="0.13" rx="0.06" />
            </>
          ) : (
            <>
              <rect x="0.2" y="0.2" width="0.42" height="0.075" rx="0.035" />
              <rect x="0.32" y="0.34" width="0.48" height="0.075" rx="0.035" />
              <rect x="0.32" y="0.48" width="0.28" height="0.075" rx="0.035" />
              <rect x="0.44" y="0.62" width="0.36" height="0.075" rx="0.035" />
              <rect x="0.2" y="0.76" width="0.22" height="0.075" rx="0.035" />
            </>
          )}
        </g>
      </g>
    </svg>
  )
}

/** The logo in the title bar (small form); its size is --app-icon. */
export function AppIcon(): React.JSX.Element {
  return <Logo small className="app-icon" />
}

/** The logo (large form) on Home and in About; pass the size in px. */
export function AppLogo({ size }: { size: number }): React.JSX.Element {
  return <Logo small={false} className="app-logo" size={size} />
}
