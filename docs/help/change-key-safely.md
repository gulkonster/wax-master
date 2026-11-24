# Changing a key safely

A key change replaces a public key in a permission. Done wrong, it locks you out. Follow these steps.

## How to do it here

1. Make the new key first (Accounts > Manage Keypairs > **Create**) and finish its backup. See [Backing up keys](doc:key-backups).
2. Open the account on the Account page, choose **Keys and permissions**, and press **Change key...** under the permission. The button is shown only when one of the permission's keys is in your vault. Choose the **Key to replace** and the **New key**. The new key gets the old key's weight; threshold and other entries stay.
3. Choose the permission that signs. By default the permission itself signs (its own key is still valid until the change is on the chain). A parent, `owner` for `active`, is offered too: keep `owner` out of daily use.
4. Press **Change key** and check the confirmation window. It shows the full new authority.
5. After it is sent, read the Account page again and sign a harmless action with the new key before you delete the old key anywhere.

## Rules

- Never remove the last key (or the keys) that reach the threshold of `owner` or `active`.
- Never write a key whose private part you do not have.
- Change `owner` last and with extra care. A wrong `owner` cannot be repaired by anything.
- With a threshold above 1, check that the keys left still add up to it.

## Example

`active` has key A. Create key B, back it up, then **Change key...** on `active` and keep `active` as the signer (key A signs its own replacement). `active` now has B with the same weight and A is gone.

Had key A been lost, **Change key...** is not shown on `active`. Use **Add key** on `active` with key B and sign with `owner`, then remove key A with its remove button, again signed with `owner`.

## What is needed

- The new key in your vault, backed up. A signer for the permission itself, or for its parent when its key is lost.

See also [Thresholds and weights](doc:multisig-threshold) and [Owner, active and permissions](doc:permissions-overview).
