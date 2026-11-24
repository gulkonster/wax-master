#include <%CONTRACT%.hpp>

// Moves at most max_rows rows per call, so one transaction never runs out of
// CPU however many rows there are. Run it again until it prints "left: none".
void %CLASS%::move(uint32_t max_rows) {
  require_auth(get_self());
  check(max_rows >= 1 && max_rows <= 50, "max_rows must be 1 to 50");
  players_table  old_rows(get_self(), get_self().value);
  players2_table new_rows(get_self(), get_self().value);
  uint32_t moved = 0;
  for (auto it = old_rows.begin(); it != old_rows.end() && moved < max_rows; moved++) {
    new_rows.emplace(get_self(), [&](auto& row) {
      row.user  = it->user;
      row.score = it->score;
      row.level = it->level.value_or();   // 0 when the old row has no level
    });
    it = old_rows.erase(it);   // the old row's RAM goes back to its payer
  }
  print("moved ", moved, ", left: ", old_rows.begin() == old_rows.end() ? "none" : "some");
}

// A player still in the old table cannot be added again.
void %CLASS%::add(name user, uint32_t score) {
  require_auth(get_self());
  players_table  old_rows(get_self(), get_self().value);
  players2_table new_rows(get_self(), get_self().value);
  check(old_rows.find(user.value) == old_rows.end(), "this player is not moved yet: run move first");
  check(new_rows.find(user.value) == new_rows.end(), "this player exists");
  new_rows.emplace(get_self(), [&](auto& row) {
    row.user = user;
    row.score = score;
    row.level = 1;
  });
}

void %CLASS%::setscore(name user, uint32_t score) {
  require_auth(get_self());
  players2_table new_rows(get_self(), get_self().value);
  auto it = new_rows.require_find(user.value, "no such player in players2 (run move first if it is in players)");
  new_rows.modify(it, same_payer, [&](auto& row) { row.score = score; });
}

void %CLASS%::show(name user) {
  players2_table new_rows(get_self(), get_self().value);
  auto& row = new_rows.get(user.value, "no such player in players2 (run move first if it is in players)");
  print(row.user, ": score ", row.score, ", level ", row.level);
}
