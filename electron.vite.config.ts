import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import pkg from './package.json'

function commit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

const stage = Number(pkg.version.split('.')[1] ?? 0)
/**
 * Dev server only: lets the page reach the dev server (HMR socket), and lets
 * the editor page (127.0.0.1) embed the terminal page from the second host
 * name (localhost), a different origin. Never applied to a build.
 */
function devConnectSrc(): Plugin {
  return {
    name: 'dev-connect-src',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html
        .replace(
          "connect-src 'none'",
          "connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*"
        )
        .replace('frame-src app://terminal', 'frame-src http://localhost:*')
  }
}


export default defineConfig({
  main: {
    define: {
      __APP_COMMIT__: JSON.stringify(commit()),
      __APP_STAGE__: JSON.stringify(stage)
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          helper: resolve(__dirname, 'src/helper/index.ts')
        },
        external: ['node-pty']
      }
    }
  },
  preload: {
    build: {
      // Each sandboxed preload must be one file: shared code is inlined, not split into a chunk.
      isolatedEntries: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          confirm: resolve(__dirname, 'src/preload/confirm.ts')
        },
        output: { format: 'cjs' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), devConnectSrc()],
    // The editor page is served as 127.0.0.1 and the terminal page as localhost.
    server: { host: '127.0.0.1' },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          confirm: resolve(__dirname, 'src/renderer/confirm.html'),
          terminal: resolve(__dirname, 'src/renderer/terminal.html')
        }
      }
    }
  }
})
