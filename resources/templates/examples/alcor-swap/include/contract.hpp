#pragma once

#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <eosio/system.hpp>

using namespace eosio;

// Swaps the contract account's own tokens on Alcor's swap contract: a
// transfer to swap.alcor with the swap memo. An example to learn from, not
// audited.
class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  // Sends token_in (token contract and quantity) from the contract account to
  // swap.alcor and asks pool pool_id for at least min_out (token contract and
  // quantity) in return. The other token arrives at the contract account.
  // Signed by the contract account; the inline transfer needs eosio.code.
  [[eosio::action]]
  void swap(uint64_t pool_id, extended_asset token_in, extended_asset min_out);
};
