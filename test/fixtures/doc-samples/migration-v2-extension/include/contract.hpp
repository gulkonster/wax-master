#pragma once

#include <eosio/eosio.hpp>
#include <eosio/binary_extension.hpp>

using namespace eosio;

// Version 2, the safe way: the new field is a binary_extension. When the row
// has no more bytes, the field is left empty instead of failing. The ABI shows
// its type as uint32$.
class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  struct [[eosio::table]] player {
    name     user;
    uint32_t score;
    binary_extension<uint32_t> level;   // added in version 2; empty in rows of version 1
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
