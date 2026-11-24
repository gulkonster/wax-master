# Example: AtomicAssets

A minter for AtomicAssets, the NFT standard of WAX. `mint` gives every account one asset of your template; the contract mints it itself with an inline `atomicassets::mintasset`. A notification handler counts the assets of your collection that arrive at the contract account. It teaches how a contract becomes an authorized and a notified account of a collection, how to limit what an open action can cost the contract, and why a collection's notification handler must never fail.

The project is in File > New Project > **Examples** > **AtomicAssets**. Its `README.md` has the same steps as this page.

> Note: The example is there to learn from. It is not audited; do not hold real value with it unchanged.

## AtomicAssets in short

Everything lives in the contract `atomicassets`. A **collection** has an author, a list of **authorized accounts** (they may create schemas and templates and mint) and a list of **notify accounts** (they hear about every movement of the collection's assets). A **schema** names the attributes of its assets, for example `name`. A **template** holds the attribute values that all its assets share, and a `max_supply`. An **asset** belongs to an account; it is a row of the table `assets` with the owner as scope.

Attribute values are typed. In the Contract page form an `ATTRIBUTE_MAP` field takes JSON: a list of pairs whose value is `["type", value]`, for example `[{"key":"name","value":["string","Example item"]}]`.

## How it works

`setconfig(collection, schema, template_id)` stores what `mint` mints from, in a one-row table (see [Singletons](doc:contract-singletons)). Every reader creates his own collection, so these are not constants in the source. Only the contract account can run it.

`mint(owner)` checks that `owner` signed and has not minted before, records `owner` (the row is paid by `owner`, who signed), and mints with an inline action:

```cpp
check(minted.find(owner.value) == minted.end(), "this account has already minted");
minted.emplace(owner, [&](auto& row) { row.owner = owner; });

action(permission_level{get_self(), "active"_n}, ATOMICASSETS, "mintasset"_n,
       std::make_tuple(get_self(), c.collection, c.schema, c.template_id, owner,
                       empty_attributes{}, empty_attributes{}, std::vector<asset>{}))
  .send();
```

- The first field of `mintasset` is the `authorized_minter`: the contract account. It must be an authorized account of the collection, and it signs with its own `active` permission, so it needs `eosio.code`; see [The eosio.code permission](doc:eosio-code) and [Inline actions](doc:contract-inline-actions).
- The authorized minter pays the RAM of the asset: about 150 bytes, the first asset of an account about 260. An open `mint` without a limit would let anyone mint until the contract account's RAM is gone. The example allows one asset per account, and the template's `max_supply` caps the total.
- The two attribute maps are sent empty: the template holds the data. An empty map is written as a zero count whatever its value type, so the source uses a short placeholder type instead of copying the attribute types of `atomicassets`.

## The notification

`atomicassets` sends two notifications when assets move:

| Notification | Who receives it | When |
|---|---|---|
| `atomicassets::transfer` | `from` and `to` | a `transfer` action only |
| `atomicassets::logtransfer(collection_name, from, to, asset_ids, memo)` | the collection's notify accounts | every movement of the collection's assets, also an accepted offer (which sends no `transfer`) |

The example listens to `logtransfer`. That is why the setup adds the contract as a notify account, why the handler gets the collection name without reading a table of `atomicassets`, and why it also sees assets that arrive through an offer.

```cpp
if (to != get_self()) return;
config_table cfg(get_self(), get_self().value);
if (!cfg.exists()) return;
auto c = cfg.get();
if (collection_name != c.collection) return;
c.received += asset_ids.size();
c.last_sender = from;
cfg.set(c, same_payer);
```

- A notify account that fails stops the action that notified it, so a failing handler would block every transfer, sale and offer of the collection. The handler has no `check`: it returns for everything it does not count.
- It only changes a row that exists and keeps its size, so it never needs new RAM. A handler that added a row per asset could fail when the contract account's RAM runs out.
- A handler on `atomicassets::transfer` instead would hear about assets of any collection sent to the contract. It must look the asset up in the table `assets` (scope = the contract account) and check its `collection_name` before it trusts it. See [Notifications (on_notify)](doc:contract-notifications).

| Table | Scope | Fields |
|---|---|---|
| `config` (one row) | the contract account | `collection`, `schema`, `template_id`, `received`, `last_sender` |
| `minted` | the contract account | `owner` |

## How to do it here

1. File > New Project. Under **Examples** choose **AtomicAssets**, keep the name `minter`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the contract account, press **Request test tokens**, then **Open account** and press the star. The faucet creates only one account a day, so the user account (the collection's author, who also mints) is either an account you already have or one made from the contract account: on its Account page, section **Create account**, with **RAM (bytes)** `8192` and some **Stake CPU** and **Stake NET** (for example `1.00000000 WAX` each). The user account pays for the collection, the schema, the template and its own `minted` row: about 1,000 bytes.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. The contract account pays for every asset it mints (about 150 bytes; the first asset of an account about 260) and for its `config` row (about 260). Open **RAM** on its Account page: when fewer than 2,048 bytes are free, buy 2048 bytes (**By bytes**). Check the user account the same way: when fewer than 2,048 bytes are free, buy 2048 bytes.
6. On the contract account's Account page open **Keys and permissions**. On `active` use the switch **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
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

## The market side: a sale on AtomicMarket

Assets are sold on `atomicmarket`, the market contract the AtomicHub site uses. A sale is two actions of the seller and two of the buyer, all from the Contract page. The fields below sell the asset of step 14 for 2 WAX; do it before step 16, or with an asset that is still in the user account. The buyer is another account with at least 2 WAX.

1. Seller: open `atomicmarket`, choose `announcesale`: `seller` = the user account, `asset_ids` = `["<asset_id>"]`, `listing_price` = `2.00000000 WAX`, `settlement_symbol` = `8,WAX`, `maker_marketplace` empty (the marketplace with the empty name exists). **Authorization**: the user account. **Run** and approve.
2. Seller: open `atomicassets`, choose `createoffer`: `sender` = the user account, `recipient` = `atomicmarket`, `sender_asset_ids` = `["<asset_id>"]`, `recipient_asset_ids` = `[]`, `memo` = `sale`. **Run** and approve. The offer makes the sale active; the asset stays with the seller until it is bought.
3. On the `atomicmarket` tab pick the table `sales`, **Reverse** on, **Run query**: the row with your `asset_ids` has the `sale_id` and the `offer_id`.
4. Buyer: on the buyer's Account page, section **Transfer**: **To** `atomicmarket`, **Amount** `2`, **Memo** `deposit`. Press **Transfer** and approve. The WAX is now the buyer's balance at the market (table `balances`, scope `atomicmarket`).
5. Buyer: on the `atomicmarket` tab choose `purchasesale`: `buyer` = the buyer, `sale_id` = the id of step 3, `intended_delphi_median` = `0`, `taker_marketplace` empty. **Authorization**: the buyer. **Run** and approve.
6. The asset is in the table `assets` with the buyer as scope. The seller received the price less the fees in a transfer with the memo "AtomicMarket Sale Payout - ID #" and the sale id. The fees are read from `atomicmarket`'s tables `config` and `bonusfees`; on WAX Testnet today they are 1 % for the maker marketplace, 1 % for the taker marketplace, a 2 % "Tokenomics Fee" and the collection's `market_fee` (1 % here), so 1.90 WAX. The collection's fee is not sent: it is added to the collection author's balance at the market (here the seller; table `balances`, scope `atomicmarket`). The sale moved the asset by accepting the offer: the contract received `logtransfer` (with `to` = the buyer, so it counted nothing), but no `atomicassets::transfer`.

`cancelsale(sale_id)`, signed by the seller, ends a sale that was not bought. `withdraw(owner, token_to_withdraw)` sends a balance at the market to its owner: a buyer's unused deposit, or the author's collection fees. Sales in WAX and TLM are supported on WAX Testnet.

## What is needed

- A WAX Testnet account for the contract, with RAM for the code, the `config` row and every asset it mints (steps 4 and 5).
- `eosio.code` on its `active` (step 6), or `mint` is refused with an error that names `eosio.code`.
- A second account that creates the collection and mints, with about 2 KB of free RAM.

## What goes wrong, and why

| What you see | Why |
|---|---|
| `mint` refused, the error names `eosio.code` | Step 6 is missing. |
| "The minter is not authorized within the collection" | Step 10 is missing, or `setconfig` names another collection. |
| "run setconfig first" | Step 12 is missing. |
| "this account has already minted" | One asset per account, on purpose. |
| "The template's maxsupply has already been reached" | `max_supply` assets are minted. Make a new template (step 9) and run `setconfig` with its id. |
| `config` still shows `received` = `0` after step 16 | The contract is not a notify account of the collection (step 11), or `setconfig` names another collection. |
| "A collection with this name already exists" | The user account made a collection before. Use that collection, or a 12-character name that is not an account. |
| A refusal with a RAM error | The account that pays for the new row needs more RAM (step 5). |

## Before you build on it

- The contract account pays the RAM of every asset it mints. `mint` is limited to one per account and the template has a `max_supply`, but anybody can still make new accounts and mint until `max_supply` is reached. A real drop also takes a payment or checks a list of allowed accounts.
- The row in `minted` is paid by the caller and stays: it is the limit. An action that removed it would let the account mint again.
- Assets sent to the contract account stay with it: the contract has no action that sends them on, and only the contract account's own key can move them.

See also [Example: Transfer listener](doc:example-transfer-listener) for a notification handler on `eosio.token`, and [All examples](doc:examples).
