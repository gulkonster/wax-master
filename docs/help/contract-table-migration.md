# Changing a table: what breaks and how to migrate

A table row is stored as the bytes of its struct: the fields one after another, without their names and without a mark where one field ends. The code that reads a row takes as many bytes as its struct says, in the order the struct says. Deploying new code changes the struct, but not the bytes of the rows already stored. This page shows, with one small contract in three versions, what happens when the struct changes and how to change it safely.

## The contract before the change

Version 1 keeps one row per player. A row is 12 bytes: 8 for `user`, 4 for `score`.

```cpp
struct [[eosio::table]] player {
  name     user;
  uint32_t score;
  uint64_t primary_key() const { return user.value; }
};
typedef multi_index<"players"_n, player> players_table;
```

Its actions `add`, `setscore` and `show` write, change and print a row. Three rows are written with this version.

## A plain field added at the end: the old rows break

Version 2 adds `level` as an ordinary field:

```cpp
struct [[eosio::table]] player {
  name     user;
  uint32_t score;
  uint32_t level;   // added in version 2 as a plain field: old rows lack these 4 bytes
  uint64_t primary_key() const { return user.value; }
};
```

The compiler and Deploy accept it; nothing on the chain compares the new struct with the stored rows. The three old rows still have 12 bytes, and this struct reads 16.

- **Reading the table.** The node turns rows into JSON with the contract's ABI, which now lists `level`. For an old row it runs out of bytes. On the Contract page, **Run query** on `players` answers: <<NODE-WORDS: the error shown by Run query on players after version 2 (plain) is deployed>>
- **An action that reads an old row.** `find`, `require_find` and `get` unpack the whole row. `setscore` on an old player is refused with `assertion failure with message: datastream attempted to read past the end`. The same happens to `modify` and `erase`, because both need the row found first: an old row can no longer be changed or removed by this code.
- **New rows work.** `add` of a new player writes all 16 bytes, and this version reads that row. This is why the fault is easy to miss in a test with fresh rows only.

```cpp
void setscore(name user, uint32_t score) {
  require_auth(get_self());
  players_table players(get_self(), get_self().value);
  auto it = players.require_find(user.value, "no such player");   // reads the whole row
  players.modify(it, same_payer, [&](auto& row) { row.score = score; });
}
```

The words of the refusal depend on the type of the field that ran out: a number field gives `datastream attempted to read past the end`, a `std::string` or a list gives `get`. The node's words for the table query name the field and the struct.

**The way back:** deploy version 1 again. The old rows are read as before. A row that version 2 wrote keeps its 4 extra bytes; version 1 reads the first 12 and ignores the rest, and the next `modify` by version 1 writes it back without `level`.

## The same field as `binary_extension`

```cpp
#include <eosio/binary_extension.hpp>
```

```cpp
struct [[eosio::table]] player {
  name     user;
  uint32_t score;
  binary_extension<uint32_t> level;   // added in version 2; empty in rows of version 1
  uint64_t primary_key() const { return user.value; }
};
```

`binary_extension<T>` reads its value only when the row has bytes left; otherwise it stays empty and nothing fails. In the ABI the field's type gets a `$`: `uint32$`, and the node leaves such a field out of the JSON of a row that ends before it.

| Call | What it does |
|---|---|
| `has_value()` | `true` when the row had the field |
| `value()` | The value; refused with `cannot get value of empty binary_extension` when there is none |
| `value_or()` | The value, or `T()` (0, an empty string) when there is none |
| `emplace(x)` | Sets the value |

```cpp
void show(name user) {
  players_table players(get_self(), get_self().value);
  auto& row = players.get(user.value, "no such player");
  if (row.level.has_value()) {
    print(row.user, ": score ", row.score, ", level ", row.level.value());
  } else {
    print(row.user, ": score ", row.score, ", no level yet");
  }
}
```

What to know before you rely on it:

- **Writing a row always writes the field.** An empty extension is written as `T()`. After any `modify` of an old row, even one that changes only `score`, the row has `level` 0, `has_value()` is `true`, and the row is 4 bytes bigger, paid by the row's payer. So do not use "empty" to mean "never set": choose a value for "not set" (here 0) and treat both the same.
- **Only at the end.** Extensions must be the last fields of the struct: every field after an extension must be an extension too. To add another field later, add it after the first, also as an extension.
- **Never in the middle.** An extension placed before an existing field shifts every later field, as a reorder does.

## A new table and a move action

When the change is more than fields at the end (a field removed, reordered, of another type, a new primary key), keep the old struct and table exactly as they are and add a new table under a new name. A `move` action copies a limited number of rows per call into the new table and erases them from the old one; you run it until the old table is empty. Version 3 does this:

```cpp
#include <eosio/eosio.hpp>
#include <eosio/binary_extension.hpp>
using namespace eosio;

class [[eosio::contract("migrate")]] migrate : public contract {
public:
  using contract::contract;

  // The old table, unchanged. Remove it from the code only when it is empty.
  struct [[eosio::table]] player {
    name     user;
    uint32_t score;
    binary_extension<uint32_t> level;
    uint64_t primary_key() const { return user.value; }
  };
  typedef multi_index<"players"_n, player> players_table;

  // The new table: level is a plain field here, because every row of this
  // table is written by this version.
  struct [[eosio::table]] player2 {
    name     user;
    uint32_t score;
    uint32_t level;
    uint64_t primary_key() const { return user.value; }
  };
  typedef multi_index<"players2"_n, player2> players2_table;

  // Moves at most max_rows rows per call, so one transaction never runs out of
  // CPU however many rows there are. Run it again until it prints "left: none".
  [[eosio::action]]
  void move(uint32_t max_rows) {
    require_auth(get_self());
    check(max_rows >= 1 && max_rows <= 50, "max_rows must be 1 to 50");
    players_table  old_rows(get_self(), get_self().value);
    players2_table new_rows(get_self(), get_self().value);
    uint32_t moved = 0;
    for (auto it = old_rows.begin(); it != old_rows.end() && moved < max_rows; moved++) {
      new_rows.emplace(get_self(), [&](auto& row) {
        row.user  = it->user;
        row.score = it->score;
        row.level = it->level.value_or();   // 0 when the old row has no level
      });
      it = old_rows.erase(it);   // the old row's RAM goes back to its payer
    }
    print("moved ", moved, ", left: ", old_rows.begin() == old_rows.end() ? "none" : "some");
  }

  // A player still in the old table cannot be added again.
  [[eosio::action]]
  void add(name user, uint32_t score) {
    require_auth(get_self());
    players_table  old_rows(get_self(), get_self().value);
    players2_table new_rows(get_self(), get_self().value);
    check(old_rows.find(user.value) == old_rows.end(), "this player is not moved yet: run move first");
    check(new_rows.find(user.value) == new_rows.end(), "this player exists");
    new_rows.emplace(get_self(), [&](auto& row) {
      row.user = user;
      row.score = score;
      row.level = 1;
    });
  }

  [[eosio::action]]
  void setscore(name user, uint32_t score) {
    require_auth(get_self());
    players2_table new_rows(get_self(), get_self().value);
    auto it = new_rows.require_find(user.value, "no such player in players2 (run move first if it is in players)");
    new_rows.modify(it, same_payer, [&](auto& row) { row.score = score; });
  }

  [[eosio::action]]
  void show(name user) {
    players2_table new_rows(get_self(), get_self().value);
    auto& row = new_rows.get(user.value, "no such player in players2 (run move first if it is in players)");
    print(row.user, ": score ", row.score, ", level ", row.level);
  }
};
```

- The limit matters: a transaction has a CPU limit, and a loop over every row of a big table is refused as a whole, with nothing moved. Choose the number per call with **Simulate**, which shows the CPU time.
- Between the calls, a player is in one of the two tables. Every action must know that: here `add` refuses a player still in `players`, and the other actions say to run `move` first. A real contract can also move one player's row on its own the first time he acts.
- RAM: each moved row is erased from the old table in the same call, both paid by the contract here, so the contract's RAM use stays about the same; a row without `level` grows by 4 bytes, and the first row of the new table costs about 112 bytes more.
- When `players` is empty, a later version can remove the `player` struct and table from the code.

## Never reorder, remove or retype a field

A row has no field names, only bytes. If version 2 swapped `user` and `score`, or removed `score`, or made it a `uint64_t`, the old bytes would be read into the wrong fields. Often nothing fails: the action runs and the values are wrong, and a `modify` writes the wrong values back for good. A rename with the same type and place is safe for the bytes, but every reader of the JSON sees the new name.

## What the ABI shows

The ABI is how the node and the Contract page read the rows, so it changes with each version. The `player` struct's fields in the ABI:

| Version | Fields of `player` |
|---|---|
| 1 | `user` `name`, `score` `uint32` |
| 2, plain field | `user` `name`, `score` `uint32`, `level` `uint32` |
| 2, `binary_extension` | `user` `name`, `score` `uint32`, `level` `uint32$` |
| 3 | `player` as in 2 with `binary_extension`, and a second table `players2` of struct `player2`: `user` `name`, `score` `uint32`, `level` `uint32` |

## How to do it here

1. Before you change a table that has rows, write the change on a **testnet** copy of the contract: deploy the current version there, write a few rows with it, then deploy the new version and read those rows.
2. Read the old rows on the Contract page: pick the table and press **Run query**; see [Read tables](doc:read-tables). An error here, after a deploy, means the new ABI does not fit the stored rows.
3. Run an action that reads an old row, for example `show` or `setscore` with an old player, with **Simulate** first; see [Simulate and the transaction inspector](doc:simulate-inspector).
4. If the rows broke, deploy the previous build again: keep it (commit the project or copy its folder) before every upgrade. See [Deploy](doc:deploy).

## What is needed

- The contract account's key for the permission that deploys, and RAM for the code.
- For a move into a new table: a little more RAM on the payer of the rows, as described above.

> Note: The node does not check a new ABI against the stored rows. A broken table shows up only when a row is read.

See also [Upgrading a contract and its tables](doc:contract-upgrade) and [Tables, scopes and payers](doc:contract-tables).
