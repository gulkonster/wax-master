#pragma once

#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>

using namespace eosio;

// Mints one AtomicAssets asset of a template to every account that asks, and
// counts the assets of its collection that arrive at the contract account.
// An example to learn from, not audited.
class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  // Stores the collection, schema and template to mint from. Every reader
  // creates his own collection, so these are not constants in the source.
  // Signed by the contract account.
  [[eosio::action]]
  void setconfig(name collection, name schema, int32_t template_id);

  // Mints one asset of the template to owner, once per account. The owner
  // pays the RAM of the row that records it; the contract account pays the
  // RAM of the asset (inline atomicassets::mintasset, so it needs eosio.code).
  [[eosio::action]]
  void mint(name owner);

  // atomicassets reports every movement of a collection's assets (also an
  // accepted offer) to the collection's notify accounts with logtransfer.
  // It never fails: a failing notify account stops every transfer of the
  // collection.
  [[eosio::on_notify("atomicassets::logtransfer")]]
  void on_logtransfer(name collection_name, name from, name to, std::vector<uint64_t> asset_ids, std::string memo);

  // One row: what to mint, and the assets of the collection received so far.
  struct [[eosio::table]] config {
    name collection;
    name schema;
    int32_t template_id = 0;
    uint64_t received = 0;
    name last_sender;
  };
  typedef singleton<"config"_n, config> config_table;

  // One row per account that has minted.
  struct [[eosio::table]] minted {
    name owner;
    uint64_t primary_key() const { return owner.value; }
  };
  typedef multi_index<"minted"_n, minted> minted_table;
};
