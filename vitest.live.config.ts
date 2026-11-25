import { defineConfig } from 'vitest/config'

// The scripted editor check: starts the editor engine in the toolchain distro.
// Run with `npm run check:editor`; it is not part of `npx vitest run`.
export default defineConfig({
  test: {
    include: ['test/live/**/*.live.ts'],
    environment: 'node',
    testTimeout: 120000,
    hookTimeout: 120000,
    fileParallelism: false,
    disableConsoleIntercept: true
  }
})
