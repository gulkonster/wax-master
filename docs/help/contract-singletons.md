# Singletons

A singleton is a table that holds at most one row per scope: the place for a contract's settings, a counter or a global state. It is `eosio::singleton` from `<eosio/singleton.hpp>`, built on `multi_index`, so the same scope and RAM payer rules apply (see [Tables, scopes and payers](doc:contract-tables)). The row struct needs no primary key.

## The calls

| Call | What it does |
|---|---|
| `config_table config(get_self(), get_self().value);` | Opens the singleton: owner contract and scope, as for `multi_index`. |
| `config.exists()` | True when the row is there. |
| `config.get()` | The row; stops the action with `singleton does not exist` when there is none. |
| `config.get_or_default(value)` | The row, or `value` (by default a struct with its default values) without storing anything. |
| `config.get_or_create(payer, value)` | The row; when there is none, stores `value` paid by `payer` and returns it. |
| `config.set(value, payer)` | Stores the row, new or changed. |
| `config.remove()` | Erases the row; the RAM goes back to the payer. |

## Example

A complete contract with a settings row that only the contract account may change.

```cpp
#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>
using namespace eosio;

class [[eosio::contract("settings")]] settings : public contract {
public:
  using contract::contract;

  struct [[eosio::table("config")]] config_row {
    bool     paused = false;
    uint32_t max_per_user = 10;
    name     admin;
  };
  typedef singleton<"config"_n, config_row> config_table;

  [[eosio::action]]
  void setconfig(bool paused, uint32_t max_per_user, name admin) {
    require_auth(get_self());
    check(is_account(admin), "the admin account does not exist");
    config_table config(get_self(), get_self().value);
    config.set(config_row{paused, max_per_user, admin}, get_self());
  }

  [[eosio::action]]
  void dowork(name user) {
    require_auth(user);
    config_table config(get_self(), get_self().value);
    config_row c = config.get_or_default();
    check(!c.paused, "the contract is paused");
    print(user, " may do ", c.max_per_user, " things");
  }

  [[eosio::action]]
  void clearconfig() {
    require_auth(get_self());
    config_table config(get_self(), get_self().value);
    check(config.exists(), "there is no config to clear");
    config.remove();
  }
};
```

The table name is given twice: in `[[eosio::table("config")]]`, so the struct is in the ABI under that table, and in `singleton<"config"_n, ...>`. Keep them the same.

## How to do it here

1. Build and deploy the contract.
2. On the Contract page run `setconfig` with Authorization = the contract account.
3. Read the row: pick the table `config`, scope = the contract account, **Run query**. A singleton shows one row. See [Read tables](doc:read-tables).
4. Run `dowork`: Open in inspector shows the console line with the value from the row.

## What is needed

- RAM on the payer's account for the row; here the contract account pays.

> Note: Read a singleton once per action and keep the value in a variable. Each `get` reads the chain's database again and costs CPU.

See also [Upgrading a contract and its tables](doc:contract-upgrade): changing the struct of a stored singleton follows the same rules as any table.
