# Owner, active and permissions

An account is controlled by its permissions, not by one key. Each permission lists the keys and accounts that may sign for it, each with a weight, and a threshold. Every action in a transaction names the permission that must authorize it.

Two permissions exist on every account:

| Permission | Use |
|---|---|
| `owner` | The top permission. It can change every other permission, including `active`, and it can recover an account. Keep its key safe and use it seldom. |
| `active` | The daily permission: transfers, deploys, most actions. |

You can add more permissions below these (see [Custom permissions](doc:custom-permissions)). A permission has a parent; the parent can always do what its child can do, and `owner` is the parent of `active`.

## How to do it here

1. Open the account on the Account page (top bar > **Account**).
2. Choose **Keys and permissions** in the section list. It shows the permission tree: each permission with its parent, threshold, and every key and account with its weight. A **vault** mark shows a key that is in your vault.
3. To change a permission, use the buttons under it. The app builds the new authority from the one on the chain, refuses one that could not reach its threshold, and shows the full new authority in the confirmation window. Changing `owner` shows an extra warning line.

The same changes can be sent as system actions from the Contract page: open `eosio` and use `updateauth`, `deleteauth`, `linkauth` or `unlinkauth`. See [Run actions](doc:run-actions) and [The Contract section](doc:contract-section).

## Example

The account `mygameacct12` has `owner` and `active`, each with one key of weight 1 and threshold 1. Keys and permissions shows both permissions, each with its key and a "vault" mark. You sign daily work with `active`. The `owner` key lives on an offline backup.

> Note: Never remove the last key that reaches the threshold of `owner` or `active`. Nothing could sign for that permission afterwards, and the account could be lost for good. See [Changing a key safely](doc:change-key-safely).

## What is needed

- A key in your vault that satisfies the permission you sign with. To change `active`, sign with `active` or `owner`; to change `owner`, sign with `owner`.
- Mainnet networks ask you to type the account name in the confirmation window for any permission change.

See also [Thresholds and weights](doc:multisig-threshold), [Accounts and names](doc:accounts-and-names) and [The Account page as a wallet](doc:wallet-overview).
