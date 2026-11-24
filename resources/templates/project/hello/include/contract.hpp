#pragma once

#include <eosio/eosio.hpp>

using namespace eosio;

class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  [[eosio::action]]
  void hi(name user);

  using hi_action = action_wrapper<"hi"_n, &%CLASS%::hi>;
};
