#include <%CONTRACT%.hpp>

void %CLASS%::add(name user, uint32_t score) {
  require_auth(get_self());
  players_table players(get_self(), get_self().value);
  check(players.find(user.value) == players.end(), "this player exists");
  players.emplace(get_self(), [&](auto& row) {
    row.user = user;
    row.score = score;
    row.level.emplace(1);
  });
}

// Works for old rows too. Writing a row always writes the extension: an empty
// one is written as 0, and the row grows by 4 bytes, paid by its payer.
void %CLASS%::setscore(name user, uint32_t score) {
  require_auth(get_self());
  players_table players(get_self(), get_self().value);
  auto it = players.require_find(user.value, "no such player");   // reads the whole row
  players.modify(it, same_payer, [&](auto& row) { row.score = score; });
}

void %CLASS%::setlevel(name user, uint32_t level) {
  require_auth(get_self());
  players_table players(get_self(), get_self().value);
  auto it = players.require_find(user.value, "no such player");
  players.modify(it, same_payer, [&](auto& row) { row.level.emplace(level); });
}

void %CLASS%::show(name user) {
  players_table players(get_self(), get_self().value);
  auto& row = players.get(user.value, "no such player");
  if (row.level.has_value()) {
    print(row.user, ": score ", row.score, ", level ", row.level.value());
  } else {
    print(row.user, ": score ", row.score, ", no level yet");
  }
}
