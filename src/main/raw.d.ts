// Text files imported into the main bundle.
declare module '*?raw' {
  const text: string
  export default text
}

// Vite's glob import, as used for the example folders.
interface ImportMeta {
  glob(pattern: string, options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>
}
