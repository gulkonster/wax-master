# AtomicAssets

A minter for AtomicAssets, the NFT standard of WAX. `mint` gives every account one asset of your template, minted by the contract with an inline `atomicassets::mintasset`; the contract hears about every movement of your collection's assets with `[[eosio::on_notify("atomicassets::logtransfer")]]` and counts the ones that arrive at it. It shows how a contract becomes an authorized and notified account of a collection, and why such a handler must never fail.

This contract is an example to learn from: not audited; do not hold real value with it unchanged.

Before you build on it: the contract account pays the RAM of every asset it mints (about 260 bytes when the receiver holds no asset yet, the usual case here; about 150 otherwise), so `mint` is limited to one per account and the template has a `max_supply`; a real drop also takes a payment or a list of allowed accounts.
The row that records a mint (about 120 bytes) is paid by the caller and stays, because it is the limit; an action that removed it would let the account mint again. Assets sent to the contract account stay with it until its own key sends them on.
Only `atomicassets` can send `logtransfer`; the handler checks the collection because a notify account of another collection can pass its notification on. A new deployment that changes the `config` struct makes the handler fail on the stored row, and then every transfer of the collection is refused: the collection's author ends that with `atomicassets::remnotifyacc`.

## What is in it

- `setconfig(collection, schema, template_id)`: signed by the contract account; stores what `mint` mints from. Every reader creates his own collection, so these are not constants in the source.
- `mint(owner)`: signed by `owner`; refused when `owner` has minted before; records `owner` in the table `minted` (paid by `owner`) and mints one asset of the template to `owner`. The inline action is signed by the contract's own `active`, so it needs `eosio.code`, and the contract account must be an authorized account of the collection.
- `on_logtransfer` (a notification handler, not an action): `atomicassets` sends `logtransfer` to the collection's notify accounts for every movement of the collection's assets, also when an offer is accepted. The handler counts the assets of the configured collection that arrive at the contract account and stores the last sender. It has no `check`: it returns for everything else, and it only changes a row that exists, so it never needs new RAM. A failing notify account would stop every transfer of the collection.
- Table `config` (one row, scope = the contract account): `collection`, `schema`, `template_id`, `received`, `last_sender`.
- Table `minted`, scope = the contract account: `owner`.

## Steps in WAX Master (WAX Testnet)

1. File > New Project. Under **Examples** choose **AtomicAssets**, keep the name `%CONTRACT%`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the **contract account**, press **Request test tokens**, then **Open account** and press the star. The faucet limits how often it creates accounts and sends tokens, and shows its own message when it refuses. The **user account** (the collection's author, who also mints) is an account you already have or one made from the contract account: on its Account page, section **Create account**, with **RAM (bytes)** `8192` and some **Stake CPU** and **Stake NET** (for example `1.00000000 WAX` each). The user account pays for the collection, the schema, the template and its own `minted` row: about 1,000 bytes. If **Request test tokens** is refused, send WAX to the contract account from an account you have (its Account page, section **Transfer**) before deploying.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. The contract account pays for every asset it mints (about 260 bytes when the receiver holds no asset yet, about 150 otherwise) and for its `config` row (about 260). Open **RAM** on its Account page: when fewer than 2,048 bytes are free, buy 2048 bytes (**By bytes**). Check the user account the same way: when fewer than 2,048 bytes are free, buy 2048 bytes.
6. On the contract account's Account page open **Keys and permissions**. On `active` tick **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. Press **Contracts** in the top bar and open `atomicassets`. In every action of steps 7 to 11 **Authorization** is the user account with `active`. Choose `createcol` and fill in: `author` = the user account; `collection_name` = the user account (a collection named after an existing account needs that account's signature); `allow_notify`: ticked; `authorized_accounts` = `["<user account>"]`; `notify_accounts` = `[]`; `market_fee` = `0.01`; `data` = `[{"key":"name","value":["string","Example collection"]}]`. Press **Run** and approve.
8. Choose `createschema`: `authorized_creator` = the user account, `collection_name` = the user account, `schema_name` = `items`, `schema_format` = `[{"name":"name","type":"string"}]` (every schema needs the attribute `name`). **Run** and approve.
9. Choose `createtempl`: `authorized_creator` = the user account, `collection_name` = the user account, `schema_name` = `items`, `transferable` and `burnable`: ticked, `max_supply` = `10`, `immutable_data` = `[{"key":"name","value":["string","Example item"]}]`. **Run** and approve. Press **Open in inspector**: the action `lognewtempl` shows the new `template_id`. You can also read it later: table `templates`, **Scope** = the user account.
10. Choose `addcolauth`: `collection_name` = the user account, `account_to_add` = the contract account. **Run** and approve. The contract may now mint in the collection.
11. Choose `addnotifyacc`: `collection_name` = the user account, `account_to_add` = the contract account. **Run** and approve. The contract now receives `logtransfer` for the collection. Pick the table `collections`, **Lower bound** = the user account, **Limit** = `1`, **Run query**: `authorized_accounts` lists both accounts, `notify_accounts` the contract account.
12. Press **Contracts** and open the contract account. Choose `setconfig`: `collection` = the user account, `schema` = `items`, `template_id` = the id of step 9. **Authorization**: the contract account with `active`. **Run** and approve.
13. Choose `mint`: `owner` = the user account. **Authorization**: the user account with `active`. **Run** and approve. The trace shows the inline `atomicassets::mintasset` and `logmint`.
14. On the `atomicassets` tab pick the table `assets`, **Scope** = the user account, **Run query**: one row with the `template_id` of step 9. Note its `asset_id`. On the contract account's tab, table `minted`: one row, `owner` = the user account.
15. Run `mint` for the user account again: refused with "this account has already minted".
16. On the `atomicassets` tab choose `transfer`: `from` = the user account, `to` = the contract account, `asset_ids` = `["<asset_id of step 14>"]`, `memo` = `test`. **Authorization**: the user account with `active`. **Run** and approve.
17. On the contract account's tab pick the table `config`, **Run query**: `received` = `1`, `last_sender` = the user account.

## What goes wrong, and why

- `mint` refused with a message that names `eosio.code`: step 6 is missing.
- `mint` refused with "The minter is not authorized within the collection": step 10 is missing, or `setconfig` names another collection.
- `mint` refused with "run setconfig first": step 12 is missing.
- `mint` refused with "The template's maxsupply has already been reached": `max_supply` assets are minted. Make a new template (step 9) and run `setconfig` with its id.
- `config` still shows `received` = `0` after step 16: the contract is not a notify account of the collection (step 11), or `setconfig` names another collection.
- `createcol` refused with "A collection with this name already exists": the user account made a collection before. Use that collection, or a 12-character name that is not an account.
- A refusal with a RAM error: the account that pays for the new row needs more RAM (step 5).

More in the documentation: Help > Documentation > Examples > AtomicAssets.
