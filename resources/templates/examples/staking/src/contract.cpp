#include <%CONTRACT%.hpp>

static constexpr symbol WAX_SYMBOL = symbol("WAX", 8);

void %CLASS%::on_transfer(name from, name to, asset quantity, std::string memo) {
  // Outgoing transfers (claims) and system payments are not stakes.
  if (from == get_self() || to != get_self()) return;
  if (from.prefix() == "eosio"_n) return;
  // A failed check refuses the whole transfer, so the tokens stay with the sender.
  check(memo == "stake", "send with the memo stake");
  check(quantity.symbol == WAX_SYMBOL, "only WAX can be staked");
  check(quantity.amount > 0, "the quantity must be positive");

  stakes_table stakes(get_self(), get_self().value);
  auto it = stakes.find(from.value);
  if (it == stakes.end()) {
    stakes.emplace(get_self(), [&](auto& row) { // only the contract can pay here
      row.owner = from;
      row.staked = quantity;
      row.unstaking = asset(0, WAX_SYMBOL);
    });
  } else {
    stakes.modify(it, same_payer, [&](auto& row) { row.staked += quantity; });
  }
}

void %CLASS%::unstake(name owner, asset quantity) {
  require_auth(owner);
  stakes_table stakes(get_self(), get_self().value);
  const auto& row = stakes.get(owner.value, "nothing is staked for this account");
  check(quantity.symbol == WAX_SYMBOL, "only WAX can be unstaked");
  check(quantity.amount > 0, "the quantity must be positive");
  check(quantity <= row.staked, "the quantity is more than the staked amount");

  stakes.modify(row, same_payer, [&](auto& r) {
    r.staked -= quantity;
    r.unstaking += quantity;
    // A new unstake starts the waiting time again for the whole unstaking amount.
    r.claim_after = time_point_sec(current_time_point()) + UNSTAKE_SECONDS;
  });
}

void %CLASS%::claim(name owner) {
  require_auth(owner);
  stakes_table stakes(get_self(), get_self().value);
  const auto& row = stakes.get(owner.value, "nothing is staked for this account");
  check(row.unstaking.amount > 0, "nothing is unstaking; call unstake first");
  check(time_point_sec(current_time_point()) >= row.claim_after, "the waiting time is not over yet");

  const asset payout = row.unstaking;
  if (row.staked.amount == 0) {
    stakes.erase(row); // nothing left: the row and its RAM go back
  } else {
    stakes.modify(row, same_payer, [&](auto& r) { r.unstaking.amount = 0; });
  }
  action(permission_level{get_self(), "active"_n}, "eosio.token"_n, "transfer"_n,
         std::make_tuple(get_self(), owner, payout, std::string("claim")))
    .send();
}
