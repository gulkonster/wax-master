# Accounts and names

On WAX and other Antelope chains, an account is a name on the chain, not a key. Keys control the account through its permissions. One account can hold tokens, RAM and a contract at the same time.

## Names

- Up to 12 characters: a-z, 1-5 and dots. No capitals, no 0, 6-9.
- Normal accounts have exactly 12 characters. Shorter names are premium names and are sold by auction.
- A name like `alice.wam` belongs to the account `wam`, which created it.

## Permissions

Every account starts with two permissions:

| Permission | Use |
|---|---|
| `owner` | The top permission. It can change every other permission, including `active`. Keep its key safe and seldom used. |
| `active` | The daily permission: transfers, deploys, actions. |

A permission has one or more keys or accounts, each with a **weight**, and a **threshold**. A signature set is enough when the weights add up to the threshold. With one key of weight 1 and threshold 1, that key alone is enough.

## Resources

| Resource | What it is |
|---|---|
| RAM | Storage on the chain: contract code, table rows. Bought and sold for tokens. |
| CPU | Processing time per transaction, from staked tokens. |
| NET | Transaction size, from staked tokens. |

## How to do it here

1. Press the **Account** button in the top bar (or a starred account in its list).
2. Type an account name in the address field and press Enter. Each account opens in its own tab.
3. The buttons next to the address field: **Star** (see [Starred accounts](doc:starred-accounts)), **Open as contract**, and **Keys** (Manage Keypairs, showing this account's keys).

The page has these sections:

| Section | What it shows |
|---|---|
| Account | Total Balance, Available, Staked, Refund |
| Resources | RAM, CPU and NET with used and total. **Buy RAM** opens a form to buy RAM for this account; on WAX Testnet **Request testnet tokens** asks the faucet for test tokens. |
| Permission Keys | Each permission with its threshold, keys and accounts and their weights. A green **vault** mark means that key is in your vault. |
| Transactions | The latest actions of the account, when the network has a history service |

## Change a key

When a permission has a key that is in your vault, **Change key...** appears under it.

1. Press **Change key...**.
2. Choose the key to replace and the new key (from the vault or pasted as a public key).
3. Choose the permission that signs the change: the permission itself, or a parent.
4. Press **Change key** and approve in the confirmation window.

The new key gets the old key's weight; the threshold and all other entries stay as they are. Make sure the new key's private part is in the vault or backed up, or you lose control of the permission.

## Example

Open `eosio.token` on the Account page: it shows the system token contract's balance, its RAM (most of it used by token rows) and its permissions.

## What is needed

- A network selected. Reading an account needs no key.
- To change anything you need a key of the account in your vault. See [The vault](doc:vault).
