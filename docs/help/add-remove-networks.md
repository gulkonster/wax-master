# Add and remove networks

The network list is yours: add any Antelope chain by its API address, add more endpoints to a network, remove networks you do not use. WAX Mainnet and WAX Testnet are defaults: they can be removed and restored.

## How to do it here

Add a network:

1. Network > Add Network... (or **Add Network...** in the Network button's list).
2. Paste the API endpoint, for example `https://wax.eosphere.io`, and press **Connect**.
3. The app reads the chain and shows the chain id, whether it knows the chain, the server version, a name, the kind, the core token symbol and precision, and an optional history service.
4. If the chain is already in your list, **Add this endpoint to** followed by the network name adds the address to that network: its starred accounts and deploy settings stay. **Add as a new network** makes a separate entry.
5. For a new chain, check the name and kind and press **Add**.

Edit a network: Network > Manage Networks > **Edit**. Endpoints (one per line, same chain id) and the history service can be changed for every network. Name and kind can be changed only for networks you added. The chain id never changes.

Remove a network: Network > Manage Networks > **Remove** (or **Remove** on the Network page). The question lists the starred accounts that are forgotten and which network is selected next. The last network cannot be removed.

Restore the defaults: Network > Manage Networks > **Restore default networks** brings back WAX Mainnet and WAX Testnet with their endpoints.

[Add Network](app:add-network) [Manage Networks](app:manage-networks)

## Example

You paste the address of a WAX Mainnet API node that you found on a block producer's site. The app answers "This is the WAX Mainnet chain." and the kind is locked to mainnet. If the address is not yet in WAX Mainnet, press **Add this endpoint to WAX Mainnet**: WAX Mainnet now has one more endpoint to choose from. If it is already there, the dialog says "This endpoint is already in WAX Mainnet."

## What is needed

- An `https://` API endpoint of the chain (or `http://` on this computer).
- For a chain the app does not know, your decision on its kind. See [Mainnet and testnet](doc:mainnet-and-testnet).
- For account history, a Hyperion history service address. See [Endpoints](doc:endpoints).
