# Accepting tokens safely

A contract learns that it was paid from the token contract's notification: every `transfer` notifies the sender and the receiver, and a handler with `[[eosio::on_notify]]` runs in the same transaction (see [Notifications (on_notify)](doc:contract-notifications)). The handler decides what the payment is worth, and a handler that believes everything the notification says can be made to credit tokens that are worth nothing, or that were never paid.

## What a token is

A token is two things together: the contract that issues it and its symbol with the precision. The real WAX is `8,WAX` of `eosio.token`. Anyone can deploy the Token template, create a token called `WAX` with 8 decimals, and send it to your contract: the transfer looks the same, only the contract differs. In code the pair is an `extended_symbol`:

| In the code | Meaning |
|---|---|
| `get_first_receiver()` | In a handler: the contract whose action is running, for a `transfer` the contract that issued the token |
| `extended_symbol(quantity.symbol, get_first_receiver())` | The token that arrived: symbol, precision and contract |
| `extended_symbol(symbol("WAX", 8), "eosio.token"_n)` | The real WAX. `==` compares the code, the precision and the contract. |

## Two ways to listen

- **One fixed contract**: `[[eosio::on_notify("eosio.token::transfer")]]`. The handler runs only when `eosio.token` itself sent the notification, so a fake `WAX` never reaches it. Use it when you accept tokens of one contract.
- **Every contract**: `[[eosio::on_notify("*::transfer")]]`. The handler runs for the `transfer` of any contract that names your account, a fake one included, so it must compare `get_first_receiver()` and the symbol with the tokens it accepts. Use it when you accept tokens of more than one contract. It also runs for `transfer` actions that are not token transfers, for example `atomicassets::transfer` of NFTs, whose data does not read as a token transfer: such a transfer to your contract fails.

## The ways to be cheated

| The mistake | What the attacker does | The check |
|---|---|---|
| Only the symbol is compared | Creates his own `WAX` and sends it; the handler credits it as real WAX, and he withdraws real WAX | Compare the `extended_symbol`: contract and symbol with precision |
| `*::transfer` without the contract check | Writes a contract whose `transfer` only calls `require_recipient(your_contract)` with any data, even a negative or huge `quantity`; nothing is paid at all | `get_first_receiver()` must be an accepted contract, checked before anything else |
| `to` is not checked | Receives real WAX on his own contract and passes the notification on with `require_recipient`; the token contract is still `eosio.token`, but `to` is his account | `if (to != get_self()) return;` |
| `from` is not checked | Nothing: but your contract is notified of its own outgoing transfers, and a handler that counts them pays twice | `if (from == get_self()) return;` |
| The memo is trusted | Sends 1 token with the memo of an order that costs 100, or with the name of another account to credit | Check the memo against your own table: the order exists, the amount is its price, it is not paid yet; a name in the memo must pass `is_account` |
| The amount is not checked | A standard token contract refuses a zero or negative amount, but the handler then depends on another contract's code for its own records | `quantity.is_valid()` and `quantity.amount > 0`; see [Checking input](doc:contract-validate-input) |

Refuse what you do not accept with `check`: the whole transfer fails and the tokens stay with the sender. A handler that only returns keeps tokens that nothing records. Payments from system accounts (`eosio.*`, for example the WAX of a RAM sale) are usually skipped with a `return`, so they do not fail.

## Example: one fixed contract

A complete contract that adds up the WAX each account paid. Only `eosio.token` reaches its handler.

```cpp
#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>
using namespace eosio;

class [[eosio::contract("waxonly")]] waxonly : public contract {
public:
  using contract::contract;

  struct [[eosio::table]] payment {
    name  payer;
    asset total;
    uint64_t primary_key() const { return payer.value; }
  };
  typedef multi_index<"payments"_n, payment> payments_table;

  [[eosio::on_notify("eosio.token::transfer")]]
  void on_transfer(name from, name to, asset quantity, std::string memo) {
    if (from == get_self() || to != get_self()) return;   // outgoing, or passed on
    if (from.prefix() == "eosio"_n) return;                // RAM sale, refunds
    // eosio.token has more than one token; the precision is part of the symbol.
    check(quantity.symbol == symbol("WAX", 8), "only WAX is accepted");
    check(quantity.amount > 0, "the quantity must be positive");

    payments_table payments(get_self(), get_self().value);
    auto it = payments.find(from.value);
    if (it == payments.end()) {
      payments.emplace(get_self(), [&](auto& r) { r.payer = from; r.total = quantity; });
    } else {
      payments.modify(it, same_payer, [&](auto& r) { r.total += quantity; });
    }
  }
};
```

## Example: tokens of more than one contract

A complete contract that accepts WAX and one more token, `4,WMT` of the account `mytokenacct1` (put your own token account and symbol there). The token is checked first, then the amount; credits are kept per payer and token.

```cpp
#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>
using namespace eosio;

class [[eosio::contract("paybox")]] paybox : public contract {
public:
  using contract::contract;

  // Scope: the payer. One row per token.
  struct [[eosio::table]] credit {
    extended_asset funds;
    uint64_t primary_key() const { return funds.quantity.symbol.code().raw(); }
  };
  typedef multi_index<"credits"_n, credit> credits_table;

  static bool accepted(const extended_symbol& token) {
    return token == extended_symbol(symbol("WAX", 8), "eosio.token"_n) ||
           token == extended_symbol(symbol("WMT", 4), "mytokenacct1"_n);
  }

  [[eosio::on_notify("*::transfer")]]
  void on_transfer(name from, name to, asset quantity, std::string memo) {
    if (from == get_self() || to != get_self()) return;   // outgoing, or passed on
    if (from.prefix() == "eosio"_n) return;                // RAM sale, refunds
    // Any contract can reach this handler. The one running is the issuer:
    // the symbol in the data proves nothing by itself.
    extended_symbol token(quantity.symbol, get_first_receiver());
    check(accepted(token), "this token is not accepted here");
    check(quantity.is_valid() && quantity.amount > 0, "the quantity must be positive");

    credits_table credits(get_self(), from.value);
    auto it = credits.find(quantity.symbol.code().raw());
    if (it == credits.end()) {
      credits.emplace(get_self(), [&](auto& r) { r.funds = extended_asset(quantity, token.get_contract()); });
    } else {
      credits.modify(it, same_payer, [&](auto& r) { r.funds.quantity += quantity; });
    }
  }
};
```

To pay tokens back, take the token contract from your own row or list, never from the caller: a caller who may name the contract names one of his own. The [Token payments example](doc:example-payments) shows it with `withdraw`, and keeps the accepted tokens in a table that the contract account changes with an action instead of in the code.

## How to do it here

1. Make a project with the second example, replace `mytokenacct1` and `WMT` by a token you made with the Token template (see [The token contract](doc:token-contract)), build and deploy it.
2. The contract pays the rows, so its account needs some free RAM (about 250 bytes for each new payer).
3. From another account send `1.00000000 WAX` to the contract (Account page > **Transfer**), then run the table query: `credits`, **Scope** = the sender. The row shows `funds` with `1.00000000 WAX` and `eosio.token`.
4. Make a token called `WAX` with 8 decimals on a third account with the Token template and send it to the contract with that account's `transfer` action on the Contract page. It is refused with "this token is not accepted here", and nothing changes.

The [Token payments example](doc:example-payments) walks the same test step by step, with a second real token and withdrawals.

## What is needed

- The contract account and symbol with precision of every token you accept, read from the token contract's `stat` table (scope = the symbol code); see [Read tables](doc:read-tables).
- RAM on the contract account for the rows it pays in the handler.

> Note: The token list of the Account page marks a token with the network's symbol from another contract. Your contract has no such help: it sees only what the notification says.

See also [Assets and symbols](doc:contract-assets) and [Example: Transfer listener](doc:example-transfer-listener).
