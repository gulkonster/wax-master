# Random numbers (ORNG)

A contract cannot make a random number by itself. Everything it can read in an action is known to the sender, or to a block producer, before the transaction runs: the block time, the TAPOS fields, the transaction id, table contents, the hash of any of them. A player can try transactions until one of them wins, or let his own contract refuse the transaction when the result is bad, so he only ever pays for wins.

WAX runs a random number service for contracts, the WAX RNG oracle, on the account `orng.wax`. Your contract asks for a number; the service answers in a **later transaction** by calling your contract's action `receiverand` with a 256-bit random value. The result is not known when the request is sent, and the request cannot be undone when the result is bad.

## The protocol

| Step | Who | Action |
|---|---|---|
| 1 | Your contract, inline | `orng.wax::requestrand(assoc_id, signing_value, caller)` signed by `yourcontract@active` |
| 2 | The service | Produces the value off the chain and proves it on the chain |
| 3 | `orng.wax`, inline | `yourcontract::receiverand(assoc_id, random_value)` |

- `assoc_id` (`uint64_t`): your own number to match the answer with the request, for example the row id of the game.
- `signing_value` (`uint64_t`): a value never used before; the service refuses a repeated one. Derive it from the transaction id and your row id, as below.
- `caller` (`name`): your contract account, which receives `receiverand`.
- `random_value` (`checksum256`): 32 random bytes.

Because step 1 is an inline action, the contract account needs `eosio.code` on `active`; see [Inline actions](doc:contract-inline-actions).

## Example

A complete dice contract: `roll` stores a row and asks for a number; `receiverand` writes the result 1 to 6.

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

  [[eosio::action]]
  void receiverand(uint64_t assoc_id, checksum256 random_value) {
    require_auth("orng.wax"_n);   // only the service may answer
    rolls_table rolls(get_self(), get_self().value);
    auto it = rolls.require_find(assoc_id, "no roll with this id");
    auto bytes = random_value.extract_as_byte_array();
    uint64_t r;
    std::memcpy(&r, bytes.data(), sizeof(r));
    rolls.modify(it, same_payer, [&](auto& row) { row.result = r % 6 + 1; });
  }
};
```

`receiverand` runs in a transaction signed by the service, not by the player. Its `modify` does not make the row bigger, so the player, who paid for the row, is not charged again. A handler that needs more RAM must pay with `get_self()`.

## How to do it here

1. Build and deploy the contract to a WAX Testnet account.
2. Add `eosio.code` to the account's `active` (Account page > **Keys and permissions**).
3. Run `roll` on the Contract page. The row appears with `result` = 0.
4. Read the table `rolls` again a few seconds later: `result` is set. **Transaction history** of the contract account shows the `receiverand` call. See [Transaction history](doc:transaction-history).

## What is needed

- `eosio.code` on the contract account's `active`.
- The service's terms on the network you use. Read WAX's current developer documentation for the random number service before you rely on it on mainnet, and test on WAX Testnet first.

> Note: Never use `current_time_point()`, `tapos_block_prefix()`, the transaction id or a hash of them as the random number itself. Here the transaction id only makes the signing value unique; the random value comes from the service.

> Note: Until `receiverand` arrives, the game is open. Do not let the player cancel and get his stake back in that time, or he cancels whenever he dislikes the odds.

See also [Time](doc:contract-time) and [Tables, scopes and payers](doc:contract-tables).
