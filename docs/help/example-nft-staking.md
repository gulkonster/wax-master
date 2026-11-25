# Example: NFT staking

Staking of AtomicAssets NFTs. The user sends assets of your collection to the contract account with the memo `stake`; the contract writes one row per asset into its table `stakes` with the owner and the time; `unstake` sends them back, only to the account that staked them. It teaches why a contract that holds other people's NFTs must keep its own record of whose each one is, how to read a table of `atomicassets` inside a contract, and when a notification handler may refuse a transfer.

The project is in File > New Project > **Examples** > **NFT staking**. Its `README.md` has the same steps as this page.

> Note: The example is there to learn from. It is not audited; do not hold real value with it unchanged.

## Why the table is the point

When an asset is transferred to the contract account, `atomicassets` moves its row into the scope of the contract account. From then on `atomicassets` knows only one thing: the contract owns the asset. Who sent it, and who may have it back, is written nowhere else. Without its own table the contract cannot tell whose asset is whose, and an `unstake` could hand one user's NFT to another.

So the handler writes one row per asset, keyed by `asset_id`, with the `owner` and `staked_at`, and `unstake` checks that row before anything is sent back. A second index by owner lists one account's assets.

| Table | Scope | Fields |
|---|---|---|
| `config` (one row) | the contract account | `collection` |
| `stakes` | the contract account | `asset_id`, `owner`, `staked_at` (UTC); second index `byowner` |

## How it works

`setconfig(collection)` stores the collection whose assets can be staked, in a one-row table (see [Singletons](doc:contract-singletons)). Every reader creates his own collection, so it is not a constant in the source. Only the contract account can run it.

The handler listens to `atomicassets::transfer`, which `atomicassets` sends to `from` and to `to`:

```cpp
if (from == get_self() || to != get_self()) return;
check(memo == "stake", "send with the memo stake");
check(asset_ids.size() <= MAX_ASSETS, "stake at most 10 assets in one transfer");
```

- It returns for the contract's own outgoing transfers (the `unstake` transfer notifies it too) and for a notification that another account passed on with `require_recipient`: then `to` is not the contract and nothing arrived. See [Notifications (on_notify)](doc:contract-notifications).
- Everything else is checked with `check`. A failed check refuses the whole transfer, so an asset that is not accepted never leaves its sender.
- `MAX_ASSETS` (10, in the header) keeps the work of one transfer small. `atomicassets` itself refuses an empty list and the same asset twice.

Then it reads each asset in the table `assets` of `atomicassets`:

```cpp
atomic::assets_table assets(ATOMICASSETS, get_self().value);
const auto& a = assets.get(id, "the contract does not hold this asset");
check(a.collection_name == collection, "only assets of the configured collection can be staked");
check(stakes.find(id) == stakes.end(), "this asset is already staked");
```

- The notification comes after `atomicassets` has moved the assets, so they are rows in the scope of the contract account. Only `atomicassets` can write that table, so its `collection_name` can be trusted; the memo and the sender's word cannot.
- The struct `atomic::asset_row` in the header copies the row of the `assets` table field by field from the `atomicassets` ABI: `asset_id`, `collection_name`, `schema_name`, `template_id` (`int32`), `ram_payer`, `backed_tokens`, and the two serialized data fields. It is outside the contract class so that it is not part of this contract's ABI. See [Reading another contract's table](doc:contract-read-other-table).
- The row is paid by the contract (`stakes.emplace(get_self(), ...)`): a notification handler cannot charge the sender's RAM. See [Tables, scopes and payers](doc:contract-tables).

`unstake(owner, asset_ids)` is signed by `owner`. For each asset it reads the row, checks that `owner` staked it and erases the row; then it sends all assets back in one inline transfer, signed by the contract's own `active`, so it needs `eosio.code` (see [The eosio.code permission](doc:eosio-code) and [Inline actions](doc:contract-inline-actions)):

```cpp
check(row.owner == owner, "this asset was staked by another account");
stakes.erase(row); // the row and its RAM go back to the contract
action(permission_level{get_self(), "active"_n}, ATOMICASSETS, "transfer"_n,
       std::make_tuple(get_self(), owner, asset_ids, std::string("unstake")))
    .send();
```

## Why this handler may fail, and a logtransfer handler may not

`atomicassets::transfer` reaches only `from` and `to`. When this handler fails, only a transfer to the contract account is refused, and that is what it is for: the asset stays with the sender.

`atomicassets::logtransfer` reaches the notify accounts of a collection for every movement of its assets. A notify account whose handler fails stops every transfer, sale and offer of the collection. That is why the handler of [Example: AtomicAssets](doc:example-atomicassets) has no `check` at all. This example does not need to be a notify account of the collection, and the setup below does not make it one.

## The other design: the asset stays with the user

A contract can also leave the asset where it is and look up the owner when it pays: read `atomicassets::assets` with the user as scope and check that the asset is there. Nothing is transferred and no row is paid for, but the user can sell or move the asset at any time, so every payout must check again, and "staked since" cannot be known from the chain alone. Holding the asset, as this example does, makes "staked" mean something, and makes the contract's table the only record of whose it is.

## Adding rewards

The example pays nothing. `staked_at` is there for rewards, as `claim_after` is in [Example: Staking](doc:example-staking): a `claim(owner, asset_ids)` signed by the owner would compute the seconds since `staked_at` for each of his rows, pay a fixed amount per hour from the contract account's own tokens with an inline `eosio.token::transfer`, and set `staked_at` to now. Check the sum for overflow and decide where the reward tokens come from before you write it.

## How to do it here

1. File > New Project. Under **Examples** choose **NFT staking**, keep the name `nftstake`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the contract account, press **Request test tokens**, then **Open account** and press the star. The faucet limits how often it creates accounts and sends tokens, and shows its own message when it refuses. The user account (the collection's author, who stakes) is an account you already have or one made from the contract account: on its Account page, section **Create account**, with **RAM (bytes)** `8192` and some **Stake CPU** and **Stake NET** (for example `1.00000000 WAX` each). The user account pays for the collection, the schema, the template and the two assets it mints: about 1,100 bytes. If **Request test tokens** is refused, send WAX to the contract account from an account you have (its Account page, section **Transfer**). The contract listens only to `atomicassets`, so a WAX payment to it works also after deployment.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. The contract account pays for its `config` row (about 230 bytes) and for one `stakes` row per staked asset (about 260 bytes, the first one about 370). The asset itself is not charged to the contract account: its RAM stays with the account that minted it. Open **RAM** on its Account page: when fewer than 2,048 bytes are free, buy 2048 bytes (**By bytes**). Check the user account the same way: when fewer than 2,048 bytes are free, buy 2048 bytes.
6. On the contract account's Account page open **Keys and permissions**. On `active` tick **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. Press **Contracts** in the top bar and open `atomicassets`. In every action of steps 7 to 10 **Authorization** is the user account with `active`. Choose `createcol` and fill in: `author` = the user account; `collection_name` = the user account (a collection named after an existing account needs that account's signature); `allow_notify`: ticked; `authorized_accounts` = `["<user account>"]`; `notify_accounts` = `[]`; `market_fee` = `0.01`; `data` = `[{"key":"name","value":["string","Example collection"]}]`. Press **Run** and approve.
8. Choose `createschema`: `authorized_creator` = the user account, `collection_name` = the user account, `schema_name` = `items`, `schema_format` = `[{"name":"name","type":"string"}]` (every schema needs the attribute `name`). **Run** and approve.
9. Choose `createtempl`: `authorized_creator` = the user account, `collection_name` = the user account, `schema_name` = `items`, `transferable` and `burnable`: ticked, `max_supply` = `10`, `immutable_data` = `[{"key":"name","value":["string","Example item"]}]`. **Run** and approve. Press **Open in inspector**: the action `lognewtempl` shows the new `template_id`. You can also read it later: table `templates`, **Scope** = the user account.
10. Choose `mintasset`: `authorized_minter` = the user account, `collection_name` = the user account, `schema_name` = `items`, `template_id` = the id of step 9, `new_asset_owner` = the user account, `immutable_data` = `[]`, `mutable_data` = `[]`, `tokens_to_back` = `[]`. **Run** and approve. Press **Run** again and approve: two assets.
11. Pick the table `assets`, **Scope** = the user account, **Run query**: two rows with the `template_id` of step 9. Note their `asset_id`s; below they are A and B.
12. Press **Contracts** and open the contract account. Choose `setconfig`: `collection` = the user account. **Authorization**: the contract account with `active`. **Run** and approve.
13. On the `atomicassets` tab choose `transfer`: `from` = the user account, `to` = the contract account, `asset_ids` = `["<A>"]`, `memo` = `test`. **Authorization**: the user account with `active`. **Run**: refused with "send with the memo stake". The asset stays with the user account.
14. To see the collection check without a second collection, point the contract at another one for a moment: on the contract account's tab run `setconfig` with `collection` = `othercollect` (signed by the contract account). Run the transfer of step 13 with `memo` = `stake`: refused with "only assets of the configured collection can be staked". Run `setconfig` with `collection` = the user account again.
15. Run the transfer with `asset_ids` = `["<A>", "<B>"]` and `memo` = `stake`, and approve. On the `atomicassets` tab, table `assets`, **Scope** = the contract account: the two assets. On the contract account's tab, table `stakes`, **Run query**: two rows, `owner` = the user account, `staked_at` = now (UTC).
16. To list one account's stakes, set **Index** to `2`, **Key type** to `name`, **Lower bound** and **Upper bound** to the user account, and press **Run query**. See [Read tables](doc:read-tables).
17. Choose `unstake`: `owner` = the contract account, `asset_ids` = `["<A>"]`. **Authorization**: the contract account with `active`. **Run**: refused with "this asset was staked by another account". Holding the asset does not make it the contract account's: the table decides.
18. Choose `unstake`: `owner` = the user account, `asset_ids` = `["<A>"]`. **Authorization**: the user account with `active`. **Run** and approve. The trace shows the inline `atomicassets::transfer` with the memo `unstake`. `stakes` shows one row (B); `assets` with **Scope** = the user account shows A again.
19. Run `unstake` for `["<B>"]` the same way: `stakes` shows no rows, and both assets are back with the user account.

## What is needed

- A WAX Testnet account for the contract, with RAM for the code, the `config` row and one row per staked asset (steps 4 and 5).
- `eosio.code` on its `active` (step 6), or `unstake` is refused with an error that names `eosio.code`.
- A second account that creates the collection, mints and stakes, with about 2 KB of free RAM.

## What goes wrong, and why

| What you see | Why |
|---|---|
| "send with the memo stake" | The transfer had another memo. It is refused on purpose, so the assets stay with the sender. |
| "only assets of the configured collection can be staked" | The asset belongs to another collection, or `setconfig` names another collection. |
| "staking is not set up yet: run setconfig" | Step 12 is missing. |
| "stake at most 10 assets in one transfer" | Send 10 or fewer assets in one transfer. `unstake` has the same limit ("unstake at most 10 assets at a time"). |
| "this asset was staked by another account" | `unstake` named an asset whose row has another `owner`. |
| "this asset is not staked" | `unstake` named an asset that has no row: it was never staked, or it was already unstaked. |
| "name at least one asset" | `unstake` with an empty `asset_ids`. |
| `unstake` refused, the error names `eosio.code` | Step 6 is missing. |
| The transfer with the memo `stake` is refused with a RAM error | The contract account needs more RAM for the new rows (step 5). |
| "A collection with this name already exists" | The user account made a collection before. Use that collection, or a 12-character name that is not an account. |

## Before you build on it

- The staked assets and assets the contract account holds for other reasons are in one place. The table is the only record of whose each one is, so whoever holds the contract account's keys, or deploys new code to it, controls all of them.
- Only a `transfer` is recorded. An asset that reaches the contract account another way (minted to it with `mintasset`, or an offer its own key accepts) has no row and cannot be unstaked; only the contract account's key can move it.
- The contract pays the RAM of every row: about 260 bytes per staked asset, the first one about 370. Anybody who holds assets of the collection can stake them, so the RAM needed grows with the collection's supply. A real contract keeps enough RAM free, or has users pay for their rows with an action they sign before the transfer. When `unstake` sends an asset to an account that holds no other AtomicAssets asset, the contract also pays 112 bytes for that account's place in the `assets` table, and does not get them back.
- A new deployment that changes the `stakes` row (a field added, for example) can make the stored rows unreadable, and then nobody can unstake. Keep the row as it is, or move the rows to a new table first; see [Changing a table](doc:contract-table-migration).
- Staking here pays no reward (see "Adding rewards").

See also [Example: Staking](doc:example-staking) for staking WAX, [Example: AtomicAssets](doc:example-atomicassets) for minting and the `logtransfer` notification, and [All examples](doc:examples).
