#include <%CONTRACT%.hpp>

static constexpr name ATOMICASSETS = "atomicassets"_n;

void %CLASS%::setconfig(name collection) {
  require_auth(get_self());
  check(collection != name(), "collection must not be empty");
  config_table cfg(get_self(), get_self().value);
  // Changing the collection later is allowed: rows of staked assets stay and
  // can still be unstaked.
  cfg.set(config{collection}, get_self());
}

void %CLASS%::on_transfer(name from, name to, std::vector<uint64_t> asset_ids, std::string memo) {
  // Outgoing transfers (unstake) and notifications another account passed on
  // with require_recipient (`to` is not this contract) are not stakes.
  if (from == get_self() || to != get_self()) return;
  check(memo == "stake", "send with the memo stake");
  check(asset_ids.size() <= MAX_ASSETS, "stake at most 10 assets in one transfer");
  config_table cfg(get_self(), get_self().value);
  check(cfg.exists(), "staking is not set up yet: run setconfig");
  const name collection = cfg.get().collection;

  // The notification comes after atomicassets has moved the assets, so they
  // are rows of its assets table in the scope of this contract now. Only
  // atomicassets can write that table: what it says can be trusted.
  atomic::assets_table assets(ATOMICASSETS, get_self().value);
  stakes_table stakes(get_self(), get_self().value);
  const time_point_sec now = time_point_sec(current_time_point());
  for (const uint64_t id : asset_ids) {
    const auto& a = assets.get(id, "the contract does not hold this asset");
    check(a.collection_name == collection, "only assets of the configured collection can be staked");
    check(stakes.find(id) == stakes.end(), "this asset is already staked");
    // Only the contract can pay here: a notification handler cannot charge
    // the sender's RAM.
    stakes.emplace(get_self(), [&](auto& row) {
      row.asset_id = id;
      row.owner = from;
      row.staked_at = now;
    });
  }
}

void %CLASS%::unstake(name owner, std::vector<uint64_t> asset_ids) {
  require_auth(owner);
  check(!asset_ids.empty(), "name at least one asset");
  check(asset_ids.size() <= MAX_ASSETS, "unstake at most 10 assets at a time");
  stakes_table stakes(get_self(), get_self().value);
  for (const uint64_t id : asset_ids) {
    const auto& row = stakes.get(id, "this asset is not staked");
    // The table, not atomicassets, says whose the asset is.
    check(row.owner == owner, "this asset was staked by another account");
    stakes.erase(row); // the row and its RAM go back to the contract
  }
  // All assets in one transfer. This handler hears it too and returns,
  // because `from` is the contract.
  action(permission_level{get_self(), "active"_n}, ATOMICASSETS, "transfer"_n,
         std::make_tuple(get_self(), owner, asset_ids, std::string("unstake")))
    .send();
}
