#include <%CONTRACT%.hpp>

static constexpr name ALCOR_SWAP = "swap.alcor"_n;
// swap.alcor refuses the swap after this many seconds (the memo's deadline).
static constexpr uint32_t DEADLINE_SECONDS = 3 * 60;

void %CLASS%::swap(uint64_t pool_id, extended_asset token_in, extended_asset min_out) {
  // These are the contract account's tokens: only its own signature may trade
  // them. An open swap action would let anybody trade them at a price he set
  // up in the same transaction.
  require_auth(get_self());
  check(token_in.quantity.is_valid() && token_in.quantity.amount > 0, "token_in must be a positive quantity");
  // The minimum comes from the caller, who read the pool before sending. A
  // minimum worked out here from the pool's price would follow a price that
  // the sender of the transaction can move first.
  check(min_out.quantity.is_valid() && min_out.quantity.amount > 0, "min_out must be positive: zero accepts any price");
  check(token_in.get_extended_symbol() != min_out.get_extended_symbol(), "token_in and min_out are the same token");

  // swapexactin#<pool id>#<recipient>#<minimum out>@<token contract>#<deadline>
  const uint32_t deadline = current_time_point().sec_since_epoch() + DEADLINE_SECONDS;
  const std::string memo = "swapexactin#" + std::to_string(pool_id) + "#" + get_self().to_string() + "#" +
                           min_out.quantity.to_string() + "@" + min_out.contract.to_string() + "#" +
                           std::to_string(deadline);
  print("memo: ", memo);

  // The transfer goes to the token's own contract, signed by the contract
  // account's active permission: eosio.code.
  action(permission_level{get_self(), "active"_n}, token_in.contract, "transfer"_n,
         std::make_tuple(get_self(), ALCOR_SWAP, token_in.quantity, memo))
    .send();
}
