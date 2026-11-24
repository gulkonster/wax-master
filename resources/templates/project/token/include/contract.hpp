#pragma once

#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>

#include <string>
#include <vector>

using namespace eosio;

/**
 * A standard token contract: create a token with a maximum supply, issue it,
 * transfer it between accounts, retire it, and open or close balance rows.
 *
 * Balance rows are removed at zero. Rules that follow from it:
 * 1. A missing row means a zero balance. get_balance returns zero in the
 *    token's precision for a holder without a row and fails only for an
 *    unknown token.
 * 2. When an outgoing transfer or retire takes a balance to zero, the row is
 *    erased in sub_balance. That needs nobody's signature and gives the RAM
 *    back at once to the row's payer: the holder if he ever sent a part of
 *    his balance, otherwise whoever paid when the row was created.
 * 3. The next transfer to that account creates the row again by the usual
 *    rule (the receiver pays if he signed, otherwise the sender), exactly like
 *    a first receipt. Nothing is lost; RAM only moves.
 * 4. open and close keep their standard signatures, because wallets and
 *    exchanges call them. A row opened at zero stays until it has held tokens
 *    and is emptied; it is then erased like any other. A contract that relied
 *    on a pre-opened row to avoid paying RAM must expect to pay it, or the
 *    holder calls open again. close on a row that is already gone fails with
 *    the standard message.
 * 5. The table layout is the standard one (accounts: balance only), so
 *    explorers and wallets read it unchanged.
 * 6. retire of the issuer's whole balance erases the issuer's row; issue
 *    creates it again, paid by the issuer. A transfer to self is refused, so a
 *    row is never erased and created in one action.
 */
class [[eosio::contract("%CONTRACT%")]] %CLASS% : public contract {
public:
  using contract::contract;

  /** Creates a token with the given issuer and maximum supply. */
  [[eosio::action]]
  void create(const name& issuer, const asset& maximum_supply);

  /** Issues new tokens to the issuer. */
  [[eosio::action]]
  void issue(const name& to, const asset& quantity, const std::string& memo);

  /** Removes tokens of the issuer from circulation. */
  [[eosio::action]]
  void retire(const asset& quantity, const std::string& memo);

  /** Moves tokens from one account to another. */
  [[eosio::action]]
  void transfer(const name& from, const name& to, const asset& quantity, const std::string& memo);

  // transfers: several tokens of this contract from one account to one account
  // in one action. It is off by default: contracts that credit deposits listen
  // for the transfer notification; a transfers notification is a different
  // action and they will not credit it. Use it only between accounts, or with
  // contracts written to handle it. To enable it, remove the /* and */ lines
  // around this block and around transfers in src/%CONTRACT%.cpp, and the
  // comment lines around the text of its section and the note below it in
  // resource/%CONTRACT%.contracts.md.
  /*
  [[eosio::action]]
  void transfers(const name& from, const name& to, const std::vector<asset>& quantities, const std::string& memo);

  using transfers_action = action_wrapper<"transfers"_n, &%CLASS%::transfers>;
  */

  /** Creates a zero balance row for an account, paid by ram_payer. */
  [[eosio::action]]
  void open(const name& owner, const symbol& symbol, const name& ram_payer);

  /** Removes a zero balance row. */
  [[eosio::action]]
  void close(const name& owner, const symbol& symbol);

  static asset get_supply(const name& token_contract_account, const symbol_code& sym_code) {
    stats statstable(token_contract_account, sym_code.raw());
    const auto& st = statstable.get(sym_code.raw(), "unknown token");
    return st.supply;
  }

  /** The balance of owner; zero in the token's precision when owner has no row. */
  static asset get_balance(const name& token_contract_account, const name& owner, const symbol_code& sym_code) {
    accounts accountstable(token_contract_account, owner.value);
    auto ac = accountstable.find(sym_code.raw());
    if (ac != accountstable.end()) return ac->balance;
    stats statstable(token_contract_account, sym_code.raw());
    const auto& st = statstable.get(sym_code.raw(), "unknown token");
    return asset{0, st.supply.symbol};
  }

  using create_action = action_wrapper<"create"_n, &%CLASS%::create>;
  using issue_action = action_wrapper<"issue"_n, &%CLASS%::issue>;
  using retire_action = action_wrapper<"retire"_n, &%CLASS%::retire>;
  using transfer_action = action_wrapper<"transfer"_n, &%CLASS%::transfer>;
  using open_action = action_wrapper<"open"_n, &%CLASS%::open>;
  using close_action = action_wrapper<"close"_n, &%CLASS%::close>;

private:
  struct [[eosio::table]] account {
    asset balance;
    uint64_t primary_key() const { return balance.symbol.code().raw(); }
  };

  struct [[eosio::table]] currency_stats {
    asset supply;
    asset max_supply;
    name issuer;
    uint64_t primary_key() const { return supply.symbol.code().raw(); }
  };

  typedef eosio::multi_index<"accounts"_n, account> accounts;
  typedef eosio::multi_index<"stat"_n, currency_stats> stats;

  void sub_balance(const name& owner, const asset& value);
  void add_balance(const name& owner, const asset& value, const name& ram_payer);
};
