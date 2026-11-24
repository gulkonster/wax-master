# AtomicAssets in short

AtomicAssets is the NFT standard of WAX. Every NFT of every collection lives in one contract, `atomicassets`: you do not deploy an NFT contract of your own. You run its actions from the Contract page to make a collection and mint, and your own contract works with it in two ways: it sends `atomicassets` actions as inline actions (to mint, transfer or burn), and it receives the notifications `atomicassets` sends (to learn that an NFT arrived or moved).

Open it with **Contracts** in the top bar: type `atomicassets`; the program reads its ABI and its tables from the network you selected (see [Run actions](doc:run-actions) and [Read tables](doc:read-tables)). The contract has the same code on WAX Testnet and on WAX Mainnet; its table `tokenconfigs` names the version (`2.0.0` on 2026-11-25).

## The parts

| Part | What it is | Made with | Table (scope) |
|---|---|---|---|
| Collection | The group everything else belongs to. It has an `author`, a list of **authorized accounts**, a list of **notify accounts**, a `market_fee` for sales on the market, and its own data | `createcol` | `collections` (`atomicassets`) |
| Schema | The attribute names and types of the collection's assets, for example `name` as `string`. A schema can be extended with `extendschema`, never changed | `createschema` | `schemas` (the collection) |
| Template | The attribute values that all assets of one kind share, whether they can be transferred and burnt, and `max_supply` (`0`: no limit). `issued_supply` counts the assets minted from it | `createtempl` | `templates` (the collection) |
| Asset | One NFT: an id, its collection, schema and template (`-1`: none), its own attribute data, and the account that pays its RAM | `mintasset` | `assets` (the owner) |
| Offer | A proposed trade of assets between two accounts | `createoffer` | `offers` (`atomicassets`) |

The id of a new template or asset is in the trace: **Open in inspector** after the action and look at `lognewtempl` or `logmint`. They are the log actions of [AtomicAssets notifications](doc:nft-notifications).

## Authorized and notify accounts

- The **author** manages the collection: `addcolauth` and `remcolauth` change the authorized accounts, `addnotifyacc` and `remnotifyacc` the notify accounts, `setmarketfee` and `setcoldata` the fee and the data.
- An **authorized account** may create schemas and templates, mint, and change the mutable data of assets and templates. A contract that mints (a drop, a blend, a game reward) must be one; see [Example: AtomicAssets](doc:example-atomicassets).
- A **notify account** receives the log actions of the collection: every mint, movement, burn and data change. A notify account with a contract can react in the same transaction, and it can also make every one of those actions fail. Add only accounts you control; [AtomicAssets notifications](doc:nft-notifications) explains the rule its contract must keep.
- Notify accounts can be added only while the collection's `allow_notify` is true. `forbidnotify` sets it to false for good: after it `addnotifyacc` is refused with "Adding notify accounts to this collection is not allowed". It needs an empty list of notify accounts first.

## Data: immutable and mutable

- Attribute values are typed by the schema. In the Contract page form an `ATTRIBUTE_MAP` field takes JSON: a list of pairs whose value is `["type", value]`, for example `[{"key":"name","value":["string","Sword"]}]`.
- **Immutable data** of a template or an asset never changes. Put there what defines the item.
- **Mutable data** of an asset can be changed by an authorized account with `setassetdata`: levels, durability, wins. The account that changes it becomes the asset's RAM payer. A template's mutable data is changed with `settempldata` (table `templates2`, scope = the collection).
- In the tables the data is stored as bytes (`immutable_serialized_data`, `mutable_serialized_data`), not as names and values. Reading attribute values inside your own contract needs the AtomicAssets serialization code. A simpler way that these pages use: keep a table of your contract keyed by template id with the values your game needs, and check the asset's `template_id`.

## Who pays the RAM

| Row | Paid by |
|---|---|
| Collection | `author` |
| Schema, template | `authorized_creator` |
| Asset | `authorized_minter`, also after the asset is transferred: the row moves to the new owner's scope and keeps its `ram_payer` |
| The first asset of an account | Also the account's scope in `assets`: the minter, or the sender of a transfer |
| Asset after `setassetdata` | The `authorized_editor` who changed it |
| Asset after `setrampayer` | The owner, who signs `setrampayer(new_payer, asset_id)` to take the RAM over; the old payer's RAM is freed |
| Offer | `sender` |

Burning an asset frees its RAM. A contract that mints in an open action pays for every asset: limit who can call it, as the AtomicAssets example does. The RAM changes of each action are in the inspector. See also [Who pays: RAM and CPU for your users](doc:contract-who-pays).

## Burn

`burnasset(asset_owner, asset_id)`, signed by the owner, deletes the asset when its template is `burnable`, and sends `logburnasset` to the notify accounts with the asset's last data. A burn is how a blend or an upgrade consumes NFTs; see [Example: NFT blend](doc:example-nft-blend).

## Backed tokens

Older assets could hold tokens (`backed_tokens`) that the owner received when burning them. In version 2.0.0 backing is switched off: `backasset`, and `mintasset` with `tokens_to_back` that is not empty, are refused with "Native backing has been deprecated on the AtomicAssets Contract". Burning an asset that still holds tokens adds them to the owner's row in `balances` (scope `atomicassets`); `withdraw(owner, token_to_withdraw)` sends them out.

## Offers

- `createoffer(sender, recipient, sender_asset_ids, recipient_asset_ids, memo)`: one or both sides may hold assets. `lognewoffer` goes to the sender and the recipient.
- The recipient runs `acceptoffer(offer_id)` or `declineoffer(offer_id)`; the sender can `canceloffer(offer_id)`.
- Accepting moves the assets with the memo "Accepted Offer ID: " and the id. The notify accounts receive `logtransfer` for it; no `atomicassets::transfer` is sent, so a contract that listens only to `transfer` does not see assets that arrive through an offer.
- The market contract `atomicmarket` sells assets through offers: the seller offers the asset to `atomicmarket`. [Example: AtomicAssets](doc:example-atomicassets) walks one sale.

## The tables to read

On the `atomicassets` tab pick the table, set **Scope**, then **Run query**.

| Table | Scope | What you find |
|---|---|---|
| `collections` | `atomicassets` | Author, authorized and notify accounts, `allow_notify`, `market_fee`. Use **Lower bound** = the collection name and **Limit** `1` |
| `schemas` | the collection | Attribute names and types |
| `templates` | the collection | `transferable`, `burnable`, `max_supply`, `issued_supply` |
| `assets` | the owner | Every asset the account holds, with `template_id` and `ram_payer` |
| `offers` | `atomicassets` | Open offers; turn on **Reverse** to see the newest first |
| `balances` | `atomicassets` | Tokens an account holds at the contract |
| `config` | `atomicassets` | The next asset id and template id, and the tokens the contract supports |

## How to do it here

The steps that make a collection, a schema and a template from the Contract page are steps 7 to 11 of [Example: AtomicAssets](doc:example-atomicassets), with the JSON of every field. To mint by hand afterwards, choose `mintasset` with **Authorization** = an authorized account: `authorized_minter` = that account, `collection_name`, `schema_name`, `template_id` from those steps, `new_asset_owner` = any account, `immutable_data` = `[]`, `mutable_data` = `[]`, `tokens_to_back` = `[]`. **Run** and approve; the trace shows `logmint` with the new `asset_id`.

See also [AtomicAssets notifications](doc:nft-notifications), [Drops (atomicdropsx)](doc:nft-drops), [Packs (atomicpacksx)](doc:nft-packs), [Example: NFT staking](doc:example-nft-staking) and [Contracts and services a WAX game uses](doc:wax-services).
