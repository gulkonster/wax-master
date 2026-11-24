# Thresholds and weights

A permission lists entries, each with a **weight**, and has a **threshold**. A set of signatures is enough when the weights of the entries that signed add up to at least the threshold. An entry is a public key or an account's permission (for example `friend@active`).

| Threshold | Entries | Who can sign alone |
|---|---|---|
| 1 | one key, weight 1 | that key |
| 1 | two keys, weight 1 each | either key (1-of-2) |
| 2 | two keys, weight 1 each | nobody; both must sign (2-of-2) |
| 2 | three keys, weight 1 each | any two (2-of-3) |

## How to do it here

1. Open the account on the Account page and choose **Keys and permissions**.
2. Under the permission, use **Add key** or **Add account** and give the entry a weight; use **Set threshold** to change the threshold.
3. Check the full new authority in the confirmation window. The app refuses a permission whose entries could never add up to its threshold.

Order matters when you go from 1-of-1 to 2-of-2: add the second key first (threshold still 1), then raise the threshold to 2.

A transaction that needs several signers can be signed on the Contract page with **Add signer** under Authorization, when you hold the keys in the vault. Proposals that several people sign one after the other are not part of the app.

## Example: 2-of-2

`active` of `sharedacct111` has threshold 2 and two keys of weight 1:

```json
{
  "threshold": 2,
  "keys": [
    { "key": "PUB_K1_...", "weight": 1 },
    { "key": "PUB_K1_...", "weight": 1 }
  ],
  "accounts": [],
  "waits": []
}
```

Both keys must sign every transaction. If one key is lost, the account cannot sign with `active` any more.

## What is needed

- A signer for the permission you change (or its parent).

> Note: Never set a threshold higher than the sum of the weights, and never remove the last key or keys that reach the threshold of `owner` or `active`. That locks the permission for good. Keep `owner` on keys you can always reach.

See also [Owner, active and permissions](doc:permissions-overview) and [Changing a key safely](doc:change-key-safely).
