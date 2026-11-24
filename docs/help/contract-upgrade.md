# Upgrading a contract and its tables

Deploying new code to an account that already has a contract replaces the code and the ABI at once. The tables stay: every row keeps the bytes it was written with. The new code reads those bytes with its own structs. A change that the old rows do not fit breaks the contract for them, and the chain does not warn you.

## What is safe and what is not

| Change | Safe? | Notes |
|---|---|---|
| New action, new table | Yes | |
| Changed body of an action | Yes | Old rows are read as before |
| New field at the **end** of a row, as `binary_extension<T>` | Yes | Old rows read it as empty |
| New field at the end, plain type | No | Old rows lack the bytes; reading them fails |
| Field removed, reordered or of another type | No | Old rows are read wrong or not at all |
| Field renamed, same type and place | Bytes safe | The ABI and every reader of the JSON see the new name |
| Primary key or secondary index changed | No | Existing rows keep their old keys |
| Parameters of an existing action changed | No for callers | Wallets, scripts and other contracts send the old form; add a new action instead |
| Table removed from the code | Rows stay | They keep their RAM, and only code that knows the table can erase them; erase them before you remove the table |

## Two ways forward

- **Add at the end with `binary_extension`.** The field is wrapped: `has_value()`, `value()`, `emplace(...)`. Only the last fields of a row can be extensions, and every field after one must be an extension too. The ABI shows the type with a `$`, for example `string$`.
- **Migrate to a new table.** Keep the old struct and table, add the new one under a new name (`profiles2`), and an action that moves a limited number of rows per call, so one transaction does not run out of CPU. Remove the old table from the code only when it is empty.

## Example

A complete contract after an upgrade: version 1 had `user` and `nickname`; version 2 adds `avatar` at the end.

```cpp
#include <eosio/eosio.hpp>
#include <eosio/binary_extension.hpp>
using namespace eosio;

class [[eosio::contract("profiles")]] profiles : public contract {
public:
  using contract::contract;

  struct [[eosio::table]] profile {
    name        user;
    std::string nickname;
    binary_extension<std::string> avatar;   // added in version 2; empty in older rows
    uint64_t primary_key() const { return user.value; }
  };
  typedef multi_index<"profiles"_n, profile> profiles_table;

  [[eosio::action]]
  void setnick(name user, std::string nickname) {
    require_auth(user);
    check(nickname.size() <= 32, "the nickname is longer than 32 bytes");
    profiles_table profiles(get_self(), get_self().value);
    auto it = profiles.find(user.value);
    if (it == profiles.end()) {
      profiles.emplace(user, [&](auto& row) {
        row.user = user;
        row.nickname = nickname;
      });
    } else {
      profiles.modify(it, user, [&](auto& row) { row.nickname = nickname; });
    }
  }

  [[eosio::action]]
  void setavatar(name user, std::string url) {
    require_auth(user);
    check(url.size() <= 128, "the address is longer than 128 bytes");
    profiles_table profiles(get_self(), get_self().value);
    auto it = profiles.require_find(user.value, "set a nickname first");
    profiles.modify(it, user, [&](auto& row) { row.avatar.emplace(url); });   // the row grows; the user pays
  }

  [[eosio::action]]
  void show(name user) {
    profiles_table profiles(get_self(), get_self().value);
    auto& row = profiles.get(user.value, "no profile for this account");
    print(row.nickname, ": ", row.avatar.has_value() ? row.avatar.value() : std::string("no avatar"));
  }
};
```

## How to do it here

1. Before an upgrade, keep the current build: commit the project or copy its folder.
2. Build. Compare the new ABI with the deployed one: open the contract on the Contract page and look at the tables and their types.
3. Deploy to a **testnet** copy of the contract first, with rows written by the old version, and read them with the new one (Contract page > tables, and an action such as `show`).
4. **Simulate Deploy** on the real account shows the RAM the new code needs. Deploy sends only what changed. See [Deploy](doc:deploy).

## What is needed

- The contract account's key for the permission that deploys, and RAM for the bigger code.

> Note: A deployment cannot be taken back, but the old build can be deployed again. Rows written by the new code in the meantime stay in the new layout.

See also [Tables, scopes and payers](doc:contract-tables) and [The Contract section](doc:contract-section).
