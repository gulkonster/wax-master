# Security policy

WAX Master holds private keys and signs transactions, so security reports are welcome and handled first.

## Reporting a vulnerability

Please report privately through GitHub: **Security > Report a vulnerability** on this repository (private vulnerability reporting). Do not open a public issue for a vulnerability.

Include what you found, the steps to reproduce it, the version (Help > About) and what an attacker could do with it.

## What is in scope

- Anything that lets a transaction be signed without the confirmation window, or signs something other than what the confirmation showed.
- Ways to read private keys or the vault password, or to keep the vault unlocked when it should lock.
- Ways for a project folder, a chain endpoint or chain data (ABIs, table rows, Ricardian text, error messages) to run code or change what the app does.
- Problems with the release workflow or the installer verification.

## How the app protects keys

- Private keys are stored in `%APPDATA%\WAX Master\vault.json`, each encrypted with AES-256-GCM under a key derived from your password with scrypt (N=2^17, r=8, p=1).
- Decrypted keys exist only inside the signer in the main process, only while the vault is unlocked, and are wiped after each use.
- The vault locks when Windows sleeps, when Windows is locked, after inactivity, and when the app closes.
- Every signature goes through a separate confirmation window. The signer signs exactly the bytes that were decoded for that window and sends them only to the endpoint shown there. An approval is used once and expires with the transaction.
- Editor windows run sandboxed with context isolation and a strict content security policy. They have no file system or network access of their own.
- Showing a private key asks for the vault password again, in its own window, hides the key after 30 seconds, and never unlocks the vault.
- The app sends nothing anywhere except to the chain endpoints you choose, the GitHub release check (can be turned off), the WAX Testnet faucet (https://faucet.waxsweden.org) when you press Create Testnet Account, and pages you open yourself.

## Known limits

- Malware running as your Windows user can read the screen, log keystrokes or read process memory; no desktop app can prevent that.
- Windows' own crash reporting is outside the app's control.
- Installers are not code-signed yet; verify them as described in the README.
