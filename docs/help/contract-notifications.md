# Notifications (on_notify)

When a contract calls `require_recipient(account)`, a copy of the action goes to that account: a **notification**. If the account has a contract with a handler for that action, the handler runs in the same transaction. `eosio.token` notifies both the sender and the receiver of every `transfer`. This is how a contract learns that it received tokens: a transfer listener.

## The handler

```cpp
// Part of a contract class: the handler of eosio.token's transfer.
[[eosio::on_notify("eosio.token::transfer")]]
void on_transfer(name from, name to, asset quantity, std::string memo) {
  if (from == get_self() || to != get_self()) return;
}
```

- The text is `"contract::action"`. The handler runs only when `eosio.token` itself sent the `transfer`. A fake token contract that also calls its action `transfer` and also uses the symbol `WAX` does not reach this handler.
- `"*::transfer"` accepts any contract. Then check `get_first_receiver()` yourself, or anyone can credit himself with a worthless token of the same symbol; see [Accepting tokens safely](doc:contract-accept-tokens).
- The parameters are those of the notified action, in the same order and types.
- The handler is not an action: it is not in the ABI and nobody can call it directly.
- The contract is notified of its own outgoing transfers too: return early when `from` is the contract.
- Return early when `to` is not the contract. Any account that receives WAX can pass the notification on with `require_recipient`; the token contract is still `eosio.token`, but `to` is that account. A handler that does not check `to` credits deposits that were never paid to it.
- A `check` that fails in the handler refuses the whole transfer, so the tokens never move. Use it to refuse wrong tokens or a bad memo.
- In a handler the RAM payer can only be the contract itself (`get_self()`); another payer is refused with `unprivileged contract cannot increase RAM usage of another account within a notify context`.

## Example

A complete deposit box: it credits incoming WAX to the sender and pays it back with `withdraw`.

```cpp
#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>
using namespace eosio;

class [[eosio::contract("depositbox")]] depositbox : public contract {
public:
  using contract::contract;

  struct [[eosio::table]] deposit {
    name  owner;
    asset balance;
    uint64_t primary_key() const { return owner.value; }
  };
  typedef multi_index<"deposits"_n, deposit> deposits_table;

  [[eosio::on_notify("eosio.token::transfer")]]
  void on_transfer(name from, name to, asset quantity, std::string memo) {
    if (from == get_self() || to != get_self()) return;
    check(quantity.symbol == symbol("WAX", 8), "only WAX is accepted");
    check(quantity.amount > 0, "the quantity must be positive");

    deposits_table deposits(get_self(), get_self().value);
    auto it = deposits.find(from.value);
    if (it == deposits.end()) {
      deposits.emplace(get_self(), [&](auto& row) {   // only the contract can pay here
        row.owner = from;
        row.balance = quantity;
      });
    } else {
      deposits.modify(it, same_payer, [&](auto& row) { row.balance += quantity; });
    }
  }

  [[eosio::action]]
  void withdraw(name owner, asset quantity) {
    require_auth(owner);
    deposits_table deposits(get_self(), get_self().value);
    auto& row = deposits.get(owner.value, "no deposit for this account");
    check(quantity.symbol == row.balance.symbol, "wrong symbol");
    check(quantity.amount > 0 && quantity <= row.balance, "invalid quantity");

    if (quantity == row.balance) {
      deposits.erase(row);
    } else {
      deposits.modify(row, same_payer, [&](auto& r) { r.balance -= quantity; });
    }
    action(permission_level{get_self(), "active"_n}, "eosio.token"_n, "transfer"_n,
      std::make_tuple(get_self(), owner, quantity, std::string("withdraw"))).send();
  }
};
```

`withdraw` sends an inline transfer, so the contract account needs `eosio.code` on `active`; see [Inline actions](doc:contract-inline-actions).

## How to do it here

1. Build and deploy the contract, for example to `mydeposit111`.
2. Add `mydeposit111@eosio.code` to its `active` (Account page > **Keys and permissions**).
3. From another account send `1.00000000 WAX` to `mydeposit111` (Account page > **Transfer**, or `eosio.token::transfer` on the Contract page). See [Transfers and memos](doc:transfers).
4. Open in inspector: the trace shows `transfer` on `eosio.token`, then the notification of the sender and the notification of `mydeposit111`, where the handler ran.
5. Read the table `deposits` of `mydeposit111`, scope = `mydeposit111`: the sender's row shows `1.00000000 WAX`. See [Read tables](doc:read-tables).
6. Run `withdraw` signed by the sender: the WAX comes back and the row is erased.

## What is needed

- A contract account with RAM for the rows the contract pays.
- For payouts: `eosio.code` on the contract's `active`.

> Note: Your own actions can notify too: `require_recipient(user)` lets another contract react to your action. The receiver cannot stop your action except by failing the whole transaction.

See also [Tables, scopes and payers](doc:contract-tables) and [The token contract](doc:token-contract).
