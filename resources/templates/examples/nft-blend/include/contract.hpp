#pragma once

#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>

using namespace eosio;

// Rows of atomicassets, only read here: fields as in its ABI, in its order.
// Outside the contract class, so they are not part of this contract's ABI.
namespace atomicassets {
struct asset_row { // table assets, scope = the owner
  uint64_t asset_id;
  name collection_name, schema_name;
  int32_t template_id;
  name ram_payer;
  std::vector<asset> backed_tokens;
  std::vector<uint8_t> immutable_serialized_data, mutable_serialized_data;
  uint64_t primary_key() const { return asset_id; }
};
typedef multi_index<"assets"_n, asset_row> assets_table;

struct template_row { // table templates, scope = the collection
  int32_t template_id;
  name schema_name;
  bool transferable, burnable;
  uint32_t max_supply, issued_supply;
  std::vector<uint8_t> immutable_serialized_data;
  uint64_t primary_key() const { return uint64_t(template_id); }
};
typedef multi_index<"templates"_n, template_row> templates_table;
} // namespace atomicassets

// Blends AtomicAssets NFTs: a user sends a recipe's assets with the memo "blend:<recipe id>";
// the contract burns them and mints the result to him. An example to learn from, not audited.
class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  // A blend burns one asset per ingredient: the limit keeps every loop short.
  static constexpr size_t MAX_INGREDIENTS = 10;

  // Adds recipe `id` (1 or more): 1 to 10 ingredient template ids (a template may repeat)
  // and the result template. Signed by the contract account, which pays for the row.
  [[eosio::action]]
  void setrecipe(uint64_t id, name collection, std::vector<int32_t> ingredients, name result_schema, int32_t result_template);

  // Removes recipe `id`. Signed by the contract account.
  [[eosio::action]]
  void delrecipe(uint64_t id);

  // atomicassets notifies `from` and `to` of every transfer. A failed check here refuses
  // the whole transfer, so a wrong blend leaves the assets with their sender.
  [[eosio::on_notify("atomicassets::transfer")]]
  void on_transfer(name from, name to, std::vector<uint64_t> asset_ids, std::string memo);

  struct [[eosio::table]] recipe { // one row per recipe, scope = the contract account
    uint64_t id;
    name collection;
    std::vector<int32_t> ingredients; // sorted
    name result_schema;
    int32_t result_template = 0;
    uint64_t primary_key() const { return id; }
  };
  typedef multi_index<"recipes"_n, recipe> recipes_table;
};
