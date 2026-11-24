# Drops (atomicdropsx)

A **drop** gives out new NFTs of your collection: anybody who claims it gets freshly minted assets of the templates the drop lists, for free or for a price. The contract `atomicdropsx` is one shared drop contract for every collection; the drops on WAX Testnet are claimed through sites such as AtomicHub (the `referrer` of their claims). You do not write a contract for a drop: you run actions of `atomicdropsx` from the Contract page, and your buyers run one action (and, for a price, one transfer).

`atomicdropsx` has the same code on WAX Testnet and on WAX mainnet (the code hashes were compared on 2026-11-25), so the steps below work on both. Its table `config` names its version (`3.4.0` on that day).

> Note: A drop has no odds. Every claim mints exactly the templates in `assets_to_mint`, one asset of each. Chances belong to packs: sell a pack NFT in a drop, and the pack decides what comes out when it is opened. See [Packs (atomicpacksx)](doc:nft-packs).

## How a drop works

| Step | Who | What |
|---|---|---|
| 1 | The collection's author | Adds `atomicdropsx` as an authorized account of the collection (`atomicassets::addcolauth`). The contract mints in your collection itself. |
| 2 | Anyone | Sends WAX to `atomicdropsx` with the memo `deposit_collection_ram:<collection>`. The contract buys RAM with it and credits the bytes to the collection (table `rambalances`). Every asset a drop mints is paid from this balance. |
| 3 | An authorized account of the collection | Runs `createdrop`: templates, price, limits, times. `lognewdrop` in the trace gives the `drop_id`. |
| 4 | The buyer | For a price: sends the price to `atomicdropsx` with the memo `deposit`. Then runs `claimdrop` (or `claimdropwl` for a drop with a list of allowed accounts). |
| 5 | `atomicdropsx` | Takes the price from the buyer's deposit, sends the price less the fee to the drop's `price_recipient` with the memo "AtomicDrops sale, drop id: " and the id, and mints with `atomicassets::mintasset` to the buyer. |

The drop does not use the random number service: nothing waits, the assets are in the buyer's account when the claim is in a block.

## What is needed

- A collection with a schema and at least one template. How to make them from the Contract page: [AtomicAssets in short](doc:nft-atomicassets) and [Example: AtomicAssets](doc:example-atomicassets), steps 7 to 9. A template's `max_supply` also limits the drop: when it is reached, claims are refused by `atomicassets`.
- `atomicdropsx` in the collection's `authorized_accounts`. Without it `createdrop` is refused with "The account atomicdropsx is not authorized within the collection" and the collection name.
- The account that signs `createdrop` (the `authorized_account`) in the same list, with free RAM for the drop's row: it pays for the row in `drops`. The RAM changes in the inspector show how much.
- A RAM balance of the collection at `atomicdropsx` (step 2 above). It is checked at the claim, not at `createdrop`: a drop without it is created, and every claim is refused with "The collection does not have enough RAM balance to pay for the NFTs to be created".
- For a buyer: WAX for the price, and a little free RAM when the drop has a limit per account (his counter is a row of `accstats`, scope = the buyer, paid by the buyer).

## How to do it here

The steps make a free drop and a drop for 1 WAX on WAX Testnet and claim both from a second account. `<collection>` is your collection, `<author>` an authorized account of it (usually the author), `<template_id>` one of its templates, `<buyer>` the second account. Every action is run from the Contract page: open the contract, choose the action, tick **Raw JSON**, paste the JSON with your names, check **Authorization**, press **Run** and approve. See [Run actions](doc:run-actions).

1. Open `atomicassets`. Choose `addcolauth`: `{"collection_name": "<collection>", "account_to_add": "atomicdropsx"}`. **Authorization**: the collection's author. **Run** and approve. Skip this step when `atomicdropsx` is already in `authorized_accounts` (table `collections`, **Lower bound** = `<collection>`, **Limit** = `1`).
2. Deposit RAM for the collection. On the Account page of any account with WAX, section **Transfer**: **To** `atomicdropsx`, **Amount** for example `1`, **Memo** `deposit_collection_ram:<collection>`. Press **Transfer** and approve. The trace shows `buyramproxy` and `eosio::buyram`. Open `atomicdropsx`, table `rambalances`, **Lower bound** = `<collection>`, **Limit** = `1`, **Run query**: `byte_balance` is the collection's balance in bytes. On 2026-11-25 1 WAX bought 19,584 bytes; the price of RAM changes, so read the trace of your own deposit.
3. On the `atomicdropsx` tab choose `createdrop`. **Authorization**: `<author>`. A free drop, one asset per claim, one claim per account, at most 100 claims, open now and without an end:

```json
{
  "authorized_account": "<author>",
  "collection_name": "<collection>",
  "assets_to_mint": [{ "template_id": <template_id>, "tokens_to_back": [] }],
  "listing_price": "0 NULL",
  "settlement_symbol": "0,NULL",
  "price_recipient": "<author>",
  "auth_required": false,
  "max_claimable": 100,
  "account_limit": 1,
  "account_limit_cooldown": 0,
  "start_time": 0,
  "end_time": 0,
  "display_data": "{\"name\":\"My first drop\",\"description\":\"Free test drop\"}"
}
```

   **Run** and approve, then press **Open in inspector**: the inline action `lognewdrop` shows the new `drop_id`. Pick the table `drops`, **Reverse** on, **Limit** = `5`, **Run query**: your row has `current_claimed` = `0` and the `fee_rate` of the drop.

4. The second account claims it. On the `atomicdropsx` tab choose `claimdrop`, **Authorization**: `<buyer>`:

```json
{
  "claimer": "<buyer>",
  "drop_id": <drop_id of step 3>,
  "claim_amount": 1,
  "intended_delphi_median": 0,
  "referrer": "",
  "country": ""
}
```

   **Run** and approve. The trace shows `atomicassets::mintasset` with `authorized_minter` = `atomicdropsx` and `logmint` with the new `asset_id`. Open `atomicassets`, table `assets`, **Scope** = `<buyer>`: the new asset is there. In `drops` the row now has `current_claimed` = `1`. Run the same `claimdrop` again: refused with "The drop has a maximum per account of 1 and this account already claimed 1".

5. A drop for 1 WAX: run `createdrop` again with the JSON of step 3, changed in two fields: `"listing_price": "1.00000000 WAX"` and `"settlement_symbol": "8,WAX"`. Note the new `drop_id`.
6. The buyer pays first. On the buyer's Account page, section **Transfer**: **To** `atomicdropsx`, **Amount** `1`, **Memo** `deposit`. Press **Transfer** and approve. The WAX is now the buyer's balance at `atomicdropsx`: table `balances` (scope `atomicdropsx`), **Lower bound** = `<buyer>`, **Limit** = `1`.
7. The buyer runs `claimdrop` with the JSON of step 4 and the `drop_id` of step 5. The trace shows a transfer from `atomicdropsx` to the `price_recipient` with the memo "AtomicDrops sale, drop id: " and the id, then the mint. The recipient receives the price less the drop's `fee_rate` (`0.02` in the drops read on 2026-11-25, so 0.98 WAX of 1 WAX). The buyer's row in `balances` is gone when the deposit is used up.

Without the deposit of step 6 the claim is refused with "The account ... does not have the required balance of 1.00000000 WAX", with the buyer's name. A deposit larger than the price stays in `balances`; `withdraw` sends it back: `{"owner": "<buyer>", "token_to_withdraw": "1.00000000 WAX"}`, signed by the buyer, memo "AtomicDrops Withdrawal".

## Prices: free, WAX or USD

The price is two fields, `listing_price` (what the drop costs) and `settlement_symbol` (what the buyer pays with).

| Drop | `listing_price` | `settlement_symbol` | `intended_delphi_median` at the claim |
|---|---|---|---|
| Free | `0 NULL` | `0,NULL` | `0` |
| WAX | `1.00000000 WAX` (8 decimals) | `8,WAX` | `0` |
| USD, paid in WAX | `1.00 USD` (2 decimals) | `8,WAX` | the current median of `delphioracle` |

- The tokens and pairs `atomicdropsx` accepts are in its table `config`: `supported_tokens` (on 2026-11-25: `8,WAX` of `eosio.token`) and `supported_symbol_pairs` (`2,USD` listed, `8,WAX` paid, through the `delphioracle` pair `waxpusd`). Any other symbol or precision is refused with "The symbol used for the listing price and settlement symbol is not supported".
- A free drop needs both `NULL` fields. `0.00000000 WAX` is refused with "To have no price requirement, the listing symbol and settlement symbol must be "NULL, 0"".
- A USD drop is paid in WAX at the price of the oracle. Before the claim, open `delphioracle`, table `datapoints`, **Scope** = `waxpusd`, **Run query**, and copy the `median` of the newest row into `intended_delphi_median`. The contract looks for that median among the oracle's recent values; with `0` or an old value the claim is refused with "No datapoint with the intended median was found. You likely took too long to confirm your transaction". The median is the WAX price in USD with the pair's `quoted_precision` decimals (table `pairs` of `delphioracle`, row `waxpusd`). On WAX Testnet on 2026-11-25 it was `33` with 4 decimals, 0.0033 USD for one WAX, so a 1.00 USD drop took about 303 WAX: the test oracle's price is not the market price. Deposit enough WAX before the claim and withdraw the rest.
- The buyer pays the price `claim_amount` times. A claim of 3 mints the drop's assets 3 times.

## Limits, times and allowed accounts

| Field | Meaning |
|---|---|
| `max_claimable` | Claims in total. `0` = no limit. `current_claimed` in `drops` counts them. |
| `account_limit` | Claims per account. `0` = no limit. A claim of more than the limit is refused with "The drop has a maximum per account of" and the limit. |
| `account_limit_cooldown` | Seconds. `0`: the per-account limit holds for the whole drop. |
| `start_time`, `end_time` | Seconds since 1970 (UTC). `0` = no start or no end. After the end a claim is refused with "This drop has already ended". |
| `auth_required` | `true`: only accounts on the drop's list (or with a key) can claim; `claimdrop` is refused with "Drops that require auth need to be claimed with specialized actions". |
| `display_data` | Text for sites. The drops on WAX Testnet use JSON with `name` and `description`. |
| `tokens_to_back` | Tokens put into each minted asset. Keep it `[]`; backing is not covered here. |

A drop for a list of accounts: create it with `"auth_required": true`, then run `addtowl` signed by `<author>`:

```json
{ "authorized_account": "<author>", "drop_id": <drop_id>, "accounts_to_add": ["<buyer>"] }
```

The buyer claims with `claimdropwl` (the same fields as `claimdrop`). An account not on the list is refused with "The claimer is not whitelisted for this drop". `erasefromwl` (the same fields, `accounts_to_remove`) takes accounts off it. The list is the table `whitelists` with the drop id as **Scope**.

Key claims (`createkey`, `claimdropkey`) and country lists (`setcountries`) exist too; they need data made outside a transaction and are not walked here. Leave `country` empty.

## Changing or ending a drop

All are signed by an authorized account of the collection and take `authorized_account` and `drop_id` first:

| Action | Changes |
|---|---|
| `setdropprice` | `listing_price`, `settlement_symbol` |
| `setdroptimes` | `start_time`, `end_time` |
| `setdropmax` | `new_max_claimable` |
| `setdroplimit` | `account_limit`, `account_limit_cooldown` |
| `setdropauth` | `auth_required` |
| `setdropdata` | `display_data` |
| `erasedrop` | Deletes the drop; its row's RAM goes back to the account that paid it. |

A price can change between the moment a buyer reads it and his claim. Sites put `assertdrop` (the drop id, the templates, the price and the symbol the buyer saw) before the claim in the same transaction; it is refused with "The listing price to assert differs from the listing price of this drop" when the price changed. The Contract page sends one action per transaction, so read `drops` just before you claim.

The collection's RAM balance can be taken back: `withdrawram` (`authorized_account`, `collection_name`, `recipient`, `bytes`) sells the bytes and sends the WAX with the memo "Sold RAM".

## Tables to read

| Table | Scope | What |
|---|---|---|
| `config` | `atomicdropsx` | Version, accepted tokens and USD pairs |
| `drops` | `atomicdropsx` | Every drop: `assets_to_mint`, price, `fee_rate`, limits, `current_claimed` |
| `rambalances` | `atomicdropsx` | `byte_balance` of each collection |
| `balances` | `atomicdropsx` | Buyers' deposits (`identifier` = the account) |
| `accstats` | the buyer | Claims per drop and the last claim time |
| `whitelists` | the drop id | Accounts allowed to claim |

## What goes wrong, and why

| What you see | Why |
|---|---|
| "The account atomicdropsx is not authorized within the collection" | Step 1 is missing. |
| "The account ... is not authorized within the collection" with the signer's name | The signer of `createdrop` is not an authorized account of the collection. |
| "The template ... is not part of the collection" | `assets_to_mint` names a template of another collection. |
| "The collection does not have enough RAM balance to pay for the NFTs to be created" | Step 2 is missing, or the balance is used up. Deposit again. |
| "Must inrease the collection ram balance by at least 128 to pay for the table entry" | The first deposit for a collection was too small. |
| "No collection with this name exists: " and a name | The memo of the RAM deposit names a collection that does not exist. |
| "invalid memo" | A WAX transfer to `atomicdropsx` with a memo other than `deposit` or `deposit_collection_ram:` and a collection. |
| "The account ... does not have the required balance of" and the price | The buyer did not deposit the price (step 6). |
| "No datapoint with the intended median was found" | A USD drop with a missing or old median. |
| "This drop has already ended" | `end_time` has passed. |
| "The claimer is not whitelisted for this drop" | `auth_required` drop and the buyer is not on its list. |
| A refusal with a RAM error naming the buyer | The buyer has too little free RAM for his `accstats` row. |

NeftyBlocks runs its own drop contract, `neftyblocksd`, with the same idea and more options; it is not walked here. See also [AtomicAssets in short](doc:nft-atomicassets), [Packs (atomicpacksx)](doc:nft-packs) and [Read tables](doc:read-tables).
