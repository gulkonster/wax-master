# Changing a key safely

A key change replaces a public key in a permission. Done wrong, it locks you out. Follow these steps.

## How to do it here

1. Make the new key first (Accounts > Manage Keypairs > **Create**) and finish its backup. See [Backing up keys](doc:key-backups).
2. Open the account on the Account page, choose **Keys and permissions**, and press **Change key...** under the permission. Choose the new key. The new key gets the old key's weight; threshold and other entries stay.
3. Choose the permission that signs: the permission itself, or its parent. When changing `active`, sign with `owner`.
4. Check the confirmation window. It shows the full new authority.
5. After it is sent, read the Account page again and sign a harmless action with the new key before you delete the old key anywhere.

## Rules

- Never remove the last key (or the keys) that reach the threshold of `owner` or `active`.
- Never write a key whose private part you do not have.
- Change `owner` last and with extra care. A wrong `owner` cannot be repaired by anything.
- With a threshold above 1, check that the keys left still add up to it.

## Example

`active` has key A. Create key B, back it up, then **Change key...** on `active`, sign with `owner`. `active` now has B with the same weight and A is gone.

## What is needed

- The new key in your vault, backed up. A signer for the permission or its parent.

See also [Thresholds and weights](doc:multisig-threshold) and [Owner, active and permissions](doc:permissions-overview).
