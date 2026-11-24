// Colours for the code editor and terminal themes, one object per theme.
// Those theme objects cannot read CSS custom properties, so each value here
// mirrors one token of styles.css (named in the comment): DARK the tokens of
// `:root`, LIGHT the tokens of `:root[data-theme='light']` (a token the light
// block does not redefine keeps its `:root` value). Change both together.

export interface ThemeColors {
  content: string
  text: string
  textStrong: string
  text2: string
  textDisabled: string
  lineNumber: string
  comment: string
  accent: string
  flyout: string
  borderControl: string
  scrollThumb: string
  scrollThumbHover: string
  selection: string
  lineHighlight: string
  listHover: string
  accentTint: string
  findMatch: string
}

export const DARK: ThemeColors = {
  /** --bg-content */
  content: '#1F1F1F',
  /** --text */
  text: '#E4E4E4',
  /** --text-strong */
  textStrong: '#FFFFFF',
  /** --text-2 */
  text2: '#BDBDBD',
  /** --text-disabled */
  textDisabled: '#6E6E6E',
  /** editor line numbers: 5.1 : 1 on --bg-content (no token) */
  lineNumber: '#8A8A8A',
  /** editor comments: 4.9 : 1 on --bg-content (no token) */
  comment: '#6A9955',
  /** --accent */
  accent: '#DE8334',
  /** --bg-flyout */
  flyout: '#2B2B2B',
  /** --border-control */
  borderControl: '#404040',
  /** --scroll-thumb */
  scrollThumb: '#4D4D4D',
  /** --scroll-thumb-hover */
  scrollThumbHover: '#6B6B6B',
  /** neutral selection: white at 14% */
  selection: '#FFFFFF24',
  /** current line: white at 4% */
  lineHighlight: '#FFFFFF0A',
  /** --hover in lists: white at 6% */
  listHover: '#FFFFFF0F',
  /** --accent-tint (16%) */
  accentTint: '#DE833429',
  /** accent at 33% for find matches */
  findMatch: '#DE833455'
}

export const LIGHT: ThemeColors = {
  /** --bg-content */
  content: '#FFFFFF',
  /** --text */
  text: '#1F1F1F',
  /** --text-strong */
  textStrong: '#000000',
  /** --text-2 */
  text2: '#4A4A4A',
  /** --text-disabled */
  textDisabled: '#A0A0A0',
  /** editor line numbers: 5.1 : 1 on --bg-content (no token) */
  lineNumber: '#6E6E6E',
  /** editor comments: 5.1 : 1 on --bg-content (no token) */
  comment: '#008000',
  /** --accent */
  accent: '#DE8334',
  /** --bg-flyout */
  flyout: '#FFFFFF',
  /** --border-control */
  borderControl: '#C8C8C8',
  /** --scroll-thumb */
  scrollThumb: '#C1C1C1',
  /** --scroll-thumb-hover */
  scrollThumbHover: '#9E9E9E',
  /** neutral selection: black at 13% */
  selection: '#00000021',
  /** current line: black at 4% */
  lineHighlight: '#0000000A',
  /** --hover in lists: black at 5% */
  listHover: '#0000000D',
  /** --accent-tint (16%) */
  accentTint: '#DE833429',
  /** accent at 33% for find matches */
  findMatch: '#DE833455'
}

export const THEMES = { dark: DARK, light: LIGHT } as const

/**
 * Terminal colours 0-15 for the light theme (no tokens): the default terminal
 * colours are made for a dark background, so yellow, white and the bright
 * colours would be unreadable on white. The dark theme keeps the defaults.
 */
export const TERMINAL_ANSI_LIGHT = {
  black: '#000000',
  red: '#CD3131',
  green: '#107C10',
  yellow: '#7A5600',
  blue: '#0451A5',
  magenta: '#BC05BC',
  cyan: '#0E7490',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#B3261E',
  brightGreen: '#1B6E36',
  brightYellow: '#7A5600',
  brightBlue: '#1A5A9E',
  brightMagenta: '#A000A0',
  brightCyan: '#0E7490',
  brightWhite: '#333333'
} as const
