# Who pays: RAM and CPU for your users

Every row your contract stores costs RAM, and every transaction costs CPU and NET. Someone has to hold them. Decide this before you write the first `emplace`, because a game with many players can use up the RAM of its own contract account, and a player with a fresh account may hold almost no resources at all.

## RAM: who is billed for a row

| Where the row is written | Who can pay | What it means |
|---|---|---|
| An action the user signed (`require_auth(user)`) | The user, or the contract | The user's own RAM is used; his signature on the action is the permission. |
| A notification handler (`on_notify`) | Only the contract (`get_self()`) | The user signed a transfer, not your action. A row paid by him is refused with `unprivileged contract cannot increase RAM usage of another account within a notify context`. |
| An action nobody signed | Only the contract | Any other payer is refused with `unprivileged contract cannot increase RAM usage of another account that has not authorized the action`. |

The consequences:

- **A row the contract pays has to be limited.** If anyone can make the contract pay for a row, anyone can use up the contract's RAM. Put a count limit on such rows, ask for a payment that covers the row, and let the user erase the row later. Rows with a payer who signed the action need no such limit: the user's RAM is the limit.
- **A row the user pays is returned to him when it is erased.** `erase` gives the RAM back to the account that paid it. A row the contract paid returns the RAM to the contract.
- **A user's RAM can be too small.** The player's account may hold very little RAM. Accounts made by a wallet service can start with a small amount. Check the account (`ram_quota` and `ram_usage` of `get_account`, shown on the Account page) instead of assuming. When an action is refused with `account ... has insufficient ram`, that account needs more RAM; see [RAM](doc:resources-ram).
- **Say what a step costs.** A page of your game that asks the user to sign `join` should tell him that it stores a row for him and what happens to it when he leaves.
- **Free the rows you do not need.** Erase finished games, used coupons and old requests. Each row is about 112 bytes plus its data; see [Tables, scopes and payers](doc:contract-tables).

## CPU and NET: who is billed for a transaction

A transaction uses CPU and NET from the account that pays for it. After the protocol feature `ONLY_BILL_FIRST_AUTHORIZER` is active, that is **one account: the first authorizer**, the account of the first authorization the transaction declares. The other signers are not billed. The feature is among the activated protocol features of WAX Testnet and of WAX Mainnet (read on 2026-11-25 with `get_activated_protocol_features` on the public endpoints).

The contract does not choose who pays: it never sees this. The one who **builds the transaction** decides, by the order of the authorizations. So the choices are:

| Way | How | Notes |
|---|---|---|
| The player pays | His own stake, or a PowerUp for him | The simplest. A player with no CPU cannot play. See [CPU and NET](doc:resources-cpu-net) and [PowerUp](doc:powerup). |
| You rent CPU for the player | A PowerUp with the player as receiver and your account as payer | The fee is spent and the CPU lasts one day. See [PowerUp](doc:powerup). |
| You sign first | The game's server builds the transaction with an account of yours as the first authorizer (for example a no-op action of that account), signs it with that account's key, and sends it to the player to sign | Often called a cosigner or free transactions. The key is on your server and must be guarded; limit what it will sign, or anyone can use up your CPU. The contract is not involved. |

## Example

A complete contract that shows both payers. `join` is signed by the player and uses the player's RAM. Sending 1 WAX with the memo `join` makes the contract pay for the row, until a limit is reached.

```cpp
#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>
#include <eosio/system.hpp>
using namespace eosio;

class [[eosio::contract("seats")]] seats : public contract {
public:
  using contract::contract;

  // The contract pays at most this many rows. The limit protects the RAM of the contract account.
  static constexpr uint32_t MAX_SPONSORED = 100;

  struct [[eosio::table]] seat_row {
    name         owner;
    bool         sponsored;   // true: the contract pays this row
    time_point_sec since;
    uint64_t primary_key() const { return owner.value; }
  };
  typedef multi_index<"seats"_n, seat_row> seats_table;

  // One row that counts the rows the contract pays. The id is always 0.
  struct [[eosio::table]] count_row {
    uint64_t id;
    uint32_t sponsored;
    uint64_t primary_key() const { return id; }
  };
  typedef multi_index<"counts"_n, count_row> counts_table;

  // The player signs, so the player may pay the RAM of his row.
  [[eosio::action]]
  void join(name player) {
    require_auth(player);
    seats_table seats(get_self(), get_self().value);
    check(seats.find(player.value) == seats.end(), "this account has a seat already");
    seats.emplace(player, [&](auto& row) {   // the player's own RAM
      row.owner = player;
      row.sponsored = false;
      row.since = current_time_point();
    });
  }

  // The sender of a transfer did not sign this action, so only the contract can pay here.
  [[eosio::on_notify("eosio.token::transfer")]]
  void on_transfer(name from, name to, asset quantity, std::string memo) {
    if (from == get_self() || to != get_self()) return;
    if (memo != "join") return;   // other transfers are simply kept
    check(quantity == asset(100000000, symbol("WAX", 8)), "send exactly 1.00000000 WAX to take a sponsored seat");

    seats_table seats(get_self(), get_self().value);
    check(seats.find(from.value) == seats.end(), "this account has a seat already");

    counts_table counts(get_self(), get_self().value);
    auto c = counts.find(0);
    if (c == counts.end()) {
      counts.emplace(get_self(), [&](auto& row) { row.id = 0; row.sponsored = 0; });
      c = counts.find(0);
    }
    check(c->sponsored < MAX_SPONSORED, "no sponsored seats left, run join yourself");
    counts.modify(c, same_payer, [&](auto& row) { row.sponsored++; });

    seats.emplace(get_self(), [&](auto& row) {   // only the contract may pay in a notification
      row.owner = from;
      row.sponsored = true;
      row.since = current_time_point();
    });
  }

  // Erasing gives the RAM back to whoever paid: the player, or the contract for a sponsored seat.
  [[eosio::action]]
  void leave(name player) {
    require_auth(player);
    seats_table seats(get_self(), get_self().value);
    auto it = seats.require_find(player.value, "this account has no seat");
    if (it->sponsored) {
      counts_table counts(get_self(), get_self().value);
      auto c = counts.require_find(0, "no count row");
      counts.modify(c, same_payer, [&](auto& row) { row.sponsored--; });
    }
    seats.erase(it);
  }
};
```

## How to do it here

1. Build and deploy to a testnet account. Switch on **eosio.code** for it only if you add inline actions; this sample sends none.
2. Run `join` on the Contract page with `player` = a second account and Authorization = that account. In the inspector the RAM change shows on the player's account. See [Simulate and the transaction inspector](doc:simulate-inspector).
3. From a third account send exactly `1.00000000 WAX` to the contract with the memo `join` (the Account page, or the `transfer` action of `eosio.token`; see [Transfers and memos](doc:transfers)). The RAM change shows on the contract account, and the row has `sponsored` = 1.
4. Run `join` for the third account too: it is refused with `this account has a seat already`.
5. Run `leave` for each: the RAM goes back to the one who paid. Read the tables `seats` and `counts` as in [Read tables](doc:read-tables).

## What is needed

- RAM on the contract account for sponsored rows: the limit times the row size.
- For CPU: the stake or PowerUp of whoever is the first authorizer of each transaction.

> Note: Whether a given wallet or cosigner service accepts a transaction with a different first authorizer is up to that service. This page does not describe one.

See also [Notifications (on_notify)](doc:contract-notifications), [Before mainnet: a checklist](doc:contract-checklist) and [RAM](doc:resources-ram).
