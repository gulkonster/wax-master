#include <%CONTRACT%.hpp>

static constexpr symbol WAX_SYMBOL = symbol("WAX", 8);

void %CLASS%::on_transfer(name from, name to, asset quantity, std::string memo) {
  // Skip the contract's own outgoing transfers, and notifications another
  // account passed on with require_recipient: the token contract is still
  // eosio.token, but `to` is not this contract, so nothing was paid to it.
  if (from == get_self() || to != get_self()) return;
  // Tokens the system pays to this account (a RAM sale, an unstake refund)
  // are not deposits.
  if (from.prefix() == "eosio"_n) return;
  check(quantity.symbol == WAX_SYMBOL, "only WAX is accepted");
  check(quantity.amount > 0, "the quantity must be positive");

  deposits_table deposits(get_self(), get_self().value);
  auto it = deposits.find(from.value);
  if (it == deposits.end()) {
    // In a notification only the contract itself can pay for a new row.
    deposits.emplace(get_self(), [&](auto& row) {
      row.owner = from;
      row.balance = quantity;
    });
  } else {
    deposits.modify(it, same_payer, [&](auto& row) { row.balance += quantity; });
  }
}

void %CLASS%::withdraw(name owner, asset quantity) {
  require_auth(owner);
  deposits_table deposits(get_self(), get_self().value);
  const auto& row = deposits.get(owner.value, "no deposit for this account");
  check(quantity.symbol == row.balance.symbol, "only WAX can be withdrawn");
  check(quantity.amount > 0, "the quantity must be positive");
  check(quantity <= row.balance, "the quantity is more than the deposit");

  if (quantity == row.balance) {
    deposits.erase(row); // nothing left: the row and its RAM go back
  } else {
    deposits.modify(row, same_payer, [&](auto& r) { r.balance -= quantity; });
  }
  // The contract signs with its own active permission: eosio.code.
  action(permission_level{get_self(), "active"_n}, "eosio.token"_n, "transfer"_n,
         std::make_tuple(get_self(), owner, quantity, std::string("withdraw")))
      .send();
}
