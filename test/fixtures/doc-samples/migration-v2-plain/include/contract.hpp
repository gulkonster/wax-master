#pragma once

#include <eosio/eosio.hpp>

using namespace eosio;

// Version 2, the wrong way: a plain field added at the end of a table that
// already has rows. Rows written by version 1 have 12 bytes; this struct reads
// 16. Reading such a row fails, in the contract and in the node's table API.
class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  struct [[eosio::table]] player {
    name     user;
    uint32_t score;
    uint32_t level;   // added in version 2 as a plain field: old rows lack these 4 bytes
    uint64_t primary_key() const { return user.value; }
  };
  typedef multi_index<"players"_n, player> players_table;

  [[eosio::action]]
  void add(name user, uint32_t score);

  [[eosio::action]]
  void setscore(name user, uint32_t score);

  [[eosio::action]]
  void setlevel(name user, uint32_t level);

  [[eosio::action]]
  void show(name user);
};
