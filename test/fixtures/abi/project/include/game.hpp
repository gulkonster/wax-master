#pragma once
#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>

using namespace eosio;

class [[eosio::contract("game")]] game : public contract {
  public:
    using contract::contract;

    static constexpr name LANDS_CONTRACT = "lands"_n;

    [[eosio::action]] void hi(name user);

    struct [[eosio::table("config")]] config {
      bool paused = false;
    };
    typedef eosio::singleton<"config"_n, config> config_t;

    struct land_coinconf_s {
      int32_t template_id = 0;
      std::string name;
      EOSLIB_SERIALIZE(land_coinconf_s, (template_id)(name))
    };
    typedef eosio::singleton<"coinconf"_n, land_coinconf_s> land_coinconf_t;
};
