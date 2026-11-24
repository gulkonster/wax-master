#include <%CONTRACT%.hpp>

void %CLASS%::create(const name& issuer, const asset& maximum_supply) {
  require_auth(get_self());

  auto sym = maximum_supply.symbol;
  check(sym.is_valid(), "invalid symbol name");
  check(maximum_supply.is_valid(), "invalid supply");
  check(maximum_supply.amount > 0, "max-supply must be positive");

  stats statstable(get_self(), sym.code().raw());
  auto existing = statstable.find(sym.code().raw());
  check(existing == statstable.end(), "token with symbol already exists");

  statstable.emplace(get_self(), [&](auto& s) {
    s.supply.symbol = maximum_supply.symbol;
    s.max_supply = maximum_supply;
    s.issuer = issuer;
  });
}

void %CLASS%::issue(const name& to, const asset& quantity, const std::string& memo) {
  auto sym = quantity.symbol;
  check(sym.is_valid(), "invalid symbol name");
  check(memo.size() <= 256, "memo has more than 256 bytes");

  stats statstable(get_self(), sym.code().raw());
  auto existing = statstable.find(sym.code().raw());
  check(existing != statstable.end(), "token with symbol does not exist, create token before issue");
  const auto& st = *existing;
  check(to == st.issuer, "tokens can only be issued to issuer account");

  require_auth(st.issuer);
  check(quantity.is_valid(), "invalid quantity");
  check(quantity.amount > 0, "must issue positive quantity");
  check(quantity.symbol == st.supply.symbol, "symbol precision mismatch");
  check(quantity.amount <= st.max_supply.amount - st.supply.amount, "quantity exceeds available supply");

  statstable.modify(st, same_payer, [&](auto& s) { s.supply += quantity; });

  add_balance(st.issuer, quantity, st.issuer);
}

void %CLASS%::retire(const asset& quantity, const std::string& memo) {
  auto sym = quantity.symbol;
  check(sym.is_valid(), "invalid symbol name");
  check(memo.size() <= 256, "memo has more than 256 bytes");

  stats statstable(get_self(), sym.code().raw());
  auto existing = statstable.find(sym.code().raw());
  check(existing != statstable.end(), "token with symbol does not exist");
  const auto& st = *existing;

  require_auth(st.issuer);
  check(quantity.is_valid(), "invalid quantity");
  check(quantity.amount > 0, "must retire positive quantity");
  check(quantity.symbol == st.supply.symbol, "symbol precision mismatch");

  statstable.modify(st, same_payer, [&](auto& s) { s.supply -= quantity; });

  // Retiring the issuer's whole balance removes the issuer's row; the next
  // issue creates it again, paid by the issuer.
  sub_balance(st.issuer, quantity);
}

void %CLASS%::transfer(const name& from, const name& to, const asset& quantity, const std::string& memo) {
  check(from != to, "cannot transfer to self");
  require_auth(from);
  check(is_account(to), "to account does not exist");
  auto sym = quantity.symbol.code();
  stats statstable(get_self(), sym.raw());
  const auto& st = statstable.get(sym.raw(), "unknown token");

  require_recipient(from);
  require_recipient(to);

  check(quantity.is_valid(), "invalid quantity");
  check(quantity.amount > 0, "must transfer positive quantity");
  check(quantity.symbol == st.supply.symbol, "symbol precision mismatch");
  check(memo.size() <= 256, "memo has more than 256 bytes");

  // The receiver pays for a new row if he signed, otherwise the sender. A
  // transfer to self is refused above, so a row is never removed and created
  // again in one action.
  auto payer = has_auth(to) ? to : from;

  sub_balance(from, quantity);
  add_balance(to, quantity, payer);
}

// transfers is off by default; the header says why. To enable it, remove the
// /* and */ lines around this block and around transfers in the header, and
// the comment lines around the text of its section and the note below it in
// resource/%CONTRACT%.contracts.md.
/*
void %CLASS%::transfers(const name& from, const name& to, const std::vector<asset>& quantities, const std::string& memo) {
  check(from != to, "cannot transfer to self");
  require_auth(from);
  check(is_account(to), "to account does not exist");
  check(!quantities.empty(), "no quantity given");
  check(quantities.size() <= 16, "more than 16 quantities");
  check(memo.size() <= 256, "memo has more than 256 bytes");

  require_recipient(from);
  require_recipient(to);

  auto payer = has_auth(to) ? to : from;

  for (size_t i = 0; i < quantities.size(); ++i) {
    const auto& quantity = quantities[i];
    for (size_t j = 0; j < i; ++j) {
      check(quantities[j].symbol.code() != quantity.symbol.code(), "a symbol is given more than once");
    }
    auto sym = quantity.symbol.code();
    stats statstable(get_self(), sym.raw());
    const auto& st = statstable.get(sym.raw(), "unknown token");

    check(quantity.is_valid(), "invalid quantity");
    check(quantity.amount > 0, "must transfer positive quantity");
    check(quantity.symbol == st.supply.symbol, "symbol precision mismatch");

    // Each quantity goes through sub_balance and add_balance, so a balance
    // that reaches zero is removed here too.
    sub_balance(from, quantity);
    add_balance(to, quantity, payer);
  }
}
*/

// Every outgoing path (transfer, retire) passes here, so this is where a row
// that reaches zero is removed. A missing row is a zero balance.
void %CLASS%::sub_balance(const name& owner, const asset& value) {
  accounts from_acnts(get_self(), owner.value);
  const auto& from = from_acnts.get(value.symbol.code().raw(), "no balance object found");
  check(from.balance.amount >= value.amount, "overdrawn balance");
  if (from.balance.amount == value.amount) {
    // The balance reaches zero: remove the row. Its RAM goes back at once to
    // whoever paid for it; no signature is needed for that.
    from_acnts.erase(from);
  } else {
    // The holder becomes the RAM payer of his row, as in the standard token.
    from_acnts.modify(from, owner, [&](auto& a) { a.balance -= value; });
  }
}

// A missing row is created again here, paid by ram_payer, exactly like a
// first receipt.
void %CLASS%::add_balance(const name& owner, const asset& value, const name& ram_payer) {
  accounts to_acnts(get_self(), owner.value);
  auto to = to_acnts.find(value.symbol.code().raw());
  if (to == to_acnts.end()) {
    to_acnts.emplace(ram_payer, [&](auto& a) { a.balance = value; });
  } else {
    to_acnts.modify(to, same_payer, [&](auto& a) { a.balance += value; });
  }
}

// open keeps its standard form because wallets and exchanges call it. A row
// opened at zero stays until it has held tokens and is emptied; it is then
// removed like any other.
void %CLASS%::open(const name& owner, const symbol& symbol, const name& ram_payer) {
  require_auth(ram_payer);
  check(is_account(owner), "owner account does not exist");

  auto sym_code_raw = symbol.code().raw();
  stats statstable(get_self(), sym_code_raw);
  const auto& st = statstable.get(sym_code_raw, "symbol does not exist");
  check(st.supply.symbol == symbol, "symbol precision mismatch");

  accounts acnts(get_self(), owner.value);
  auto it = acnts.find(sym_code_raw);
  if (it == acnts.end()) {
    acnts.emplace(ram_payer, [&](auto& a) { a.balance = asset{0, symbol}; });
  }
}

// close keeps its standard form. A row emptied by a transfer or retire is
// already gone, so close on it fails with the standard message.
void %CLASS%::close(const name& owner, const symbol& symbol) {
  require_auth(owner);
  accounts acnts(get_self(), owner.value);
  auto it = acnts.find(symbol.code().raw());
  check(it != acnts.end(), "balance row already deleted or never existed, action will not have any effect");
  check(it->balance.amount == 0, "cannot close because the balance is not zero");
  acnts.erase(it);
}
