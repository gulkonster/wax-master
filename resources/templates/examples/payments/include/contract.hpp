#pragma once

#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>

using namespace eosio;

// The stat table of a standard token contract (eosio.token, the Token
// template), described here only to read it. Outside the contract class, so it
// is not part of this contract's ABI.
namespace token {
struct currency_stats {
  asset supply;
  asset max_supply;
  name issuer;
  uint64_t primary_key() const { return supply.symbol.code().raw(); }
};
typedef multi_index<"stat"_n, currency_stats> stats;
} // namespace token

// Accepts payments in the tokens on its list and keeps a balance per account
// and token; withdraw pays it back. A token is its contract plus its symbol:
// anyone can create a token called WAX on his own contract.
// An example to learn from, not audited.
class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  // Puts a token on the list: the contract that issues it and its symbol with
  // the precision, for example eosio.token and 8,WAX. Signed by this account.
  [[eosio::action]]
  void addtoken(name token_contract, symbol sym);

  // Takes a symbol code off the list. Balances already credited stay and can
  // still be withdrawn.
  [[eosio::action]]
  void deltoken(symbol_code code);

  // Runs for the transfer action of EVERY contract that notifies this account
  // ("*"), so the handler itself must check which contract sent it.
  [[eosio::on_notify("*::transfer")]]
  void on_transfer(name from, name to, asset quantity, std::string memo);

  // Sends quantity of the owner's balance back to the owner with an inline
  // transfer of the token's contract (needs eosio.code on active).
  [[eosio::action]]
  void withdraw(name owner, asset quantity);

  // The accepted tokens: one contract per symbol code. Scope: this account.
  struct [[eosio::table]] accepted {
    name token_contract;
    symbol sym;
    uint64_t primary_key() const { return sym.code().raw(); }
  };
  typedef multi_index<"tokens"_n, accepted> tokens_table;

  // One row per token an account holds here. Scope: the owner's account.
  struct [[eosio::table]] holding {
    name token_contract;
    asset balance;
    uint64_t primary_key() const { return balance.symbol.code().raw(); }
  };
  typedef multi_index<"balances"_n, holding> balances_table;
};
