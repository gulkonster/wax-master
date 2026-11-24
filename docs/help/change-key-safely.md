# Changing a key safely

A key change replaces a public key in a permission. Done wrong, it locks you out. Follow these steps.

## How to do it here

1. Make the new key first (Accounts > Manage Keypairs > **Create**) and finish its backup. See [Backing up keys](doc:key-backups).
2. Open the account on the Account page, choose **Keys and permissions**, and press **Change key...** under the permission. The button is shown on every permission with a key when your vault can sign for the permission or for one of its parents, so also when the permission's own key is lost. Choose the **Key to replace** and the **New key**. The new key gets the old key's weight; threshold and other entries stay.
3. Choose the permission that signs. By default the permission itself signs when your vault can sign with it (its own key is still valid until the change is on the chain); otherwise the nearest parent your vault can sign with, for example `owner` for `active`. A parent is offered too: keep `owner` out of daily use.
4. Press **Change key** and check the confirmation window. It shows the full new authority.
5. After it is sent, read the Account page again and sign a harmless action with the new key before you delete the old key anywhere.

## Rules

- Never remove the last key (or the keys) that reach the threshold of `owner` or `active`.
- Never write a key whose private part you do not have.
- Change `owner` last and with extra care. A wrong `owner` cannot be repaired by anything.
- With a threshold above 1, check that the keys left still add up to it.

## Example

`active` has key A. Create key B, back it up, then **Change key...** on `active` and keep `active` as the signer (key A signs its own replacement). `active` now has B with the same weight and A is gone.

Had key A been lost, **Change key...** is still shown on `active` when `owner` is in your vault. The dialog then preselects key A, the key that is not in the vault, as the key to replace and `owner` as the signer. One transaction replaces A with B, so the lost key stops working at once.

## What is needed

- The new key in your vault, backed up. A signer for the permission itself, or for its parent when its key is lost.

See also [Thresholds and weights](doc:multisig-threshold) and [Owner, active and permissions](doc:permissions-overview).
