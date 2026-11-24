#pragma once

#include <eosio/eosio.hpp>

using namespace eosio;

// Version 1. A row is stored as its fields, one after another, without names:
// 8 bytes for user, 4 bytes for score. Code that reads a row takes as many
// bytes as its struct says, in the order the struct says.
class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  struct [[eosio::table]] player {
    name     user;
    uint32_t score;
    uint64_t primary_key() const { return user.value; }
  };
  typedef multi_index<"players"_n, player> players_table;

  [[eosio::action]]
  void add(name user, uint32_t score);

  [[eosio::action]]
  void setscore(name user, uint32_t score);

  [[eosio::action]]
  void show(name user);
};
