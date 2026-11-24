#pragma once

#include <eosio/eosio.hpp>

using namespace eosio;

class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  [[eosio::action]]
  void doit(name user);
};
