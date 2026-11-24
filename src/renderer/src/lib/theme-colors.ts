// Colours for the code editor and terminal themes. Those theme objects cannot
// read CSS custom properties, so each value here mirrors one token of `:root`
// in styles.css (named in the comment). Change both together.

export const THEME = {
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
} as const
