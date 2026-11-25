# Mainnet and testnet

A network is one chain, reached through one or more API endpoints and known by its chain id. Every network in WAX Master has a kind:

| Kind | Meaning | Signing |
|---|---|---|
| mainnet | Tokens have real value | Red confirmation; deploys and permission changes need the account name typed |
| testnet | A test chain, tokens have no value | Normal confirmation |
| local | A chain on this computer | Normal confirmation |

WAX Mainnet and WAX Testnet are in the list by default.

## How the kind is decided

The app decides the kind from the chain, not from the name you give:

- A known main chain (WAX Mainnet, EOS, Telos) is always mainnet, whatever was saved.
- WAX Testnet is testnet.
- `local` is allowed only when every endpoint is on this computer (`localhost`, `127.0.0.1`, `[::1]` or a name ending in `.localhost`).
- Any other chain counts as mainnet until you mark it as a test network. The app then asks in its own dialog: **Treat as a test network** or **Cancel**.

## How to do it here

1. Press the arrow of the **Network** button in the top bar. Each network shows its kind; mainnet networks are red.
2. Click a network to select it. The Account page, Contract page, Deploy and all forms work on the selected network.
3. The kind of a network you added yourself can be changed in Network > Manage Networks > **Edit**. The kind of a known chain is fixed.

[Manage Networks](app:manage-networks)

## Example

You add a private test chain at `https://test.example.org`. The app reads its chain id, does not know it, and proposes kind `mainnet`. You choose Testnet; the app asks "Treat this network as a test network?" with the name, chain id and endpoint. After **Treat as a test network**, signing there skips the mainnet steps.

## What is needed

- A node of your own on this computer: see [Your own local node](doc:local-node).
- WAX Testnet for learning and testing. See [Create a testnet account](doc:create-testnet-account).
- Care on mainnet: read [The mainnet confirmation](doc:mainnet-confirmation).
