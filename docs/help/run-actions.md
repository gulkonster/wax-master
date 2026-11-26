# Run actions

An action is a function of a contract that you call with a transaction. The Contract page builds the form for any action from the contract's ABI, so you can call your own contract, `eosio.token`, or the system contract `eosio` without a terminal or an explorer.

![The Contract page: each action of a contract is a form with a field for every argument.](img:contract-actions)

## How to do it here

1. Press the **Contracts** button in the top bar (or **Open as contract** on the Account page). Type the contract account and press Enter. Each contract opens in its own tab.
2. Choose the action in the list at the top left.
3. Fill in **Parameters**. Fields of type `name` offer your starred accounts and vault accounts; `asset` fields show the format, for example `1.00000000 WAX`. Fields of a struct or list type take JSON. **Raw JSON** switches to one JSON text for the whole action.
4. Open **Authorization**: the account and permission that sign. A new tab starts with the opened account when it is starred, else with the signer you last used with Run or Simulate on this network, else with the account of the top bar's Account button and `active`. **Add signer** adds a second signer when the action needs two.
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

## Example: change a permission from the Contract page

The Account page has sections for permissions (**Keys and permissions**, **Linked actions**). The same changes can be sent here as system actions of `eosio`:

| Action | What it does | Help |
|---|---|---|
| `updateauth` | Replaces a whole permission. Use it to add `<contract>@eosio.code` to `active`. It must contain every key and account the permission already has. | [The eosio.code permission](doc:eosio-code), [Custom permissions](doc:custom-permissions) |
| `linkauth` | Lets an action of a contract be signed by a custom permission. | [Linked actions](doc:linked-actions) |
| `unlinkauth` | Removes such a link. Do this before deleting the permission. | [Linked actions](doc:linked-actions) |
| `deleteauth` | Deletes a permission. The chain refuses it while actions are still linked to it. | [Custom permissions](doc:custom-permissions) |

Choose the action, fill in `account` and the other fields, and set Authorization to your account @ `active` (or `owner`).

> Note: A mistake in `auth` can lock you out of the permission. Never remove the last key that reaches the threshold of `owner` or `active`, and change `active` with `owner` as the signer. See [Changing a key safely](doc:change-key-safely).

## What is needed

- A network selected and the contract's account name.
- To run: a key of the signing permission in your vault. To simulate: no key.
- One transaction may change the permissions or the contract (`updateauth`, `deleteauth`, `linkauth`, `unlinkauth`, `setcode`, `setabi`) of only one account.
