# Time

A contract gets the time from the block its transaction is in: `current_time_point()` from `<eosio/system.hpp>`. A WAX block is produced every half second, and every action in a block sees the same time. It is not the clock of the user's computer, and it does not move while an action runs.

## The types

| Type | Size | Use |
|---|---|---|
| `time_point` | 8 bytes, microseconds | `current_time_point()`; durations in microseconds |
| `time_point_sec` | 4 bytes, seconds | Times stored in tables; shown in the ABI as `2026-11-24T10:00:00` |
| `block_timestamp` | 4 bytes, half seconds | `current_block_time()` |
| `microseconds` | 8 bytes | Durations: `eosio::seconds(60)`, `eosio::minutes(5)`, `eosio::hours(1)`, `eosio::days(3)` |

`current_time_point().sec_since_epoch()` gives the seconds since 1970-01-01 UTC as a number.

## Nothing runs by itself

The chain never calls a contract at a time. A contract only runs when somebody sends an action. Store the time something becomes due, and check it when the next action comes in: "claim after 24 hours", "unstake after 3 days". A service or the user sends that action. Deferred transactions are deprecated on Antelope chains such as WAX and are not a timer.

## Example

A complete contract: a lock that can be finished only after its time is up.

```cpp
#include <eosio/eosio.hpp>
#include <eosio/system.hpp>
using namespace eosio;

class [[eosio::contract("timelock")]] timelock : public contract {
public:
  using contract::contract;

  struct [[eosio::table]] lock {
    name           owner;
    time_point_sec unlock_at;
    uint64_t primary_key() const { return owner.value; }
  };
  typedef multi_index<"locks"_n, lock> locks_table;

  [[eosio::action]]
  void start(name owner, uint32_t duration_sec) {
    require_auth(owner);
    check(duration_sec >= 60 && duration_sec <= 30 * 24 * 3600, "the duration must be between 1 minute and 30 days");
    locks_table locks(get_self(), get_self().value);
    check(locks.find(owner.value) == locks.end(), "this account already has a lock");
    locks.emplace(owner, [&](auto& row) {
      row.owner = owner;
      row.unlock_at = time_point_sec(current_time_point() + eosio::seconds(duration_sec));
    });
  }

  [[eosio::action]]
  void finish(name owner) {
    require_auth(owner);
    locks_table locks(get_self(), get_self().value);
    auto it = locks.require_find(owner.value, "this account has no lock");
    time_point_sec now = time_point_sec(current_time_point());
    check(now >= it->unlock_at, "locked until " + it->unlock_at.to_string() + " UTC");
    locks.erase(it);
  }
};
```

## How to do it here

1. Build and deploy the contract.
2. Run `start` with `duration_sec` = `60` on the Contract page.
3. Read the table `locks`: `unlock_at` shows the time in UTC. See [Read tables](doc:read-tables).
4. Run `finish` at once: the result shows `locked until ...`. Run it again after a minute: the row is gone.

## What is needed

- Nothing more than a deployed contract. All times are UTC.

> Note: The block time is known in advance to anyone who sends a transaction. It is good for deadlines measured in seconds and more. Never use it as a random number; see [Random numbers](doc:contract-random).

See also [Tables, scopes and payers](doc:contract-tables).
