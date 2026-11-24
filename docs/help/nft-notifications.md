# AtomicAssets notifications (logmint, logtransfer, ...)

After most of its actions `atomicassets` runs a **log action** on itself as an inline action: `logmint` after a mint, `logtransfer` after a movement, `logburnasset` after a burn, and so on. A log action does nothing but notify accounts with `require_recipient`. A contract on such an account handles it with `[[eosio::on_notify("atomicassets::logmint")]]`, in the same transaction. This is how a game contract learns that an NFT of its collection was minted, moved, burnt or changed, whoever did it: the game's own action, a player, a market or another contract.

Most log actions go to the collection's **notify accounts**. The collection's author adds your contract account to that list with `addnotifyacc`. For notifications in general see [Notifications (on_notify)](doc:contract-notifications); for collections and authorized accounts see [AtomicAssets in short](doc:nft-atomicassets).

## The log actions

The fields are those of the ABI of `atomicassets` (version 2.0.0), in their order. A handler declares the same types in the same order.

| Log action | Sent after | Fields | Who receives it |
|---|---|---|---|
| `logmint` | `mintasset` | `asset_id` uint64, `authorized_minter` name, `collection_name` name, `schema_name` name, `template_id` int32, `new_asset_owner` name, `immutable_data` ATTRIBUTE_MAP, `mutable_data` ATTRIBUTE_MAP, `backed_tokens` asset[], `immutable_template_data` ATTRIBUTE_MAP | The new owner and the notify accounts |
| `logtransfer` | `transfer`, an accepted offer, a sale on the market | `collection_name` name, `from` name, `to` name, `asset_ids` uint64[], `memo` string | The notify accounts |
| `logburnasset` | `burnasset` | `asset_owner` name, `asset_id` uint64, `collection_name` name, `schema_name` name, `template_id` int32, `backed_tokens` asset[], `old_immutable_data` ATTRIBUTE_MAP, `old_mutable_data` ATTRIBUTE_MAP, `asset_ram_payer` name | The notify accounts |
| `logsetdata` | `setassetdata` | `asset_owner` name, `asset_id` uint64, `old_data` ATTRIBUTE_MAP, `new_data` ATTRIBUTE_MAP | The notify accounts |
| `lognewtempl` | `createtempl` | `template_id` int32, `authorized_creator` name, `collection_name` name, `schema_name` name, `transferable` bool, `burnable` bool, `max_supply` uint32, `immutable_data` ATTRIBUTE_MAP | The notify accounts |
| `logsetdatatl` | `settempldata` | `collection_name` name, `schema_name` name, `template_id` int32, `old_data` ATTRIBUTE_MAP, `new_data` ATTRIBUTE_MAP | The notify accounts |
| `logrampayer` | `setrampayer`, `setlastpayer` | `asset_owner` name, `asset_id` uint64, `old_ram_payer` name, `new_ram_payer` name | The notify accounts |
| `lognewoffer` | `createoffer` | `offer_id` uint64, `sender` name, `recipient` name, `sender_asset_ids` uint64[], `recipient_asset_ids` uint64[], `memo` string | The sender and the recipient, not the notify accounts |
| `logbackasset` | `backasset`, which version 2.0.0 refuses | `asset_owner` name, `asset_id` uint64, `backed_token` asset | No new ones: `backasset` is refused with "Native backing has been deprecated on the AtomicAssets Contract" |

Two notifications are not log actions: `atomicassets::transfer` notifies `from` and `to`, and `acceptoffer` notifies the offer's sender and recipient. Both reach the accounts themselves, whatever the collection.

- `logtransfer` is the one to listen to for movements: it comes for every movement, also through an offer or a sale, while `transfer` comes only for the action `transfer`. A transfer of assets of two collections sends one `logtransfer` per collection.
- `logmint` also reaches the new owner. A contract that receives a minted asset hears `logmint` even when it is not a notify account of that collection.
- `logburnasset` runs after the asset row is erased: its data is the only place the burnt asset's collection, template and data are still found.
- `ATTRIBUTE_MAP` is a list of pairs: a string key and a value that can be one of 22 types (`int8` to `uint64`, `float32`, `float64`, `string` and lists of them). In JSON: `[{"key":"name","value":["string","Sword"]}]`.

## Becoming a notify account

1. The collection's `allow_notify` must be true (`createcol` sets it; `forbidnotify` turns it off for good).
2. The author runs `atomicassets::addnotifyacc(collection_name, account_to_add)`. Adding an account twice is refused with "The account is already a notify account".
3. `remnotifyacc(collection_name, account_to_remove)`, signed by the author, removes it. This is the way out when a notify account's contract fails.
4. `forbidnotify(collection_name)` stops new notify accounts for good. It is refused with "The collection's notify_accounts vector must be empty" while the list has accounts.

Only the author can do this, so only a collection you control (or whose author trusts you) can be listened to this way. For other collections your contract hears what concerns its own account: `transfer` and `acceptoffer` when assets come or go, `logmint` when assets are minted to it, `lognewoffer` when it is part of an offer. See [Example: NFT staking](doc:example-nft-staking).

## The rule: a notify account's handler never fails

The handler of a notify account runs inside the action of `atomicassets` that notified it. If it fails, that action fails: the mint, the transfer, the sale on the market or the burn is refused, for every holder of the collection's assets. So a handler of a notify account:

- has no `check`: it returns for everything it does not handle;
- does not depend on RAM it may not have: the sample creates its rows in an action signed by the contract account, and the handlers only change those rows;
- stays short: it runs in every transaction of the collection, and its CPU time is billed to that transaction, not to your contract;
- keeps reading its stored rows after an update. A new deployment that changes a stored struct makes the handler fail on the old row; see [Changing a table](doc:contract-table-migration).

A handler on `atomicassets::transfer` of your own account is different: failing there refuses only transfers to your contract, and that is how a contract refuses NFTs it does not accept. The [NFT staking example](doc:example-nft-staking) does that on purpose.

## Only the leading fields

Several log actions carry attribute maps, often after the fields a game needs. A handler may declare only the leading fields, up to the last one it uses, and leave the rest out: the contract reads the parameters it declares from the start of the data and ignores what follows. The sample does that for `logmint`, `logburnasset`, `logsetdata`, `lognewtempl` and `logsetdatatl`, so it needs no attribute map type.

A field after a map can only be read with the map's full type in front of it: `asset_ram_payer` of `logburnasset`, or `backed_tokens` of `logmint`.

Not tried on WAX Testnet: the sample was built, not yet deployed; reading only the leading fields follows from how the contract's generated code reads action data.

## Who can send them, and checking the collection

Only `atomicassets` can run its log actions: each one needs the authority of `atomicassets` itself. `"atomicassets::logmint"` in `on_notify` also makes sure the handler runs only for the notification of that contract. But every account that receives a notification can pass it on with `require_recipient`: a notify account of another collection, or the new owner of a mint. So:

- Check the collection. `logmint`, `logtransfer`, `logburnasset`, `lognewtempl` and `logsetdatatl` carry it. `logsetdata` and `logrampayer` do not: the asset still exists when they run, so look it up in the table `assets` of `atomicassets` (scope = `asset_owner`) and read its `collection_name`.
- A notification can arrive twice, when an account that received it passes it on. A handler that writes one row per asset keys the row by `asset_id`, so a repeat changes nothing.

## Example

A complete contract that counts the log notifications of one collection. `setcol` names the collection and creates one row per log action; each handler adds one to its row and writes the last id and account. The printed line shows in the inspector's **Console** when the endpoint returns console output.

```cpp
#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>
#include <eosio/singleton.hpp>
using namespace eosio;

// The assets table of atomicassets (scope = the owner), described to read the
// collection of an asset. Outside the class, so it is not part of this ABI.
namespace atomic {
  struct asset_row {
    uint64_t             asset_id;
    name                 collection_name;
    name                 schema_name;
    int32_t              template_id;
    name                 ram_payer;
    std::vector<asset>   backed_tokens;
    std::vector<uint8_t> immutable_serialized_data;
    std::vector<uint8_t> mutable_serialized_data;
    uint64_t primary_key() const { return asset_id; }
  };
  typedef multi_index<"assets"_n, asset_row> assets_table;
}

// Counts the AtomicAssets log notifications of one collection. The contract
// account must be a notify account of that collection (atomicassets::addnotifyacc).
class [[eosio::contract("nftlog")]] nftlog : public contract {
public:
  using contract::contract;

  // Signed by the contract account: the collection to listen to. It also
  // creates one counter row per log action now, paid by the contract, so the
  // handlers only change rows that exist and never need new RAM.
  [[eosio::action]]
  void setcol(name collection) {
    require_auth(get_self());
    config_table cfg(get_self(), get_self().value);
    cfg.set(config{collection}, get_self());
    counters_table counters(get_self(), get_self().value);
    for (name kind : {"logmint"_n, "logtransfer"_n, "logburnasset"_n, "logsetdata"_n,
                      "lognewtempl"_n, "logsetdatatl"_n, "logrampayer"_n, "lognewoffer"_n}) {
      if (counters.find(kind.value) == counters.end()) {
        counters.emplace(get_self(), [&](auto& row) { row.kind = kind; });
      }
    }
  }

  // Every handler below returns for what it does not count and never calls
  // check(): a notify account whose handler fails stops the action of
  // atomicassets that notified it, for everybody in the collection.

  // To the new owner and the notify accounts. Only the leading fields are
  // declared; the attribute maps after new_asset_owner are not read.
  [[eosio::on_notify("atomicassets::logmint")]]
  void on_logmint(uint64_t asset_id, name authorized_minter, name collection_name,
                  name schema_name, int32_t template_id, name new_asset_owner) {
    if (!ours(collection_name)) return;
    record("logmint"_n, asset_id, new_asset_owner);
  }

  // To the notify accounts: every movement, a transfer or an accepted offer.
  [[eosio::on_notify("atomicassets::logtransfer")]]
  void on_logtransfer(name collection_name, name from, name to,
                      std::vector<uint64_t> asset_ids, std::string memo) {
    if (!ours(collection_name) || asset_ids.empty()) return;
    record("logtransfer"_n, asset_ids[0], to);
  }

  // To the notify accounts. The asset row is already gone when this runs.
  [[eosio::on_notify("atomicassets::logburnasset")]]
  void on_logburnasset(name asset_owner, uint64_t asset_id, name collection_name,
                       name schema_name, int32_t template_id, std::vector<asset> backed_tokens) {
    if (!ours(collection_name)) return;
    record("logburnasset"_n, asset_id, asset_owner);
  }

  // To the notify accounts. The data has no collection name: the asset is
  // looked up in atomicassets::assets.
  [[eosio::on_notify("atomicassets::logsetdata")]]
  void on_logsetdata(name asset_owner, uint64_t asset_id) {
    if (!ours(collection_of(asset_owner, asset_id))) return;
    record("logsetdata"_n, asset_id, asset_owner);
  }

  // To the notify accounts, after a new template.
  [[eosio::on_notify("atomicassets::lognewtempl")]]
  void on_lognewtempl(int32_t template_id, name authorized_creator, name collection_name,
                      name schema_name, bool transferable, bool burnable, uint32_t max_supply) {
    if (!ours(collection_name) || template_id < 0) return;
    record("lognewtempl"_n, template_id, authorized_creator);
  }

  // To the notify accounts, after settempldata (the mutable data of a template).
  [[eosio::on_notify("atomicassets::logsetdatatl")]]
  void on_logsetdatatl(name collection_name, name schema_name, int32_t template_id) {
    if (!ours(collection_name) || template_id < 0) return;
    record("logsetdatatl"_n, template_id, schema_name);
  }

  // To the notify accounts, after setrampayer or setlastpayer.
  [[eosio::on_notify("atomicassets::logrampayer")]]
  void on_logrampayer(name asset_owner, uint64_t asset_id, name old_ram_payer, name new_ram_payer) {
    if (!ours(collection_of(asset_owner, asset_id))) return;
    record("logrampayer"_n, asset_id, new_ram_payer);
  }

  // Not to the notify accounts: to the sender and the recipient of the offer.
  [[eosio::on_notify("atomicassets::lognewoffer")]]
  void on_lognewoffer(uint64_t offer_id, name sender, name recipient,
                      std::vector<uint64_t> sender_asset_ids,
                      std::vector<uint64_t> recipient_asset_ids, std::string memo) {
    if (sender != get_self() && recipient != get_self()) return;
    record("lognewoffer"_n, offer_id, sender == get_self() ? recipient : sender);
  }

  struct [[eosio::table]] config {
    name collection;
  };
  typedef singleton<"config"_n, config> config_table;

  // One row per log action: how many arrived, and the last id and account.
  struct [[eosio::table]] counter {
    name     kind;
    uint64_t count = 0;
    uint64_t last_id = 0;
    name     last_account;
    uint64_t primary_key() const { return kind.value; }
  };
  typedef multi_index<"counters"_n, counter> counters_table;

private:
  bool ours(name collection) {
    config_table cfg(get_self(), get_self().value);
    return cfg.exists() && cfg.get().collection == collection;
  }

  name collection_of(name owner, uint64_t asset_id) {
    atomic::assets_table assets("atomicassets"_n, owner.value);
    auto it = assets.find(asset_id);
    return it == assets.end() ? name() : it->collection_name;
  }

  void record(name kind, uint64_t id, name account) {
    counters_table counters(get_self(), get_self().value);
    auto it = counters.find(kind.value);
    if (it == counters.end()) return; // setcol has not run
    counters.modify(it, same_payer, [&](auto& row) {
      row.count += 1;
      row.last_id = id;
      row.last_account = account;
    });
    print(kind, " ", id, " ", account, "; "); // shown in the trace's console
  }
};
```

- The handlers are not actions: they are not in the ABI and nobody can call them.
- The contract sends no inline action, so it needs no `eosio.code`.
- `setcol` is paid by the contract account (one `config` row and eight `counters` rows). The handlers never add a row.
- A real game replaces `record` with its own work: give a reward when an asset of a template is minted to a player, update a player's row when an asset leaves him, free a slot when an asset is burnt. Keep the rule above: never fail, and pay only for rows the contract can afford.

## How to do it here

You need the contract account, and a collection whose author you can sign for, with `allow_notify` ticked, a schema `items` (attribute `name` as `string`) and a burnable, transferable template. The collection of [Example: AtomicAssets](doc:example-atomicassets), steps 7 to 9, is such a collection; there the user account is the author and an authorized account. A second account receives a transfer.

1. File > New Project, name `nftlog`. Replace the source file in `src/` with the example above, in one file as it is. Contract > Build (Ctrl+B): no errors.
2. Select WAX Testnet. Contract > Deploy to the contract account with `active`; if the dialog says RAM is missing, press **Buy RAM**, approve, then **Deploy**. Keep about 2 KB of RAM free for the rows of step 3.
3. Press **Contracts**, open the contract account, choose `setcol`: `collection` = your collection. **Authorization**: the contract account. **Run** and approve. Table `counters`, **Run query**: eight rows with `count` `0`.
4. Open `atomicassets`, choose `addnotifyacc`: `collection_name` = your collection, `account_to_add` = the contract account. **Authorization**: the author. **Run** and approve. Table `collections`, **Lower bound** = the collection, **Limit** `1`: `notify_accounts` lists the contract account.
5. `mintasset` with **Authorization** = the author: `authorized_minter` = the author, `collection_name`, `schema_name` = `items`, `template_id` = your template, `new_asset_owner` = the author, `immutable_data`, `mutable_data` and `tokens_to_back` = `[]`. **Run** and approve. In the inspector `logmint` goes to the author and to the contract account. `counters`: `logmint` has `count` `1` and `last_id` = the new `asset_id`.
6. `transfer`: `from` = the author, `to` = the second account, `asset_ids` = `["<asset_id>"]`, `memo` = `test`. `counters`: `logtransfer` `1`, `last_account` = the second account.
7. `setassetdata`: `authorized_editor` = the author, `asset_owner` = the second account, `asset_id`, `new_mutable_data` = `[{"key":"name","value":["string","Changed"]}]`. `counters`: `logsetdata` `1`.
8. `createtempl` with a new template of the same schema (as in step 9 of the example). `counters`: `lognewtempl` `1`, `last_id` = the new `template_id`.
9. `settempldata`: `authorized_editor` = the author, `collection_name`, `template_id` = your first template, `new_mutable_data` = `[{"key":"name","value":["string","Changed"]}]`. `counters`: `logsetdatatl` `1`.
10. `setrampayer` with **Authorization** = the second account: `new_payer` = the second account, `asset_id`. `counters`: `logrampayer` `1`.
11. `createoffer` with **Authorization** = the second account: `sender` = the second account, `recipient` = the contract account, `sender_asset_ids` = `["<asset_id>"]`, `recipient_asset_ids` = `[]`, `memo` = `test`. `counters`: `lognewoffer` `1`. Then `canceloffer` with the `offer_id` from the inspector (table `offers`), signed by the second account.
12. `burnasset` with **Authorization** = the second account: `asset_owner` = the second account, `asset_id`. `counters`: `logburnasset` `1`.
13. `backasset`: refused with "Native backing has been deprecated on the AtomicAssets Contract". Nothing changes.
14. Optional: `remnotifyacc` signed by the author, then mint again: `logmint` stays at `1`, because the contract is no longer told.

## What goes wrong, and why

| What you see | Why |
|---|---|
| `counters` is empty | `setcol` (step 3) is missing: the handlers return without counting. |
| All counts stay `0` after a mint | The contract is not a notify account (step 4), or `setcol` names another collection. |
| "Adding notify accounts to this collection is not allowed" | The collection was made with `allow_notify` off, or `forbidnotify` was run. Use another collection. |
| Every mint and transfer of the collection is refused with an error from your contract's handler | A handler of a notify account failed. The author runs `remnotifyacc`; then fix the contract. |
| A refusal with a RAM error | The account that pays the new row needs more RAM: the author for `mintasset` and `setassetdata`, the second account for `createoffer`. See [AtomicAssets in short](doc:nft-atomicassets), "Who pays the RAM". |
| `lognewoffer` stays at `0` | The offer did not name the contract account: `lognewoffer` goes only to the sender and the recipient. |

See also [AtomicAssets in short](doc:nft-atomicassets), [Example: AtomicAssets](doc:example-atomicassets) (a `logtransfer` handler in a complete project) and [Notifications (on_notify)](doc:contract-notifications).
