# Reading another contract's table

A contract can read the tables of any other contract on the same chain, in the same action, with no permission and no fee: a token balance, another contract's settings, an NFT's data. It can only read them; writing is refused with `cannot create objects in table of another contract` (or `modify`, `erase`). The rows are read as they are at that moment of the transaction.

## How it works

1. Find the table in the other contract's ABI: open the contract on the Contract page and pick the table on the right half. The ABI gives the table name, the row type and its fields. See [Read tables](doc:read-tables).
2. Write a struct with the same fields, in the same order, with the same types. The names of the fields do not matter; the order and types do.
3. Write the same `primary_key()` as the other contract (for the token's `accounts` table, the symbol code).
4. Open the table with the other contract as the first argument: `token::accounts acc("eosio.token"_n, user.value);`.
5. Put the struct and its typedef **outside** your contract class, for example in a namespace. Inside the class, the compiler would put the table into your ABI without its struct, and the ABI check stops Deploy; see [ABI check messages](doc:abi-check).

## Example

A complete contract that checks a WAX balance with `eosio.token`'s `accounts` table. The token stores one row per symbol, in the scope of the holder.

```cpp
#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>
using namespace eosio;

// eosio.token's balance table, described here to read it.
// Outside the contract class, so it is not part of this contract's ABI.
namespace token {
  struct account {
    asset balance;
    uint64_t primary_key() const { return balance.symbol.code().raw(); }
  };
  typedef multi_index<"accounts"_n, account> accounts;
}

class [[eosio::contract("balancecheck")]] balancecheck : public contract {
public:
  using contract::contract;

  [[eosio::action]]
  void needwax(name user, asset minimum) {
    check(minimum.symbol == symbol("WAX", 8), "the minimum must be in WAX, for example 1.00000000 WAX");
    token::accounts acc("eosio.token"_n, user.value);
    auto it = acc.find(minimum.symbol.code().raw());
    asset have = it == acc.end() ? asset(0, minimum.symbol) : it->balance;   // no row means zero
    check(have >= minimum, user.to_string() + " has only " + have.to_string());
    print(user, " has ", have);
  }
};
```

A singleton of another contract is read the same way: `singleton<"config"_n, other::config_row> cfg("othercontr11"_n, "othercontr11"_n.value);`, again with the struct outside your class.

## How to do it here

1. Build and deploy the contract.
2. On the Contract page run `needwax` with `user` = any account and `minimum` = `1.00000000 WAX`. Use **Simulate**: nothing is signed or sent, and the result shows the console line or the refusal. See [Simulate and the transaction inspector](doc:simulate-inspector).
3. Compare with the table itself: `eosio.token`, table `accounts`, scope = the user.

## What is needed

- The other contract's ABI, to copy the row layout.

> Note: The other contract can change its tables with an upgrade. If its layout changes, your struct reads wrong values or the read fails. Read only stable tables, such as those of `eosio.token` and the system contract.

See also [Tables, scopes and payers](doc:contract-tables) and [Assets and symbols](doc:contract-assets).
