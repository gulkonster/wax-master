#include <%CONTRACT%.hpp>

void %CLASS%::reward(name player, uint64_t points, std::string memo) {
  // Only the game gives rewards.
  require_auth(get_self());
  check(is_account(player), "player account does not exist");
  check(points > 0, "points must be more than zero");
  check(points <= 1000000, "points must be at most 1000000");
  check(memo.size() <= 256, "memo has more than 256 bytes");
  // The contract pays the RAM of a new row: the player signs nothing.
  players_table players(get_self(), get_self().value);
  auto it = players.find(player.value);
  if (it == players.end()) it = players.emplace(get_self(), [&](auto& row) { row.player = player; });
  players.modify(it, same_payer, [&](auto& row) {
    row.points += points;
    row.reward_count += 1;
  });
  settings_table settings(get_self(), get_self().value);
  auto s = settings.get_or_default();
  const uint64_t reward_id = s.next_reward_id++;
  settings.set(s, get_self());
  print("reward ", reward_id, ": ", points, " points to ", player);
  // The reward id and the new total are known only here. The log action puts them into the trace
  // and the history nodes keep (not into a table), where every interface can read them. The
  // contract signs it with its own active permission, so that permission needs eosio.code.
  action(permission_level{get_self(), "active"_n}, get_self(), "logreward"_n, std::make_tuple(reward_id, player, points, it->points, memo))
      .send();
}

void %CLASS%::logreward(uint64_t reward_id, name player, uint64_t points, uint64_t total_points, std::string memo) {
  // Only this contract announces a reward; without it anyone could fake one.
  require_auth(get_self());
  // Puts the action into the player's history and runs the player's contract, if he has one.
  require_recipient(player);
  // Each listener's handler runs too, on the CPU of the transaction's payer. A listener that
  // fails makes the reward fail, so only trusted accounts are listed.
  listeners_table listeners(get_self(), get_self().value);
  for (const auto& l : listeners)
    require_recipient(l.account);
}

void %CLASS%::addlistener(name account) {
  // Only the game decides whom it notifies.
  require_auth(get_self());
  check(is_account(account), "listener account does not exist");
  check(account != get_self(), "the contract does not notify itself");
  listeners_table listeners(get_self(), get_self().value);
  check(listeners.find(account.value) == listeners.end(), "already a listener");
  check(std::distance(listeners.begin(), listeners.end()) < 5, "at most 5 listeners");
  listeners.emplace(get_self(), [&](auto& row) { row.account = account; });
}

void %CLASS%::rmlistener(name account) {
  // Only the game decides whom it notifies.
  require_auth(get_self());
  listeners_table listeners(get_self(), get_self().value);
  listeners.erase(listeners.get(account.value, "not a listener"));
}

void %CLASS%::setsource(name source) {
  // Only this account decides whom it listens to.
  require_auth(get_self());
  check(is_account(source), "source account does not exist");
  settings_table settings(get_self(), get_self().value);
  auto s = settings.get_or_default();
  s.source = source;
  settings.set(s, get_self());
}

void %CLASS%::onlogreward(uint64_t reward_id, name player, uint64_t points, uint64_t total_points, std::string memo) {
  settings_table settings(get_self(), get_self().value);
  // Any contract can have a logreward. get_first_receiver() is the one whose logreward runs.
  if (!settings.exists() || get_first_receiver() != settings.get().source) return;
  // No check() here: a failing listener would make the game's reward fail. A handler can
  // spend only its own account's RAM.
  heard_table heard(get_self(), get_self().value);
  auto it = heard.find(player.value);
  if (it == heard.end()) it = heard.emplace(get_self(), [&](auto& row) { row.player = player; });
  heard.modify(it, same_payer, [&](auto& row) {
    row.points += points;
    row.reward_count += 1;
    row.last_reward_id = reward_id;
  });
}
