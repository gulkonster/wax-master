#include <%CONTRACT%.hpp>

// Rows are written by the contract account and paid by it.
void %CLASS%::add(name user, uint32_t score) {
  require_auth(get_self());
  players_table players(get_self(), get_self().value);
  check(players.find(user.value) == players.end(), "this player exists");
  players.emplace(get_self(), [&](auto& row) {
    row.user = user;
    row.score = score;
  });
}

void %CLASS%::setscore(name user, uint32_t score) {
  require_auth(get_self());
  players_table players(get_self(), get_self().value);
  auto it = players.require_find(user.value, "no such player");   // reads the whole row
  players.modify(it, same_payer, [&](auto& row) { row.score = score; });
}

void %CLASS%::show(name user) {
  players_table players(get_self(), get_self().value);
  auto& row = players.get(user.value, "no such player");
  print(row.user, ": score ", row.score);
}
