#include <%CONTRACT%.hpp>

void %CLASS%::addtoken(name token_contract, symbol sym) {
  require_auth(get_self());
  check(sym.is_valid(), "invalid symbol");
  check(is_account(token_contract), "the token contract account does not exist");
  // Read the token's own stat table: the token must exist there, with exactly
  // this precision. A typing mistake here would refuse every real payment.
  token::stats stats(token_contract, sym.code().raw());
  const auto& st = stats.get(sym.code().raw(), "this contract has no token with this symbol");
  check(st.supply.symbol == sym, "the token has another precision on its contract");

  tokens_table tokens(get_self(), get_self().value);
  check(tokens.find(sym.code().raw()) == tokens.end(), "this symbol code is already on the list");
  tokens.emplace(get_self(), [&](auto& row) {
    row.token_contract = token_contract;
    row.sym = sym;
  });
}

void %CLASS%::deltoken(symbol_code code) {
  require_auth(get_self());
  tokens_table tokens(get_self(), get_self().value);
  tokens.erase(tokens.get(code.raw(), "this symbol code is not on the list"));
}

void %CLASS%::on_transfer(name from, name to, asset quantity, std::string memo) {
  // Skip the contract's own outgoing transfers, and notifications another
  // account passed on with require_recipient (`to` is not this contract).
  if (from == get_self() || to != get_self()) return;
  // Tokens the system pays to this account (a RAM sale, an unstake refund)
  // are not payments.
  if (from.prefix() == "eosio"_n) return;

  // get_first_receiver() is the contract whose transfer action is running:
  // the contract that issued the token. The symbol in the data is only what
  // that contract wrote, so the pair is compared with the list, precision
  // included. A WAX of any contract but eosio.token stops here.
  tokens_table tokens(get_self(), get_self().value);
  auto t = tokens.find(quantity.symbol.code().raw());
  check(t != tokens.end() &&
          extended_symbol(t->sym, t->token_contract) == extended_symbol(quantity.symbol, get_first_receiver()),
        "this token is not accepted here");
  // The token contract checks these too; the balances here do not rely on it.
  check(quantity.is_valid(), "invalid quantity");
  check(quantity.amount > 0, "the quantity must be positive");

  balances_table balances(get_self(), from.value);
  auto it = balances.find(quantity.symbol.code().raw());
  if (it == balances.end()) {
    // In a notification only the contract itself can pay for a new row.
    balances.emplace(get_self(), [&](auto& row) {
      row.token_contract = t->token_contract;
      row.balance = quantity;
    });
  } else {
    // The list now names another contract for this code: keep tokens apart.
    check(it->token_contract == t->token_contract, "withdraw the old balance of this symbol first");
    balances.modify(it, same_payer, [&](auto& row) { row.balance += quantity; });
  }
}

void %CLASS%::withdraw(name owner, asset quantity) {
  require_auth(owner);
  check(quantity.is_valid(), "invalid quantity");
  check(quantity.amount > 0, "the quantity must be positive");
  balances_table balances(get_self(), owner.value);
  const auto& row = balances.get(quantity.symbol.code().raw(), "no balance of this token");
  check(quantity.symbol == row.balance.symbol, "the precision differs from the balance");
  check(quantity <= row.balance, "the quantity is more than the balance");

  // The token contract comes from the row, written from the list when the
  // tokens arrived; never from the caller, who could name his own contract.
  const name token_contract = row.token_contract;
  if (quantity == row.balance) {
    balances.erase(row); // nothing left: the row and its RAM go back
  } else {
    balances.modify(row, same_payer, [&](auto& r) { r.balance -= quantity; });
  }
  // The contract signs with its own active permission: eosio.code.
  action(permission_level{get_self(), "active"_n}, token_contract, "transfer"_n,
         std::make_tuple(get_self(), owner, quantity, std::string("withdraw")))
    .send();
}
