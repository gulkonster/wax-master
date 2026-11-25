#pragma once

#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <eosio/system.hpp>

using namespace eosio;

// Staking in a contract: WAX sent with the memo "stake" is staked, unstake
// starts a waiting time, claim pays out after it. An example to learn from,
// not audited.
class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  // The waiting time between unstake and claim: 5 minutes.
  static constexpr uint32_t UNSTAKE_SECONDS = 5 * 60;

  // Runs when eosio.token notifies this account of a transfer.
  [[eosio::on_notify("eosio.token::transfer")]]
  void on_transfer(name from, name to, asset quantity, std::string memo);

  // Moves quantity from staked to unstaking and starts the waiting time again.
  [[eosio::action]]
  void unstake(name owner, asset quantity);

  // Pays out everything unstaking once the waiting time is over (an inline
  // eosio.token::transfer, so the account needs eosio.code on active).
  [[eosio::action]]
  void claim(name owner);

  // One row per staker.
  struct [[eosio::table]] stake_row {
    name owner;
    asset staked;
    asset unstaking;
    time_point_sec claim_after; // when the unstaking amount can be claimed
    uint64_t primary_key() const { return owner.value; }
  };
  typedef multi_index<"stakes"_n, stake_row> stakes_table;
};
