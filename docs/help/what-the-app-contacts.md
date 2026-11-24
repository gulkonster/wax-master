# What the app contacts

WAX Master sends nothing anywhere on its own except to the addresses below. It has no account system, no analytics and no telemetry.

## The list

| Address | When | Can be turned off |
|---|---|---|
| The current endpoint of the selected network | Reading accounts, contracts, tables, the network state; sending your approved transactions; the status check every 10 seconds while the window is visible | Choose another network or endpoint |
| The network's history service | The Transactions list of the Account page, Open Transaction by Id | Leave the history service empty |
| An address you type in Add Network | When you press Connect | - |
| GitHub (`api.github.com`) | The update check, once a day | File > Settings > Updates |
| The WAX Testnet faucet (`faucet.waxsweden.org`) | Only when you press Create account in Create Testnet Account, or Request tokens / Request testnet tokens | Do not press them |
| A web page you open | Only after the app shows you the address and you press **Open** | - |

## What stays on this computer

- Your projects (in their own folders).
- Settings, networks and stars: `%APPDATA%\WAX Master`.
- The vault with your keys: `%APPDATA%\WAX Master\vault.json`, encrypted.
- The toolchain: `%LOCALAPPDATA%\WAX Master`.

Building and editing work without any network. The toolchain installs offline from the installer.

## How to do it here

- Turn off the update check: File > Settings > Updates. Help > Check for Updates still works when you press it.
- Remove all app data: File > Settings > Data > **Clear All App Data...**. Your projects are never touched; the vault is removed only if you tick that option.

[Open Settings](app:settings) [Check for Updates](app:check-updates)

## Example

You work offline on a train: editing and building work. The network dot turns red because the endpoint is not reachable; the Contract and Account pages show the network error. Nothing is lost.

## What is needed

Nothing. The update check only shows a notice; nothing is downloaded or installed by it.
