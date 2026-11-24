#include <%CONTRACT%.hpp>

#include <cstring>
#include <eosio/transaction.hpp>
#include <vector>

static constexpr name ORNG = "orng.wax"_n;

void %CLASS%::roll(name player) {
  require_auth(player);
  rolls_table rolls(get_self(), get_self().value);
  const uint64_t id = rolls.available_primary_key();
  rolls.emplace(player, [&](auto& row) { // the player pays for the row
    row.id = id;
    row.player = player;
  });

  // The signing value must not repeat: the hash of this transaction plus the
  // row id. It only makes the request unique; it is not the random number.
  const size_t size = transaction_size();
  std::vector<char> trx(size);
  read_transaction(trx.data(), size);
  const auto hash = sha256(trx.data(), size).extract_as_byte_array();
  uint64_t signing_value = 0;
  std::memcpy(&signing_value, hash.data(), sizeof(signing_value));
  signing_value += id;

  // requestrand(assoc_id, signing_value, caller): assoc_id comes back with the answer.
  action(permission_level{get_self(), "active"_n}, ORNG, "requestrand"_n,
         std::make_tuple(id, signing_value, get_self()))
    .send();
}

void %CLASS%::remove(uint64_t id) {
  rolls_table rolls(get_self(), get_self().value);
  const auto& row = rolls.get(id, "no roll with this id");
  require_auth(row.player);
  check(row.result != 0, "the roll has no result yet");
  rolls.erase(row); // the player paid for the row, so the RAM goes back to him
}

void %CLASS%::on_randnotify(uint64_t request_id, name dapp, uint64_t assoc_id, checksum256 rnd) {
  // A notification handler returns instead of failing: a failure would leave
  // the answer undelivered at orng.wax.
  if (dapp != get_self()) return;
  rolls_table rolls(get_self(), get_self().value);
  auto it = rolls.find(assoc_id);
  if (it == rolls.end() || it->result != 0) return; // unknown or already answered

  const auto bytes = rnd.extract_as_byte_array();
  uint64_t r = 0;
  std::memcpy(&r, bytes.data(), sizeof(r));
  // The row keeps its size, so nobody is charged RAM again.
  rolls.modify(it, same_payer, [&](auto& row) {
    row.result = static_cast<uint8_t>(r % 6 + 1);
    row.random_value = rnd;
  });
}
