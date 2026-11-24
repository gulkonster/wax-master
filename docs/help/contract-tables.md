# Tables, scopes and payers

A contract stores its data in tables, with `eosio::multi_index`. A table holds rows of one struct. Each row has a unique 64-bit **primary key**; up to 16 **secondary indexes** let you look rows up by other fields. Every table is split into **scopes**: the same table name holds separate groups of rows, one per scope value. Every row is paid for by one account, its **RAM payer**.

## The parts

| Part | In the code | Notes |
|---|---|---|
| Row struct | `struct [[eosio::table]] note { ... };` | Needs `uint64_t primary_key() const`. |
| Table | `typedef multi_index<"notes"_n, note> notes_table;` | The table name follows the account name rules: up to 12 characters, a-z, 1-5 and dots. |
| Open | `notes_table notes(get_self(), scope);` | The first argument is the contract that owns the table; the second the scope, a `uint64_t`, usually an account name's `.value`. |
| Add | `notes.emplace(payer, [&](auto& row) { ... });` | The payer pays the row's RAM. |
| Change | `notes.modify(it, payer, [&](auto& row) { ... });` | `same_payer` keeps the payer. The primary key must not change. |
| Remove | `notes.erase(it);` | The RAM goes back to the payer. |
| Find | `find(key)`, `require_find(key, "message")`, `get(key, "message")` | `find` returns `end()` when there is no row; the other two stop the action with the message. |

## Who can be the RAM payer

- The contract account itself, `get_self()`, always.
- An account that **authorized this action**, for example the `user` of a `require_auth(user)`. Any other account is refused with `unprivileged contract cannot increase RAM usage of another account that has not authorized the action`.
- In a notification handler (`on_notify`) only `get_self()`. Another payer is refused with `unprivileged contract cannot increase RAM usage of another account within a notify context`.
- `modify` with a new payer moves the whole row to that payer; the same rules apply to the new payer. With `same_payer`, a row that grows is billed to its current payer, who then must have authorized the action as well.

A row costs its data plus about 112 bytes; the first row of a table in a scope costs about 112 bytes more, and each secondary index adds to every row. When users pay for their own rows, the contract cannot run out of RAM because of them, and a user gets his RAM back when the row is erased. See [RAM](doc:resources-ram).

## Scopes

Rows of different scopes never mix: `find`, `begin()` and `end()` see one scope only. Common choices:

- `get_self().value`: one group for the whole contract (a global list).
- `user.value`: one group per account, like the `accounts` table of a token, read with scope = the holder.
- A symbol code (`symbol.code().raw()`), like the token's `stat` table.

## Example

A complete contract: notes with a secondary index by author, the author pays for his notes.

```cpp
#include <eosio/eosio.hpp>
using namespace eosio;

class [[eosio::contract("notebook")]] notebook : public contract {
public:
  using contract::contract;

  struct [[eosio::table]] note {
    uint64_t    id;
    name        author;
    std::string text;

    uint64_t primary_key() const { return id; }
    uint64_t by_author() const { return author.value; }
  };
  typedef multi_index<"notes"_n, note,
    indexed_by<"byauthor"_n, const_mem_fun<note, uint64_t, &note::by_author>>
  > notes_table;

  [[eosio::action]]
  void add(name author, std::string text) {
    require_auth(author);
    check(text.size() <= 256, "the text is longer than 256 bytes");
    notes_table notes(get_self(), get_self().value);
    notes.emplace(author, [&](auto& row) {   // the author pays the RAM
      row.id = notes.available_primary_key();
      row.author = author;
      row.text = text;
    });
  }

  [[eosio::action]]
  void edit(uint64_t id, std::string text) {
    notes_table notes(get_self(), get_self().value);
    auto it = notes.require_find(id, "no note with this id");
    require_auth(it->author);
    check(text.size() <= 256, "the text is longer than 256 bytes");
    notes.modify(it, same_payer, [&](auto& row) { row.text = text; });
  }

  [[eosio::action]]
  void remove(uint64_t id) {
    notes_table notes(get_self(), get_self().value);
    auto it = notes.require_find(id, "no note with this id");
    require_auth(it->author);
    notes.erase(it);   // the author gets the RAM back
  }

  [[eosio::action]]
  void count(name author) {
    notes_table notes(get_self(), get_self().value);
    auto by_author = notes.get_index<"byauthor"_n>();
    uint32_t n = 0;
    for (auto it = by_author.lower_bound(author.value); it != by_author.end() && it->author == author; ++it) n++;
    print(author, " has ", n, " notes");
  }
};
```

## How to do it here

1. Write the table and build (Ctrl+B). The ABI check makes sure the table's struct is in the ABI; see [ABI check messages](doc:abi-check).
2. Deploy, then run `add` on the Contract page with Authorization = the author.
3. On the right half of the Contract page pick the table `notes`, scope = the contract account, and press **Run query**. To use the secondary index set **Index** to 2 and **Key type** to `name`. See [Read tables](doc:read-tables).
4. Open the transaction in the inspector to see the RAM change of the author. See [Simulate and the transaction inspector](doc:simulate-inspector).

## What is needed

- RAM on the payer's account for each row; the contract account's RAM for rows it pays itself.

> Note: The struct of a table that already has rows cannot be changed freely: old rows are stored in the old layout. See [Upgrading a contract and its tables](doc:contract-upgrade).

See also [Who pays: RAM and CPU for your users](doc:contract-who-pays), [Singletons](doc:contract-singletons) and [Reading another contract's table](doc:contract-read-other-table).
