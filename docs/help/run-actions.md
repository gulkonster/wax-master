# Run actions

An action is a function of a contract that you call with a transaction. The Contract page builds the form for any action from the contract's ABI, so you can call your own contract, `eosio.token`, or the system contract `eosio` without a terminal or an explorer.

## How to do it here

1. Press the **Contracts** button in the top bar (or **Open as contract** on the Account page). Type the contract account and press Enter. Each contract opens in its own tab.
2. Choose the action in the list at the top left.
3. Fill in **Parameters**. Fields of type `name` offer your starred accounts and vault accounts; `asset` fields show the format, for example `1.00000000 WAX`. Fields of a struct or list type take JSON. **Raw JSON** switches to one JSON text for the whole action.
4. Open **Authorization**: the account and permission that sign. **Add signer** adds a second signer when the action needs two.
5. Press **Run**. The confirmation window shows the network, the signers and the action data. Press **Approve and send**.
6. **Result** shows the transaction id, status, block and CPU time. **Open in inspector** shows the full trace, including the console output of each action.

Other parts of the page:

- **Simulate**: runs the action without signing or sending. See [Simulate and the transaction inspector](doc:simulate-inspector).
- **Command**: the action as JSON, as packed hex and as a `cleos` line, each with a copy button.
- **Ricardian**: the action's plain-language text from the ABI (see [Ricardian contracts](doc:ricardian)).
- The heart button keeps favorite actions with their values; the clock button lists the history of this contract's actions.
- The right half of the page reads tables. See [Read tables](doc:read-tables).

If a field named `to`, `receiver` or `recipient` holds an account that does not exist on this network, nothing is signed.

## Example: run `hi` of Hello World

| Field | Value |
|---|---|
| Contract | your account with the Hello World contract |
| Action | `hi` |
| `user` | your account |
| Authorization | your account @ `active` |

Run, approve, then Open in inspector: Console shows `Hello, ` and your account name.

## Example: add `eosio.code` to a permission

**What it is.** A contract cannot hold keys. When a contract sends an action itself (an inline action), for example sending tokens from its own account, the chain checks that action with the special permission `<contract>@eosio.code`. The account must allow it: one of its permissions, usually `active`, must list `<contract>@eosio.code` as an entry. Without it the inline action fails with an error that names `eosio.code` among the provided permissions.

**How it is done today.** The permission is changed with the system action `eosio::updateauth` on the Contract page. `updateauth` replaces the whole permission, so the new value must contain everything the permission already has, plus the new entry.

1. Open your contract account on the Account page. Under **Permission Keys**, note the `active` permission: its threshold and every key and account with their weights.
2. Press the **Contracts** button, type `eosio` and press Enter. Choose the action `updateauth`.
3. Fill in `account` = your contract account, `permission` = `active`, `parent` = `owner`.
4. In `auth`, write the current keys again and add the account entry. Give it a weight equal to the threshold, so the contract's code alone satisfies the permission.
5. Authorization: your contract account @ `active` (or `owner`).
6. Run, check the new permission in the confirmation window, approve.
7. Refresh the Account page: `active` now lists `yourcontract@eosio.code`.

The `auth` value for an account `mycontract111` with one key, threshold 1:

```json
{
  "threshold": 1,
  "keys": [
    { "key": "PUB_K1_...", "weight": 1 }
  ],
  "accounts": [
    { "permission": { "actor": "mycontract111", "permission": "eosio.code" }, "weight": 1 }
  ],
  "waits": []
}
```

Replace `PUB_K1_...` with the public key that `active` has now, exactly as the Account page shows it. If the permission has several keys or accounts, keep all of them; the chain wants keys sorted and accounts sorted by name.

To remove `eosio.code` again, send the same `updateauth` without the `accounts` entry.

> Note: A mistake in `auth` can lock you out of the permission. Check that the key you write is a key whose private part is in your vault. Change `active` with `owner` as the signer, so a wrong `active` can still be repaired.

## Example: link an action to a permission (`linkauth`)

**What it is.** By default every action needs `active` (or `owner`). `linkauth` says: this action of this contract may be signed by a smaller permission of mine. A common use is a permission `claim` with its own key that can only call one game action, so a bot or a second computer never holds your `active` key.

**How it is done today**, with the system actions on the Contract page (`eosio`):

**Step 1: create the permission.** Make a new key in Accounts > Manage Keypairs > Create. Then run the action `updateauth` with `account` = your account, `permission` = `claim`, `parent` = `active`, and this `auth` with the new public key. Authorization: your account @ `active`.

```json
{
  "threshold": 1,
  "keys": [ { "key": "PUB_K1_...", "weight": 1 } ],
  "accounts": [],
  "waits": []
}
```

**Step 2: link the action.** Run the action `linkauth` with `account` = your account, `code` = the contract, `type` = the action, `requirement` = `claim`. Authorization: your account @ `active`.

**Step 3: use it.** Open the contract, choose that action, and in Authorization choose your account with permission `claim`.

An empty `type` links every action of that contract that has no link of its own.

## Example: remove a link (`unlinkauth`) and the permission

1. Action `unlinkauth` on `eosio` with `account` = your account, `code` = the contract, `type` = the action. Authorization: your account @ `active`. After it, the action needs `active` again.
2. To delete the permission too, run `deleteauth` with `account` = your account and `permission` = `claim`. The chain refuses to delete a permission that is still linked, so unlink first.

> Note: The Account page lists permissions and their keys but not the links yet. Keep a note of what you linked.

## What is needed

- A network selected and the contract's account name.
- To run: a key of the signing permission in your vault. To simulate: no key.
- On a mainnet network, `updateauth`, `deleteauth`, `linkauth`, `unlinkauth`, `setcode` and `setabi` need the account name typed in the confirmation window. One transaction may change only one account this way.
