#pragma once

#include <eosio/eosio.hpp>
#include <eosio/binary_extension.hpp>

using namespace eosio;

// Version 3: the rows move to a new table. The old struct and table stay
// exactly as version 2 wrote them, so old rows can still be read. The new
// table has its own name and its own struct, laid out freely.
class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
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

  [[eosio::action]]
  void move(uint32_t max_rows);

  [[eosio::action]]
  void add(name user, uint32_t score);

  [[eosio::action]]
  void setscore(name user, uint32_t score);

  [[eosio::action]]
  void show(name user);
};
