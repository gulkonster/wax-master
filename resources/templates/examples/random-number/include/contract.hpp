#pragma once

#include <eosio/crypto.hpp>
#include <eosio/eosio.hpp>

using namespace eosio;

// A dice roll with the WAX random number service (orng.wax): roll asks for a
// number, the answer arrives in a later transaction. An example to learn
// from, not audited.
class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  // Stores a pending roll for player and asks orng.wax for a random number
  // (an inline orng.wax::requestrand, so the account needs eosio.code on active).
  [[eosio::action]]
  void roll(name player);

  // Removes a roll that has its result, signed by its player: the RAM of the
  // row goes back to the player.
  [[eosio::action]]
  void remove(uint64_t id);

  // The answer: orng.wax runs its own action randnotify and notifies the
  // contract named in dapp. Only orng.wax can send that action. (Contracts
  // recorded by the service before December 2025 get the older call
  // receiverand instead; a contract deployed now never does.)
  [[eosio::on_notify("orng.wax::randnotify")]]
  void on_randnotify(uint64_t request_id, name dapp, uint64_t assoc_id, checksum256 rnd);

  // One row per roll; result is 0 until the answer arrives, then 1 to 6.
  struct [[eosio::table]] roll_row {
    uint64_t    id;
    name        player;
    uint8_t     result = 0;
    checksum256 random_value;
    uint64_t primary_key() const { return id; }
  };
  typedef multi_index<"rolls"_n, roll_row> rolls_table;
};
