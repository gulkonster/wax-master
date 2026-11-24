# NFT staking

Staking of AtomicAssets NFTs. Assets of your collection sent to the contract account with the memo `stake` are recorded in the table `stakes`, one row per asset with its owner and the time; `unstake` sends them back with an inline `atomicassets::transfer` (so the contract account needs `eosio.code`), only to the account that staked them.

Why the table: after the transfer `atomicassets` knows only that the contract account owns the asset. Who sent it, and who may have it back, is written nowhere else. Without its own table the contract cannot tell whose asset is whose, and an `unstake` could hand one user's NFT to another. `unstake` checks the row before anything is sent back.

This contract is an example to learn from: not audited; do not hold real value with it unchanged.

Before you build on it: the staked assets and anything else the contract account holds are in one place, and the table is the only record of whose each asset is, so whoever holds the account's keys or deploys new code controls all of them. Staking here pays no reward; `staked_at` is there to count one from.
The contract pays the RAM of one row per staked asset (about 260 bytes, the first one about 370), so the RAM it needs grows with the collection's supply. Only a `transfer` is recorded: an asset minted to the contract account or reaching it through an offer has no row and cannot be unstaked. A new deployment that changes the `stakes` row can make the stored rows unreadable, and then nobody can unstake.

## What is in it

- `setconfig(collection)`: signed by the contract account; stores the collection whose assets can be staked. Every reader creates his own collection, so it is not a constant in the source. Assets staked before a change stay staked and can be unstaked.
- `on_transfer` (a notification handler, not an action): `atomicassets` sends `transfer` to `from` and `to`. The handler returns for the contract's own outgoing transfers and for notifications another account passed on (`to` is not the contract). Everything else must have the memo `stake`, at most 10 assets, and only assets of the configured collection: the handler reads each asset in the `atomicassets` table `assets` (scope = the contract account, which owns it by then) and checks its `collection_name`. Then it writes one row per asset, paid by the contract. A failed check refuses the whole transfer, so the assets stay with the sender. This handler may fail because `transfer` reaches only the two accounts of the transfer; a handler on `logtransfer`, which a collection's notify accounts receive for every movement, must never fail.
- `unstake(owner, asset_ids)`: signed by `owner`; 1 to 10 assets, each with a row whose `owner` is `owner`. The rows are erased and all assets go back in one inline `atomicassets::transfer` with the memo `unstake`.
- Table `config` (one row, scope = the contract account): `collection`.
- Table `stakes`, scope = the contract account: `asset_id`, `owner`, `staked_at` (UTC); second index `byowner` (Index 2, Key type `name`).
- `atomic::asset_row` in `include/%CONTRACT%.hpp` copies the row of the `atomicassets` table `assets` from its ABI, to read it. It is outside the contract class, so it is not part of this contract's ABI.

## Steps in WAX Master (WAX Testnet)

1. File > New Project. Under **Examples** choose **NFT staking**, keep the name `%CONTRACT%`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the **contract account**, press **Request test tokens**, then **Open account** and press the star. The faucet limits how often it creates accounts and sends tokens, and shows its own message when it refuses. The **user account** (the collection's author, who stakes) is an account you already have or one made from the contract account: on its Account page, section **Create account**, with **RAM (bytes)** `8192` and some **Stake CPU** and **Stake NET** (for example `1.00000000 WAX` each). The user account pays for the collection, the schema, the template and the two assets it mints: about 1,500 bytes. If **Request test tokens** is refused, send WAX to the contract account from an account you have (its Account page, section **Transfer**). The contract listens only to `atomicassets`, so a WAX payment to it works also after deployment.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. The contract account pays for its `config` row (about 230 bytes) and for one `stakes` row per staked asset (about 260 bytes, the first one about 370). The asset itself is not charged to the contract account: its RAM stays with the account that minted it. Open **RAM** on its Account page: when fewer than 2,048 bytes are free, buy 2048 bytes (**By bytes**). Check the user account the same way: when fewer than 2,048 bytes are free, buy 2048 bytes.
6. On the contract account's Account page open **Keys and permissions**. On `active` use the switch **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. Press **Contracts** in the top bar and open `atomicassets`. In every action of steps 7 to 10 **Authorization** is the user account with `active`. Choose `createcol` and fill in: `author` = the user account; `collection_name` = the user account (a collection named after an existing account needs that account's signature); `allow_notify`: ticked; `authorized_accounts` = `["<user account>"]`; `notify_accounts` = `[]`; `market_fee` = `0.01`; `data` = `[{"key":"name","value":["string","Example collection"]}]`. Press **Run** and approve.
8. Choose `createschema`: `authorized_creator` = the user account, `collection_name` = the user account, `schema_name` = `items`, `schema_format` = `[{"name":"name","type":"string"}]` (every schema needs the attribute `name`). **Run** and approve.
9. Choose `createtempl`: `authorized_creator` = the user account, `collection_name` = the user account, `schema_name` = `items`, `transferable` and `burnable`: ticked, `max_supply` = `10`, `immutable_data` = `[{"key":"name","value":["string","Example item"]}]`. **Run** and approve. Press **Open in inspector**: the action `lognewtempl` shows the new `template_id`. You can also read it later: table `templates`, **Scope** = the user account.
10. Choose `mintasset`: `authorized_minter` = the user account, `collection_name` = the user account, `schema_name` = `items`, `template_id` = the id of step 9, `new_asset_owner` = the user account, `immutable_data` = `[]`, `mutable_data` = `[]`, `tokens_to_back` = `[]`. **Run** and approve. Press **Run** again and approve: two assets.
11. Pick the table `assets`, **Scope** = the user account, **Run query**: two rows with the `template_id` of step 9. Note their `asset_id`s; below they are A and B.
12. Press **Contracts** and open the contract account. Choose `setconfig`: `collection` = the user account. **Authorization**: the contract account with `active`. **Run** and approve.
13. On the `atomicassets` tab choose `transfer`: `from` = the user account, `to` = the contract account, `asset_ids` = `["<A>"]`, `memo` = `test`. **Authorization**: the user account with `active`. **Run**: refused with "send with the memo stake". The asset stays with the user account.
14. To see the collection check without a second collection, point the contract at another one for a moment: on the contract account's tab run `setconfig` with `collection` = `othercollect` (signed by the contract account). Run the transfer of step 13 with `memo` = `stake`: refused with "only assets of the configured collection can be staked". Run `setconfig` with `collection` = the user account again.
15. Run the transfer with `asset_ids` = `["<A>", "<B>"]` and `memo` = `stake`, and approve. On the `atomicassets` tab, table `assets`, **Scope** = the contract account: the two assets. On the contract account's tab, table `stakes`, **Run query**: two rows, `owner` = the user account, `staked_at` = now (UTC).
16. To list one account's stakes, set **Index** to `2`, **Key type** to `name`, **Lower bound** and **Upper bound** to the user account, and press **Run query**.
17. Choose `unstake`: `owner` = the contract account, `asset_ids` = `["<A>"]`. **Authorization**: the contract account with `active`. **Run**: refused with "this asset was staked by another account". Holding the asset does not make it the contract account's: the table decides.
18. Choose `unstake`: `owner` = the user account, `asset_ids` = `["<A>"]`. **Authorization**: the user account with `active`. **Run** and approve. The trace shows the inline `atomicassets::transfer` with the memo `unstake`. `stakes` shows one row (B); `assets` with **Scope** = the user account shows A again.
19. Run `unstake` for `["<B>"]` the same way: `stakes` shows no rows, and both assets are back with the user account.

## What goes wrong, and why

- "send with the memo stake": the transfer had another memo. It is refused on purpose, so the assets stay with the sender.
- "only assets of the configured collection can be staked": the asset belongs to another collection, or `setconfig` names another collection.
- "staking is not set up yet: run setconfig": step 12 is missing.
- "stake at most 10 assets in one transfer": send 10 or fewer. `unstake` has the same limit ("unstake at most 10 assets at a time").
- "this asset was staked by another account": `unstake` named an asset whose row has another `owner`.
- "this asset is not staked": `unstake` named an asset that has no row: never staked, or already unstaked.
- "name at least one asset": `unstake` with an empty `asset_ids`.
- `unstake` refused with a message that names `eosio.code`: step 6 is missing.
- The transfer with the memo `stake` refused with a RAM error: the contract account needs more RAM for the new rows (step 5).
- `createcol` refused with "A collection with this name already exists": the user account made a collection before. Use that collection, or a 12-character name that is not an account.

More in the documentation: Help > Documentation > Examples > NFT staking.
