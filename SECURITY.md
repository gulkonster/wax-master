# Security policy

WAX Master holds private keys and signs transactions, so security reports are welcome and handled first.

## Reporting a vulnerability

Please report privately through GitHub: **Security > Report a vulnerability** on this repository (private vulnerability reporting). Do not open a public issue for a vulnerability.

Include what you found, the steps to reproduce it, the version (Help > About) and what an attacker could do with it.

## What is in scope

- Anything that lets a transaction be signed without the confirmation window, or signs something other than what the confirmation showed.
- Ways to read private keys, the vault password or the recovery code, or to keep the vault unlocked when it should lock.
- Ways for a project folder, a chain endpoint or chain data (ABIs, table rows, Ricardian text, error messages) to run code or change what the app does.
- Problems with the release workflow or the installer verification.

## How the app protects keys

- Private keys are stored in `%APPDATA%\WAX Master\vault.json` (file version 2), each encrypted with AES-256-GCM under a random vault key. The vault key is stored twice, wrapped: once under a key derived from your password and once under a key derived from the recovery code, each with scrypt (N=2^17, r=8, p=1) and its own salt. Either opens the vault; removing the recovery code leaves only the password.
- The recovery code is shown once, in its own window, masked until you show it; a lock hides it. A version 1 vault is converted at the first unlock, and the old file is kept once as `vault.v1.bak.json`. Reset (forgotten password without the code) moves the vault to `vault-old-<date>.json`. These kept copies still hold your keys, encrypted under the old password; Clear All App Data with the vault option deletes them too.
- A single-key backup file is written only from its own window after the vault password; it holds the private key as readable text, never replaces an existing file, and the app asks again when the folder is synced to a cloud service.
- Decrypted keys exist only inside the signer in the main process, only while the vault is unlocked, and are wiped after each use.
- The vault locks when Windows sleeps, when Windows is locked, after inactivity, and when the app closes.
- Every signature goes through a separate confirmation window. The signer signs exactly the bytes that were decoded for that window and sends them only to the endpoint shown there. An approval is used once and expires with the transaction.
- Editor windows run sandboxed with context isolation and a strict content security policy. They have no file system or network access of their own.
- Showing a private key asks for the vault password again, in its own window, hides the key after 30 seconds, and never unlocks the vault.
- The app sends nothing anywhere except to the endpoints and history services of the networks in your network list, the GitHub release check (can be turned off), the WAX Testnet faucet (https://faucet.waxsweden.org) when you press Create Testnet Account or a request-tokens button, and pages you open yourself. The help page "What the app contacts" (Help > Documentation) lists every case and the addresses of the built-in networks.
- Links in the built-in documentation open a web page only after the app shows the address and you press **Open**; its command buttons run only fixed menu commands without parameters.

## Known limits

- Malware running as your Windows user can read the screen, log keystrokes or read process memory; no desktop app can prevent that.
- Windows' own crash reporting is outside the app's control.
- Installers are not code-signed yet; verify them as described in the README.
