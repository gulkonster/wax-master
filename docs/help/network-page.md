# The Network page

The Network page shows the state of the selected chain: where you are connected, how far the chain is, its token and its resource prices. It reads only; it changes nothing.

![The Network page: the endpoint and chain id, the state of the chain, the system token, the resources and the latest blocks.](img:network-page)

## How to do it here

Open it with the main part of the **Network** button in the top bar, or Network > Network Page.

| Part | What it shows |
|---|---|
| Header | Name, kind, status, **Edit** and **Remove** (for Local chain: **Local Chain...** in place of Edit) |
| API endpoint | The endpoint in use; choose another of the network's endpoints here. Copy button. |
| Chain ID | The chain's id. Copy button. |
| Basic info | Blocks (head block), Irreversible, Current producer, Server version |
| System token | Core symbol and decimals, Max supply, Supply |
| Resources | RAM used of total, RAM price (1 KB), CPU block limit, NET block limit |
| Block production | The latest blocks seen: block, time, producer, transactions, id (read every 2 seconds, not every block) |

A value the chain does not offer shows "n/a" with the reason, for example on a chain without the system contract.

[Network Page](app:network-page)

## Example

On WAX Testnet the page shows the core symbol `WAX (8 decimals)`, the RAM price per KB, and blocks counting up about twice a second. If **Irreversible** stays far behind **Blocks**, the status mark turns orange.

## What is needed

- A selected network that answers. While the page is open, the status is checked every 2 seconds instead of every 10.

See also [The status mark](doc:network-status) and [Endpoints](doc:endpoints).
