# Endpoints

An endpoint is the address of a node's API, for example `https://testnet.waxsweden.org`. WAX Master reads the chain and sends transactions through the network's current endpoint. A network can have several endpoints of the same chain; if one is slow or down, choose another. When the current endpoint gives no answer or a server error while the app reads the chain, the app tries the network's other endpoints in turn, uses the first that answers from then on and says so in a notice.

A **history service** is a separate address (Hyperion) that answers questions about the past: an account's transactions, a transaction by id. Without it, those parts of the app say that the network has no history service.

## Default endpoints

| Network | Endpoints | History service |
|---|---|---|
| WAX Mainnet | `https://wax.greymass.com`, `https://wax.eosphere.io`, `https://api.waxsweden.org` | `https://api.waxsweden.org` |
| WAX Testnet | `https://testnet.waxsweden.org`, `https://waxtestnet.greymass.com` | `https://testnet.waxsweden.org` |

## How to do it here

Choose the endpoint in use:

- On the Network page: the **API endpoint** list.
- Or Network > Manage Networks: the round button next to an endpoint.

Add or remove endpoints, or set the history service:

1. Network > Manage Networks > **Edit** on the network.
2. **Endpoints**: one address per line. Every endpoint must answer for the same chain id.
3. **History service**: one Hyperion address, or empty.
4. Save.

[Manage Networks](app:manage-networks)

## Example

WAX Testnet's first endpoint answers slowly (orange dot). Open the Network page and choose `https://waxtestnet.greymass.com` in the API endpoint list. The dot turns green after the next check.

## What is needed

- `https://` addresses. `http://` is allowed only for a node on this computer.
- An address without a user name or password in it.
- A path after the host name is dropped; only the scheme, the host and the port are kept.

See also [The status mark](doc:network-status) and [Transaction history](doc:transaction-history).
