# WAX Master

A desktop studio for writing, building, deploying and using smart contracts on WAX and any other Antelope chain. Install it, open it, and build your first contract without Docker and without a terminal.

Windows 10 22H2 or Windows 11, x64.

## What it does

- **Projects and editor**: contract projects with a C++ editor that understands contract code (completion, live errors, go to definition into the CDT headers, find references, rename, formatting).
- **Build**: WAX CDT runs in a private Linux environment (WSL) that the app sets up by itself from files inside the installer. One button or Ctrl+B. Errors appear in the editor and in Problems.
- **Terminal**: a real integrated terminal (PowerShell, Command Prompt, and a Linux shell with the toolchain), so Git and your other tools work as usual.
- **Networks**: WAX Mainnet and WAX Testnet built in; add any Antelope chain by its API address.
- **Accounts and contracts**: balances, resources, permissions and history of any account; call any action of any contract with typed forms; browse contract tables.
- **Keys**: generate or import keys into an encrypted vault (password, scrypt and AES-256-GCM). It locks when Windows sleeps or locks and after inactivity.
- **Transactions you can check**: every signature is shown in a separate confirmation window that decodes the exact bytes to be signed: network, chain id, endpoint, account, permission, actions, and for a deployment the SHA-256 of the WASM and ABI. Simulate runs a transaction without sending it (unsigned) and shows the full trace in the transaction inspector.
- **Deploy**: build and deploy from a button. The deploy checks what is already on the account, skips unchanged parts, estimates RAM, and warns when the contract uses host functions the chain has not activated.

## Install

1. Download `WAX-Master-Setup-<version>.exe` and `SHA256SUMS.txt` from the [releases page](https://github.com/gulkonster/wax-master/releases). This is the only official download location.
2. Verify the download (next section).
3. Run the installer. It installs for your Windows user and needs no administrator rights. The installers are not code-signed yet, so Windows SmartScreen shows "Windows protected your PC": choose **More info**, then **Run anyway**.

## Verify your download

Every release installer is built by the public [release workflow](.github/workflows/release.yml) from the tagged source, and GitHub records a signed build-provenance attestation for the exact file.

1. Quick check: in PowerShell, in the folder with the download:

   ```powershell
   Get-FileHash .\WAX-Master-Setup-<version>.exe -Algorithm SHA256
   ```

   The hash must equal the line for this file in `SHA256SUMS.txt` on the release page.

2. Full check (needs the [GitHub CLI](https://cli.github.com/)):

   ```powershell
   gh attestation verify .\WAX-Master-Setup-<version>.exe -R gulkonster/wax-master
   ```

   A pass means this exact file was built by this repository's release workflow from the tagged commit. A changed byte makes it fail.

What a pass proves: where the file came from and which source it was built from. It does not prove the software has no bugs.

## First start

The Setup screen checks four things and fixes what it can:

1. **Windows**: version and x64.
2. **WSL**: if WSL is not enabled, "Enable WSL" asks for administrator permission once, Windows downloads WSL (internet needed), and a restart follows. Then open WAX Master again.
3. **Toolchain**: the app verifies the SHA-256 of every bundled part, creates a private WSL distribution and installs WAX CDT and the editor engine into it, offline, in about a minute.
4. **Test build**: builds a sample contract.

"Skip" keeps editing, chain work and the terminal available; building and code intelligence need the toolchain.

Then: **New > Hello World**, and **Ctrl+B**.

Existing EOS Studio projects open as they are (File > Open Project); settings are taken from `.eosproj`, except its build script.

## Security limits

- A computer that is already infected cannot be made safe by this app.
- Keep the owner keys of valuable accounts out of the app. Use dedicated permissions for deploying and daily actions.
- When the vault is created you get a recovery code, shown once: keep it away from this computer. With it, "Forgot password?" on the unlock prompt sets a new password. Without the password and the code the keys cannot be opened, so also export a backup (Manage Keypairs > Vault > Export vault; encrypted with the same password) or back up single keys.
- The terminal is your own shell; commands you run there act with your rights.
- A project's custom build command runs only after you approve it, and runs with your rights inside the toolchain environment.
- Simulation runs against the current chain state and skips authorization checks, so a real transaction can still fail.
- Verify installers as described above before first use.
- A copied private key stays in Windows clipboard history (Win+V) or in clipboard tools if you use them; the app clears only the normal clipboard after 30 seconds.
- Networks you add yourself count as mainnet (red confirmation, typed account names) unless they are marked as test networks; the WAX Mainnet chain id is always treated as mainnet.
- The app contacts only the chain endpoints you choose, the GitHub release check (can be turned off), and the WAX Testnet faucet (https://faucet.waxsweden.org) when you press Create Testnet Account or Request test tokens.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Build from source

Requirements: Node.js 24, Git, Windows x64.

```powershell
npm ci
node scripts/fetch-toolchain-parts.mjs
npm run dev
```

- `npm test`: offline tests, including the release checks for transaction correctness (compared with an independent implementation and real WAX transactions) and approval integrity.
- `npm run dist`: Windows installer in `dist/`.
- `npm run check:doc-samples`: builds every C++ sample of the help pages with the installed toolchain (needs WSL and Help > Setup; not part of `npm test`).

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT, see [LICENSE](LICENSE). Third-party software: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Built with the help of AI coding tools. Design, decisions and real-device testing by gulkonster.
