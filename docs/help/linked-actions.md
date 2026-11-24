# Linked actions (linkauth)

By default an action needs `active` (or `owner`). **linkauth** says: this action of this contract may be signed by a smaller permission of mine. The link belongs to your account: the account, the contract (`code`), the action name (`type`) and the permission (`requirement`). **unlinkauth** removes it, and the action needs `active` again.

An empty action name links every action of that contract that has no link of its own.

## How to do it here

1. Create the custom permission first (see [Custom permissions](doc:custom-permissions)), for example `claim`.
2. Open the account on the Account page and choose **Linked actions**. It lists the links of each permission.
3. Press **Link an action to a permission**. Pick the permission, the contract and the action (the action list comes from the contract's ABI) and approve.
4. To use it: open the contract, choose that action and, in Authorization, choose your account with permission `claim`.
5. To remove a link, press **Unlink** on its row.

From the Contract page, with `eosio`:

- `linkauth`: `account` = your account, `code` = the contract, `type` = the action, `requirement` = `claim`.
- `unlinkauth`: `account`, `code`, `type`.
- Authorization for both: your account @ `active`.

## Unlink before you delete

The chain refuses to delete a permission that is still linked. Unlink every action first, then delete the permission.

## Example

`claim` is linked to `claimreward` of `mygamecontr1`. The bot signs `claimreward` with `myacct123456@claim`. It cannot transfer tokens or change anything else.

## What is needed

- A custom permission and a signer for `active` (or `owner`) of the account.
- Mainnet networks ask you to type the account name in the confirmation window.

See also [Run actions](doc:run-actions) and [Owner, active and permissions](doc:permissions-overview).
