# What the app contacts

WAX Master sends nothing anywhere on its own except to the addresses below. It has no account system, no analytics and no telemetry.

## The list

| Address | When | Can be turned off |
|---|---|---|
| The current endpoint of the selected network (another endpoint of the same network when it does not answer) | Reading accounts, contracts, tables, the network state; sending your approved transactions; the status check every 10 seconds while the window is visible (every 2 seconds while the Network page is open) | Choose another network or endpoint |
| The current endpoint of every saved network | While Project Settings is open: the "Deploy to" list of each network asks that network which accounts the public keys of your vault control | Remove the networks you do not use |
| The network's history service | The Transactions list and the token list of the Account page, linked actions when the node does not report them, Open Transaction by Id | Leave the history service empty |
| An address you type in Add Network | When you press Connect | - |
| GitHub (`api.github.com`) | The update check, once a day | File > Settings > Updates |
| The WAX Testnet faucet (`faucet.waxsweden.org`) | Only when you press Create account in Create Testnet Account, or Request tokens, Request test tokens or Request testnet tokens | Do not press them |
| A web page you open | Only after the app shows you the address and you press **Open** | - |
| Microsoft (Windows itself) | When you press Enable WSL in Setup and WSL is not installed: Windows downloads WSL | Do not press it; install WSL yourself |

The two built-in networks start with these addresses; you can change them (see [Endpoints](doc:endpoints)):

- WAX Mainnet: `https://wax.greymass.com`, `https://wax.eosphere.io`, `https://api.waxsweden.org`; history service `https://api.waxsweden.org`.
- WAX Testnet: `https://testnet.waxsweden.org`, `https://waxtestnet.greymass.com`; history service `https://testnet.waxsweden.org`.

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
