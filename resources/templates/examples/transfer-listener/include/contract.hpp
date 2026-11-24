#pragma once

#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>

using namespace eosio;

// A deposit box: WAX sent to this account is recorded per sender, and
// withdraw sends it back. An example to learn from, not audited.
class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  // Runs when eosio.token notifies this account of a transfer. A transfer of
  // any other token contract, even one with the symbol WAX, never reaches it.
  [[eosio::on_notify("eosio.token::transfer")]]
  void on_transfer(name from, name to, asset quantity, std::string memo);

  // Sends quantity of the owner's deposit back to the owner (an inline
  // eosio.token::transfer, so the account needs eosio.code on active).
  [[eosio::action]]
  void withdraw(name owner, asset quantity);

  // One row per account that has a deposit.
  struct [[eosio::table]] deposit {
    name  owner;
    asset balance;
    uint64_t primary_key() const { return owner.value; }
  };
  typedef multi_index<"deposits"_n, deposit> deposits_table;

  using withdraw_action = action_wrapper<"withdraw"_n, &%CLASS%::withdraw>;
};
