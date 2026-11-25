#pragma once

#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>
using namespace eosio;

// Gives players reward points and announces each reward with its own log action, logreward.
// The same code on a second account listens to it. An example to learn from, not audited.
class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  // Game role: adds points to a player, then announces it with logreward. Signed by the contract.
  [[eosio::action]]
  void reward(name player, uint64_t points, std::string memo);
  // The log action, sent only by this contract, inline from reward. It carries what only the
  // contract knows (the reward id, the new total) and notifies the player and the listeners.
  [[eosio::action]]
  void logreward(uint64_t reward_id, name player, uint64_t points, uint64_t total_points, std::string memo);

  // Game role: adds an account that logreward notifies (at most 5).
  [[eosio::action]]
  void addlistener(name account);
  // Game role: removes an account from the listeners.
  [[eosio::action]]
  void rmlistener(name account);

  // Listener role: whose logreward this account counts.
  [[eosio::action]]
  void setsource(name source);
  // Listener role: runs for the logreward of every contract ("*") that names this account.
  [[eosio::on_notify("*::logreward")]]
  void onlogreward(uint64_t reward_id, name player, uint64_t points, uint64_t total_points, std::string memo);

  // Game role: the points of each player.
  struct [[eosio::table]] player_info {
    name player;
    uint64_t points = 0;
    uint32_t reward_count = 0;
    uint64_t primary_key() const { return player.value; }
  };
  typedef multi_index<"players"_n, player_info> players_table;
  // Game role: the accounts logreward notifies.
  struct [[eosio::table]] listener_info {
    name account;
    uint64_t primary_key() const { return account.value; }
  };
  typedef multi_index<"listeners"_n, listener_info> listeners_table;
  // Listener role: what this account heard, per player.
  struct [[eosio::table]] heard_info {
    name player;
    uint64_t points = 0;
    uint32_t reward_count = 0;
    uint64_t last_reward_id = 0;
    uint64_t primary_key() const { return player.value; }
  };
  typedef multi_index<"heard"_n, heard_info> heard_table;
  // One row: the next reward id (game role) and the source (listener role).
  struct [[eosio::table]] settings_info {
    uint64_t next_reward_id = 1;
    name source;
  };
  typedef singleton<"settings"_n, settings_info> settings_table;
};
