// Builds the app and the Windows installer into dist/.
import { execSync } from 'node:child_process'

const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
run('npx electron-vite build')
run('npx electron-builder --win --x64 --publish never')
