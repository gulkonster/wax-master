# Assets and symbols

An amount of a token is an `asset` (from `<eosio/asset.hpp>`): a whole number `amount` and a `symbol`. The symbol is a code of 1 to 7 capital letters and a precision, the number of decimals. WAX has precision 8, so `1.00000000 WAX` is the asset with `amount` = 100000000 and `symbol` = `8,WAX`. There are no fractions inside: all arithmetic is on whole units.

## The parts

| In the code | Meaning |
|---|---|
| `symbol("WAX", 8)` | The WAX symbol. `symbol("WAX", 4)` is a different symbol. |
| `symbol_code("WAX")` | The code alone, without precision. Tables of token contracts are often keyed by `code().raw()`. |
| `asset(150000000, symbol("WAX", 8))` | `1.50000000 WAX` |
| `q.amount`, `q.symbol` | The whole units and the symbol |
| `q.is_valid()` | The amount is within the limits and the symbol is well formed |
| `q.to_string()` | `"1.50000000 WAX"` |
| `extended_asset` | An asset with the contract that issued it, for example `{"quantity":"1.0000 TLM","contract":"alien.worlds"}` |

## Rules that catch everyone

- **The precision is part of the symbol.** `1.0000 WAX` is not WAX: `eosio.token` refuses it, and a comparison or sum with `1.00000000 WAX` stops the action. Always check `quantity.symbol` against the full symbol, not only the code.
- **The symbol alone is not the token.** Any account can create a token called `WAX`. What makes it real WAX is the contract `eosio.token`. Check the contract in a transfer listener; see [Notifications](doc:contract-notifications).
- **Arithmetic checks itself.** Adding, subtracting or comparing assets with different symbols stops the action (`attempt to add asset with different symbol`), and so does an overflow (`addition overflow`, `multiplication overflow`).
- **Division rounds down.** For a share, multiply first, in 128 bits, then divide, as in the example. Do not use `float` or `double` for amounts.
- **Check the sign.** A negative amount is a valid asset. Check `amount > 0` on every amount a user sends you.

## Example

A complete contract that checks a price, multiplies it and takes a fee of 2.5%.

```cpp
#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>
using namespace eosio;

class [[eosio::contract("pricing")]] pricing : public contract {
public:
  using contract::contract;

  static constexpr symbol WAX_SYMBOL = symbol(symbol_code("WAX"), 8);

  [[eosio::action]]
  void quote(asset price, uint32_t count) {
    check(price.is_valid(), "invalid price");
    check(price.symbol == WAX_SYMBOL, "the price must be in WAX with 8 decimals, for example 1.00000000 WAX");
    check(price.amount > 0, "the price must be positive");
    check(count > 0 && count <= 1000, "count must be 1 to 1000");

    asset total = price * count;   // stops on overflow
    // 2.5% fee, multiplied in 128 bits first, rounded down.
    int64_t fee_amount = static_cast<int64_t>(static_cast<int128_t>(total.amount) * 25 / 1000);
    asset fee(fee_amount, WAX_SYMBOL);
    print("total ", total, ", fee ", fee, ", to the seller ", total - fee);
  }

  [[eosio::action]]
  void tokenof(extended_asset payment) {
    check(payment.contract == "eosio.token"_n && payment.quantity.symbol == WAX_SYMBOL, "only WAX from eosio.token");
    print("received ", payment.quantity, " issued by ", payment.contract);
  }
};
```

## How to do it here

1. Build and deploy the contract.
2. On the Contract page choose `quote`. The `asset` field shows the format: enter `1.25000000 WAX` and `count` = `3`. **Simulate**: the console shows `total 3.75000000 WAX, fee 0.09375000 WAX, to the seller 3.65625000 WAX`.
3. Enter `1.25 WAX` instead: the result shows the refusal with the precision message. See [Run actions](doc:run-actions).

## What is needed

- The exact symbol of every token you accept, with its precision and its contract. Read it from the token contract's `stat` table, scope = the symbol code; see [The token contract](doc:token-contract).

See also [Transfers and memos](doc:transfers) and [Error messages](doc:contract-errors).
