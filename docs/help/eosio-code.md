# The eosio.code permission

A contract cannot hold keys. When a contract sends an action itself (an inline action), for example sending tokens from its own account, the chain checks that action with the special permission `<contract>@eosio.code`. The account must allow it: one of its permissions, usually `active`, must list `<contract>@eosio.code` as an entry. Without it the inline action fails with an error that names `eosio.code` among the provided permissions.

The app gives the entry a weight equal to the permission's threshold. The code must satisfy the permission alone for the inline action to pass, so a smaller weight would not work.

## How to do it here

1. Open your contract account on the Account page and choose **Keys and permissions**.
2. On the permission (usually `active`) use the switch **Allow this account's contract to send actions (eosio.code)**.
3. Read the new authority in the confirmation window: the old keys are all still there and one entry `yourcontract@eosio.code` is added. Approve.
4. The permission now lists `yourcontract@eosio.code`. To take it away, use the switch again.

From the Contract page: open `eosio`, choose `updateauth` with the current keys written again plus the account entry. Give the entry a weight equal to the threshold:

```json
{
  "threshold": 1,
  "keys": [ { "key": "PUB_K1_...", "weight": 1 } ],
  "accounts": [
    { "permission": { "actor": "mycontract111", "permission": "eosio.code" }, "weight": 1 }
  ],
  "waits": []
}
```

Replace `PUB_K1_...` with the key the permission has now. `updateauth` replaces the whole permission, so keep every key and account it already has. The chain wants keys sorted and accounts sorted by name.

## Example

A token vault contract on `mycontract111` pays out with an inline `transfer`. Add `mycontract111@eosio.code` to its `active`, then call the payout action. The inline transfer passes.

## What is needed

- A signer for the permission you change (or its parent). Use `owner` when you are not sure, so a wrong `active` can be repaired.

> Note: Only give `eosio.code` to a contract you trust. That contract can then act with the permission, for example move any tokens the account holds.

See also [Run actions](doc:run-actions) and [Owner, active and permissions](doc:permissions-overview).
