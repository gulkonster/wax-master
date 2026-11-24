# Linked actions (linkauth)

By default an action needs `active` (or `owner`). **linkauth** says: this action of this contract may be signed by a smaller permission of mine. The link belongs to your account: the account, the contract (`code`), the action name (`type`) and the permission (`requirement`). **unlinkauth** removes it, and the action needs `active` again.

An empty action name links every action of that contract that has no link of its own. The app links one action at a time; links of every action, made elsewhere, are listed here and can be unlinked.

Whoever holds a key of the linked permission can send that action for your account, without `active`. Link a transfer or an `eosio` action only to a permission whose keys you trust with it; the review says so when you do.

## Who signs

- **Link**: the permission the action needs now, or one above it. That is its own link if it has one, else the link of every action of that contract, else `active`. So moving a link from `claim` to `game` can be signed by `claim`, `active` or `owner`.
- **Unlink**: the permission the action is linked to, or one above it.

The dialog lists these permissions and picks the nearest one your vault can sign with. When the links come from the history service, it also lists `active` and the permissions above it; when no list of links can be read, it lists every permission and the chain decides.

## How to do it here

1. Create the custom permission first (see [Custom permissions](doc:custom-permissions)), for example `claim`.
2. Open the account on the Account page and choose **Linked actions**. It lists every link: the contract and action, and the permission it is linked to.
3. In the form **Link an action to a permission**, enter the **Contract**, pick the **Action** (the list comes from the contract's ABI) and the **Permission** (`owner` is not offered). Press **Link an action to a permission**, check the review, press **Send to confirmation** and approve.
4. To use it: open the contract, choose that action and, in Authorization, choose your account with permission `claim`.
5. To remove a link, press **Unlink** on its row.

From the Contract page, with `eosio`:

- `linkauth`: `account` = your account, `code` = the contract, `type` = the action, `requirement` = `claim`.
- `unlinkauth`: `account`, `code`, `type`.
- Authorization: your account @ the permission the action needs now (for a new link usually `active`), or one above it. For `unlinkauth`, the linked permission or one above it.

## Unlink before you delete

The chain refuses to delete a permission that is still linked. Unlink every action first, then delete the permission.

## Example

`claim` is linked to `claimreward` of `mygamecontr1`. The bot signs `claimreward` with `myacct123456@claim`. It cannot transfer tokens or change anything else.

## What is needed

- A custom permission and a signer as listed under "Who signs".
- Mainnet networks ask you to type the account name in the confirmation window.

See also [Run actions](doc:run-actions) and [Owner, active and permissions](doc:permissions-overview).
