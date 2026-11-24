import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
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
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          confirm: resolve(__dirname, 'src/renderer/confirm.html')
        }
      }
    }
  }
})
