#pragma once

#include <eosio/eosio.hpp>
#include <string>

using namespace eosio;

class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  [[eosio::action]]
  void hi(name user);
};
