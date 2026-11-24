# Contributing

Thanks for helping. Bug reports, feature requests and pull requests are welcome.

## Getting started

```powershell
npm ci
node scripts/fetch-toolchain-parts.mjs   # downloads and verifies the toolchain parts (about 235 MB)
npm run dev
```

No C++ compiler is needed: the only native module (`node-pty`) ships prebuilt binaries.

## Layout

| Folder | Content |
|---|---|
| `src/main` | Main process: windows, IPC handlers, projects, toolchain, chain access, vault and signer |
| `src/helper` | Helper process: runs the compiler, terminals and the editor engine; never holds keys |
| `src/preload` | The fixed interfaces exposed to the windows |
| `src/renderer` | The windows (React, Monaco, xterm) |
| `src/chain-core` | Our own Antelope types, ABI engine, transactions, keys and signing |
| `src/shared` | Types and validation shared by the processes |
| `toolchain/parts.json` | Pinned toolchain parts with SHA-256 |
| `test` | Offline tests (`npm test`) |

## Rules for changes

- Keep the dependency list short. A new runtime dependency needs a good reason in the pull request.
- Every IPC handler validates its arguments and its sender.
- Chain data is untrusted: render it as text only. No `innerHTML`, `eval` or `new Function` (a test checks this).
- Nothing may reach a private key except the signer, and nothing may sign without the confirmation window.
- Changes to serialization or signing need tests against the independent implementation in `test/chain-core/criterion-1.test.ts`.
- Run `npm run typecheck` and `npm test` before opening a pull request.

## Releases

Releases are built only by the release workflow from a version tag. See the README section "Verify your download".
