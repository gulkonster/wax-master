#pragma once

#include <eosio/eosio.hpp>

using namespace eosio;

// (a) another contract's table, read only
namespace othercontract {
  struct config_row {
    uint64_t id;
    uint64_t primary_key() const { return id; }
  };
  typedef eosio::multi_index<"config"_n, config_row> config_table;
}

class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  [[eosio::action]]
  void showcfg(name other);
};
