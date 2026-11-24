# Packs (atomicpacksx)

A **pack** is an NFT that is opened: the owner sends it to the contract `atomicpacksx`, and in its place he gets new NFTs chosen at random. Each pack has **rolls**; each roll gives one NFT or nothing, chosen by the **odds** of its outcomes. `atomicpacksx` is the pack contract of the makers of AtomicAssets, shared by every collection that uses it. You do not write a contract for a pack: you set it up with actions of `atomicpacksx` from the Contract page, and you mint or sell the pack NFTs like any other asset, for example in a drop (see [Drops (atomicdropsx)](doc:nft-drops)).

`atomicpacksx` has the same code on WAX Testnet and on WAX mainnet (the code hashes were compared on 2026-11-25). Its table `identifier` names its version (`1.2.0` on that day). Its source and README are public on GitHub, in the repository `pinknetworkx/atomicpacks-contract`.

> Note: Opening a pack needs the WAX random number service, `orng.wax`. On WAX Testnet the service does not answer `atomicpacksx`: you can set up a pack, mint it and send it to be opened, but it is never opened. Everything after the `unbox` transfer below is marked "Not tried on WAX Testnet".

## How a pack works

| Step | Who | What |
|---|---|---|
| 1 | The collection's author | Adds `atomicpacksx` as an authorized account of the collection (`atomicassets::addcolauth`). |
| 2 | Anyone | Sends WAX to `atomicpacksx` with the memo `deposit_collection_ram:<collection>`. The bytes bought are the collection's RAM balance (table `rambalances`); opening and claiming are paid from it. |
| 3 | An authorized account | `announcepack`: a new pack with no rolls. `lognewpack` gives the `pack_id`. |
| 4 | The same | `addpackroll`, once per roll: the outcomes and their odds. |
| 5 | The same | `completepack`: names the template of the pack NFTs. From now on the rolls cannot change. |
| 6 | The same | Mints pack NFTs of that template (`atomicassets::mintasset`), or sells them in a drop. |
| 7 | The pack's owner | `atomicassets::transfer` of one pack to `atomicpacksx` with the memo `unbox`. The contract records the opening in `unboxpacks` and asks `orng.wax` for a random number. |
| 8 | `orng.wax`, later | Answers with `atomicpacksx::receiverand`. The contract picks one outcome per roll, writes the results to `unboxassets`, burns the pack and logs `logresult`. |
| 9 | The pack's owner | `claimunboxed`: the results are minted to him. |

Steps 8 and 9 are taken from the public README and source of the contract.

## The odds

A roll is a list of outcomes, each `{ "odds": <number>, "template_id": <id> }`, and a `total_odds` that must equal the sum of the odds. The chance of an outcome is its odds divided by `total_odds`. A `template_id` of `-1` is the empty outcome: the roll gives nothing.

The contract draws a number from 0 to `total_odds` − 1 and walks the outcomes in order, adding up their odds; the first outcome whose sum is larger than the number wins. One roll with three outcomes:

| Outcome | `odds` | Numbers drawn | Chance | In 1,000 packs, about |
|---|---|---|---|---|
| template 101 (common) | 50 | 0-49 | 50 / 100 = 50 % | 500 |
| template 102 (rare) | 30 | 50-79 | 30 / 100 = 30 % | 300 |
| `-1` (nothing) | 20 | 80-99 | 20 / 100 = 20 % | 200 |
| `total_odds` | 100 | | 100 % | 1,000 |

- `total_odds` need not be 100. Use 1000 or 10000 to give chances like 0.1 %: odds `1` of `10000` is 0.01 %.
- The outcomes must be sorted by odds, highest first (equal odds are allowed). Otherwise `addpackroll` is refused with "The outcomes must be sorted in descending order based on their odds".
- Every `odds` must be at least 1. An outcome you do not want is left out, not given 0.
- Each roll is drawn on its own. A pack with three rolls gives up to three NFTs. A roll with one outcome (odds `1`, `total_odds` `1`) always gives its template: a guaranteed slot.
- A pack's expected content is the sum over its rolls: with the roll above and a guaranteed roll, 1,000 packs give about 1,000 guaranteed NFTs, 500 commons, 300 rares and 200 empty rolls.

## What is needed

- A collection with the templates of the outcomes, made before the rolls, each with `max_supply` `0` (no limit). A template with a `max_supply` is refused with "Can only use templates without a max supply".
- One more template for the pack NFT itself, `transferable` and `burnable`, used by no other pack. Its `max_supply` may be set; it limits the number of packs.
- `atomicpacksx` in the collection's `authorized_accounts`. Without it `announcepack` is refused with "The account atomicpacksx is not authorized within the collection".
- The signer of the setup actions in the same list, with free RAM: it pays the rows in `packs` and `packrolls`. The RAM changes in the inspector show how much.
- A RAM balance of the collection at `atomicpacksx`. Without it the `unbox` transfer is refused with "The collection does not have enough RAM to pay for the reserved bytes".

## How to do it here

`<collection>` is your collection, `<author>` an authorized account of it, `<buyer>` a second account. Every action is run from the Contract page: open the contract, choose the action, tick **Raw JSON**, paste the JSON with your names, check **Authorization** (`<author>` unless a step says otherwise), press **Run** and approve. See [Run actions](doc:run-actions).

1. Open `atomicassets` and make three templates in a schema of the collection, as in [Example: AtomicAssets](doc:example-atomicassets), step 9: two for the outcomes with `max_supply` = `0`, and one for the pack with `transferable` and `burnable` ticked. Note the three `template_id`s (`lognewtempl` in the inspector, or table `templates` with **Scope** = `<collection>`).
2. On `atomicassets` run `addcolauth`: `{"collection_name": "<collection>", "account_to_add": "atomicpacksx"}`, signed by the collection's author. Skip it when `atomicpacksx` is already in `authorized_accounts` (table `collections`).
3. Deposit RAM: on the Account page of an account with WAX, section **Transfer**: **To** `atomicpacksx`, **Amount** for example `1`, **Memo** `deposit_collection_ram:<collection>`. Then open `atomicpacksx`, table `rambalances`, **Lower bound** = `<collection>`, **Limit** = `1`: `byte_balance` is the balance in bytes.
4. On the `atomicpacksx` tab run `announcepack`:

```json
{
  "authorized_account": "<author>",
  "collection_name": "<collection>",
  "unlock_time": 0,
  "display_data": "{\"name\":\"Starter pack\",\"description\":\"Two rolls\"}"
}
```

   `unlock_time` is seconds since 1970 (UTC) before which the pack cannot be opened; `0` opens at once. Press **Open in inspector**: `lognewpack` shows the `pack_id`. Table `packs`, **Reverse** on: your row has `pack_template_id` = `-1` (not completed) and `roll_counter` = `0`.

5. Run `addpackroll` for the first roll: the table of "The odds", with your two outcome templates:

```json
{
  "authorized_account": "<author>",
  "pack_id": <pack_id>,
  "outcomes": [
    { "odds": 50, "template_id": <common template> },
    { "odds": 30, "template_id": <rare template> },
    { "odds": 20, "template_id": -1 }
  ],
  "total_odds": 100
}
```

6. Run `addpackroll` again for a guaranteed second roll:

```json
{
  "authorized_account": "<author>",
  "pack_id": <pack_id>,
  "outcomes": [{ "odds": 1, "template_id": <common template> }],
  "total_odds": 1
}
```

   Table `packrolls`, **Scope** = the `pack_id`: two rows, `roll_id` `0` and `1`. A wrong roll can still be removed with `delpackroll` (`authorized_account`, `pack_id`, `roll_id`).

7. Run `completepack`: `{"authorized_account": "<author>", "pack_id": <pack_id>, "pack_template_id": <pack template>}`. In `packs` the row now has your `pack_template_id`. A further `addpackroll` is refused with "The pack has already been completed".
8. Make a pack NFT. On `atomicassets` run `mintasset`:

```json
{
  "authorized_minter": "<author>",
  "collection_name": "<collection>",
  "schema_name": "<schema of the pack template>",
  "template_id": <pack template>,
  "new_asset_owner": "<buyer>",
  "immutable_data": [],
  "mutable_data": [],
  "tokens_to_back": []
}
```

   To sell packs instead, make a drop of the pack template (see [Drops (atomicdropsx)](doc:nft-drops)); each claim then mints one pack.

9. The buyer opens it. On `atomicassets` run `transfer`, **Authorization**: `<buyer>`: `{"from": "<buyer>", "to": "atomicpacksx", "asset_ids": ["<pack asset_id>"], "memo": "unbox"}`. The trace shows the notification to `atomicpacksx` and its inline `orng.wax::requestrand` with `assoc_id` = the pack's `asset_id`. In `atomicpacksx`, table `unboxpacks`, **Lower bound** = the pack's `asset_id`, **Limit** = `1`: the row names the `pack_id` and the `unboxer`. The pack is now owned by `atomicpacksx` (table `assets` of `atomicassets`, **Scope** = `atomicpacksx`).
10. Wait for the result: table `unboxassets`, **Scope** = the pack's `asset_id`. One row per roll, with the `origin_roll_id` and the `template_id` drawn (`-1` for nothing). Not tried on WAX Testnet: `orng.wax` on WAX Testnet does not answer `atomicpacksx`, so this table stays empty and the row in `unboxpacks` stays. On 2026-11-25 the newest `logresult` of `atomicpacksx` on WAX Testnet was of 2025-07-19, and `orng.wax` lists `atomicpacksx` among the contracts it answers the old way (table `legacycb`) on mainnet, not on WAX Testnet.
11. Claim: on `atomicpacksx` run `claimunboxed`, **Authorization**: `<buyer>`: `{"pack_asset_id": "<pack asset_id>", "origin_roll_ids": [0, 1]}`. Each claimed roll that is not `-1` is minted to the buyer and its row is erased; when all are claimed the `unboxpacks` row goes too. Not tried on WAX Testnet: it needs the rows of step 10. Before them it is refused with "No unbox asset with the origin roll id 0 exists".

> Note: On WAX Testnet a pack sent with `unbox` does not come back: it stays with `atomicpacksx` and its result never arrives. Test steps 9 to 11 with one pack you do not need, or stop at step 8.

## Changing a pack

| Action | When | Changes |
|---|---|---|
| `delpackroll` | before `completepack` | removes a roll |
| `setpacktime` | after `completepack` | `new_unlock_time`, which must be in the future |
| `setpackdata` | after `completepack` | `display_data` |
| `withdrawram` | any time | sells `bytes` of the collection's RAM balance and sends the WAX to `recipient` |

The rolls and the pack template cannot change after `completepack`. To change the chances, announce a new pack with a new pack template.

## Tables to read

| Table | Scope | What |
|---|---|---|
| `identifier` | `atomicpacksx` | Contract type and version |
| `packs` | `atomicpacksx` | `pack_id`, collection, `unlock_time`, `pack_template_id` (`-1` = not completed), `roll_counter` |
| `packrolls` | the `pack_id` | The rolls: `outcomes` and `total_odds` |
| `rambalances` | `atomicpacksx` | `byte_balance` of each collection |
| `unboxpacks` | `atomicpacksx` | Packs sent with `unbox` whose results are not all claimed, with the `unboxer` |
| `unboxassets` | the pack's `asset_id` | The results waiting to be claimed |

## What goes wrong, and why

| What you see | Why |
|---|---|
| "The account atomicpacksx is not authorized within the collection" | Step 2 is missing. |
| "The total odds of the outcomes deos not equal the provided total odds" (the contract's spelling) | `total_odds` is not the sum of the odds. |
| "The outcomes must be sorted in descending order based on their odds" | Sort the outcomes, highest odds first. |
| "Each outcome must have positive odds" | An `odds` of `0`. |
| "Can only use templates without a max supply" | An outcome template has a `max_supply`. Make one with `0`. |
| "The pack does not have any rolls" | `completepack` before `addpackroll`. |
| "The template with this id is not transferable." or "... not burnable." | The pack template must be both. |
| "Another pack is already using this template id" | Every pack needs its own pack template. |
| "The pack has already been completed" | Rolls cannot change after `completepack`. |
| "Invalid memo" | The pack was sent with a memo other than `unbox`. |
| "Only one pack can be opened at a time" | `asset_ids` lists more than one asset. |
| "The transferred asset's template does not belong to any pack" | The asset sent is not of a completed pack's template. |
| "The pack has not unlocked yet" | `unlock_time` is in the future. |
| "The collection does not have enough RAM to pay for the reserved bytes" | Step 3 is missing, or the balance is used up. |
| "The transaction needs to be authorized either by the unboxer or by the contract itself" | `claimunboxed` signed by another account than the one that sent the pack. |

See also [Random numbers (ORNG)](doc:contract-random) for how the random number service answers, [AtomicAssets in short](doc:nft-atomicassets) and [Read tables](doc:read-tables).
