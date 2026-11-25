#pragma once

#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>
#include <eosio/system.hpp>

using namespace eosio;

// The assets table of atomicassets, described here to read it: the fields of
// its ABI, in the same order and with the same types. Outside the contract
// class, so it is not part of this contract's ABI. Scope = the owner.
namespace atomic {
struct asset_row {
  uint64_t asset_id;
  name collection_name;
  name schema_name;
  int32_t template_id;
  name ram_payer;
  std::vector<asset> backed_tokens;
  std::vector<uint8_t> immutable_serialized_data;
  std::vector<uint8_t> mutable_serialized_data;
  uint64_t primary_key() const { return asset_id; }
};
typedef multi_index<"assets"_n, asset_row> assets_table;
} // namespace atomic

// NFT staking: AtomicAssets assets sent with the memo "stake" are recorded in
// the table stakes, one row per asset with its owner; unstake sends them back.
// An example to learn from, not audited.
class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  // At most this many assets in one transfer or one unstake. It keeps the
  // work of one action small and bounded.
  static constexpr uint32_t MAX_ASSETS = 10;

  // Stores the collection whose assets can be staked. Signed by the contract
  // account.
  [[eosio::action]]
  void setconfig(name collection);

  // Runs when atomicassets notifies this account of a transfer (it notifies
  // from and to). A failed check here refuses the whole transfer, so an asset
  // that is not accepted stays with its sender.
  [[eosio::on_notify("atomicassets::transfer")]]
  void on_transfer(name from, name to, std::vector<uint64_t> asset_ids, std::string memo);

  // Sends staked assets back to owner with one inline atomicassets::transfer
  // (so the account needs eosio.code on active). Signed by owner; every
  // asset must be his.
  [[eosio::action]]
  void unstake(name owner, std::vector<uint64_t> asset_ids);

  // One row: the collection whose assets can be staked.
  struct [[eosio::table]] config {
    name collection;
  };
  typedef singleton<"config"_n, config> config_table;

  // One row per staked asset. After the transfer atomicassets only knows
  // that the contract owns the asset: this row is the only record of whose
  // it is.
  struct [[eosio::table]] stake_row {
    uint64_t asset_id;
    name owner;
    time_point_sec staked_at; // UTC; what a reward would be counted from
    uint64_t primary_key() const { return asset_id; }
    uint64_t by_owner() const { return owner.value; }
  };
  typedef multi_index<"stakes"_n, stake_row, indexed_by<"byowner"_n, const_mem_fun<stake_row, uint64_t, &stake_row::by_owner>>>
      stakes_table;
};
