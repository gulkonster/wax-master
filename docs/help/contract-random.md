# Random numbers (ORNG)

A contract cannot make a random number by itself. Everything it can read in an action is known to the sender, or to a block producer, before the transaction runs: the block time, the TAPOS fields, the transaction id, table contents, the hash of any of them. A player can try transactions until one of them wins, or let his own contract refuse the transaction when the result is bad, so he only ever pays for wins.

WAX runs a random number service for contracts, the WAX RNG oracle, on the account `orng.wax`. Your contract asks for a number; the service answers in a **later transaction**: `orng.wax` runs its own action `randnotify` and notifies your contract, which handles the notification. The result is not known when the request is sent, and the request cannot be undone when the result is bad.

## The protocol

| Step | Who | Action |
|---|---|---|
| 1 | Your contract, inline | `orng.wax::requestrand(assoc_id, signing_value, caller)` signed by `yourcontract@active` |
| 2 | The service | Produces the value off the chain and proves it on the chain |
| 3 | `orng.wax` | Runs its own action `randnotify(request_id, dapp, assoc_id, rnd)` and notifies the account in `dapp`; your contract handles it with `[[eosio::on_notify("orng.wax::randnotify")]]` |

- `assoc_id` (`uint64_t`): your own number to match the answer with the request, for example the row id of the game.
- `signing_value` (`uint64_t`): a value never used before; the service refuses a repeated one. Derive it from the transaction id and your row id, as below.
- `caller` (`name`): your contract account, which is notified of the answer.
- `request_id` (`uint64_t`): the service's own number for the request.
- `dapp` (`name`): the contract the answer is for.
- `rnd` (`checksum256`): 32 random bytes.

Because step 1 is an inline action, the contract account needs `eosio.code` on `active`; see [Inline actions](doc:contract-inline-actions). Step 3 is a notification; see [Notifications (on_notify)](doc:contract-notifications).

## Example

A complete dice contract: `roll` stores a row and asks for a number; the handler of `randnotify` writes the result 1 to 6.

```cpp
#include <eosio/eosio.hpp>
#include <eosio/crypto.hpp>
#include <eosio/transaction.hpp>
#include <cstring>
using namespace eosio;

class [[eosio::contract("dice")]] dice : public contract {
public:
  using contract::contract;

  struct [[eosio::table]] roll_row {
    uint64_t id;
    name     player;
    uint8_t  result = 0;   // 0 while the answer is pending
    uint64_t primary_key() const { return id; }
  };
  typedef multi_index<"rolls"_n, roll_row> rolls_table;

  [[eosio::action]]
  void roll(name player) {
    require_auth(player);
    rolls_table rolls(get_self(), get_self().value);
    uint64_t id = rolls.available_primary_key();
    rolls.emplace(player, [&](auto& row) {
      row.id = id;
      row.player = player;
    });

    // A signing value that was never used: the transaction id mixed with the row id.
    size_t size = transaction_size();
    std::vector<char> trx(size);
    read_transaction(trx.data(), size);
    auto trx_id = sha256(trx.data(), size).extract_as_byte_array();
    uint64_t signing_value;
    std::memcpy(&signing_value, trx_id.data(), sizeof(signing_value));
    signing_value += id;

    action(permission_level{get_self(), "active"_n}, "orng.wax"_n, "requestrand"_n,
      std::make_tuple(id, signing_value, get_self())).send();
  }

  // The answer: orng.wax runs its own action randnotify and notifies this contract.
  [[eosio::on_notify("orng.wax::randnotify")]]
  void on_random(uint64_t request_id, name dapp, uint64_t assoc_id, checksum256 random_value) {
    if (dapp != get_self()) return;              // an answer for another contract
    rolls_table rolls(get_self(), get_self().value);
    auto it = rolls.find(assoc_id);
    if (it == rolls.end() || it->result != 0) return;   // unknown or already answered
    auto bytes = random_value.extract_as_byte_array();
    uint64_t r;
    std::memcpy(&r, bytes.data(), sizeof(r));
    rolls.modify(it, same_payer, [&](auto& row) { row.result = r % 6 + 1; });
  }
};
```

The handler needs no `require_auth`: it runs only as a notification of `orng.wax`'s own action `randnotify`, which nobody but the service can send. It returns quietly for an answer meant for another contract, for an unknown roll and for one that already has a result, instead of failing. Its `modify` does not make the row bigger, so the player, who paid for the row, is not charged again; in a notification only `get_self()` can pay for more RAM. The handler is not an action, so the ABI has `roll` only.

## Older contracts

Before the notification, the service called an action of the contract itself: `receiverand(assoc_id, random_value)`, checked with `require_auth("orng.wax"_n)`. It still does so only for the contracts it recorded before December 2025 (its table `legacycb`). A contract deployed now is not called that way: a `receiverand` action alone never receives an answer, and its rolls stay at 0. Use the notification above.

## How to do it here

1. Build and deploy the contract to a WAX Testnet account.
2. Add `eosio.code` to the account's `active` (Account page > **Keys and permissions**).
3. Run `roll` on the Contract page. The row appears with `result` = 0.
4. Read the table `rolls` again later: `result` is set when the service has answered. On mainnet that takes a few seconds; on WAX Testnet the service did not answer requests when this page was written (none since 2026-10-21). **Transaction history** of the contract account then shows `orng.wax` `randnotify`. See [Transaction history](doc:transaction-history).
5. A request that still waits is a row of the service's table: open `orng.wax` on the Contract page, table `reqs`, scope `orng.wax`. Look for your contract in `dapp` and your row id in `assoc_id`; `rnd` stays all zeros until the answer. See [Read tables](doc:read-tables).

## What is needed

- `eosio.code` on the contract account's `active`.
- Calls the service accepts. Each contract has a small rate of free calls an hour (the service's table `adaptcfg`; 10 an hour without a stake at the time of writing). For more, send WAX to `orng.wax` with the memo `stake-<contract>` (it can be unstaked again) or `deposit-<contract>` (each call beyond the free rate is paid from it; the fee is in the table `config.a`). Your contract's state is its row in the table `acctstate`. The figures are the service's and can change.
- The service's terms on the network you use. Read WAX's current developer documentation for the random number service before you rely on it on mainnet, and test on WAX Testnet first.

> Note: Never use `current_time_point()`, `tapos_block_prefix()`, the transaction id or a hash of them as the random number itself. Here the transaction id only makes the signing value unique; the random value comes from the service.

> Note: A `check` that fails in the handler does not undo the request. The answer is not written, and the service keeps the value in its table `undelivered1` with the error text. Keep the handler free of checks that can fail; return instead.

> Note: Until the answer arrives, the game is open. Do not let the player cancel and get his stake back in that time, or he cancels whenever he dislikes the odds.

See also [Time](doc:contract-time) and [Tables, scopes and payers](doc:contract-tables).
