# Custom permissions

A custom permission is a new name under an existing permission, for example `claim` under `active`. It has its own keys and threshold. On its own it can sign nothing special; it becomes useful once you link an action to it (see [Linked actions](doc:linked-actions)). Then a bot, a second computer or a friend can hold the key of `claim` and call that one action, without ever holding your `active` key.

## How to do it here

1. Make or import the key first: Accounts > Manage Keypairs. See [Backing up keys](doc:key-backups).
2. Open the account on the Account page and choose **Keys and permissions**.
3. Press **New permission**. Give it a name (up to 12 characters, a-z and 1-5, for example `claim`), choose its parent (usually `active`) and add a key with weight 1.
4. Review the confirmation window: it shows the whole new permission. Approve. The parent permission or one above it signs.

To delete a custom permission, use **Delete permission** on it. The deletion is signed with its parent (or a permission above it); the chain refuses a deletion signed by the permission itself, so the app does not offer it. The chain also refuses to delete a permission that still has linked actions. Remove those links first (**Linked actions** section, or `unlinkauth`).

From the Contract page: open `eosio`, run `updateauth` with `account`, `permission` = `claim`, `parent` = `active` and an `auth` value:

```json
{
  "threshold": 1,
  "keys": [ { "key": "PUB_K1_...", "weight": 1 } ],
  "accounts": [],
  "waits": []
}
```

Delete it with `deleteauth` (`account`, `permission`), with Authorization your account @ the parent (for example `active`).

## Example

Create `claim` under `active` with one new key. Then link the action `claimreward` of your game contract to it (see [Linked actions](doc:linked-actions)). A bot signs `claimreward` with `claim` only.

## What is needed

- A signer for the parent permission (or a permission above it).
- A public key for the new permission. The private key stays with whoever will use it.

See also [Owner, active and permissions](doc:permissions-overview).
