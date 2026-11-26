# Contributing

Thanks for helping. Bug reports, feature requests and pull requests are welcome.

## Getting started

```powershell
npm ci                                   # package install scripts are off (.npmrc)
node node_modules/electron/install.js    # downloads the Electron binary
node scripts/fetch-toolchain-parts.mjs   # downloads and verifies the toolchain parts (about 235 MB)
npm run dev
```

No C++ compiler is needed: the only native module (`node-pty`) ships prebuilt binaries, so its install script is not needed.

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

## Documentation pictures

The pictures in `docs/help/img` (each screen in the dark and the light theme) are made by one command, never by hand:

```powershell
npm run build
npm run shots                    # all screens, a few minutes
npm run shots -- --only deploy   # some screens (names joined by commas); the run still goes through the steps before them
```

- It needs Windows with WSL 2 and Help > Setup done once on the computer (the toolchain installed). Close WAX Master first: the run stops when another WAX Master is open.
- It starts the development build with its own data folder `C:\wax-shots\data` and projects folder `C:\wax-shots\projects`, and deletes both at the end. Its vault password is made at random and kept only in memory.
- It uses the local chain of the computer as it finds it and never resets it. It adds the accounts `gameaccount<c>`, `player<cccccc>` and `shopaccount<c>` (the first set that is still free: the last character is 1 to 5, then a to z; after those, `gameacct<cdcd>`, `player<cdcdcd>` and `shopacct<cdcd>` with two such characters) and the token `GOLD`, and signs only there. A stopped chain is stopped again at the end; a chain that was not set up is set up and removed again. When no set is free, the run stops and asks for a Reset of the chain by hand.
- Every step has a time limit. On a failure the run names the step, saves a picture of the window to `C:\wax-shots\failed.png` and closes the app.

A change that alters a screen shown in the documentation retakes its picture in the same change.

## Releases

Releases are built only by the release workflow from a version tag. See the README section "Verify your download".
