#include <%CONTRACT%.hpp>

static constexpr name ATOMICASSETS = "atomicassets"_n;

// mintasset takes two attribute maps. This contract sends them empty: the
// template holds the data. An empty map is written as a zero count whatever
// its value type, so a placeholder type is enough here.
using empty_attributes = std::vector<std::pair<std::string, std::string>>;

void %CLASS%::setconfig(name collection, name schema, int32_t template_id) {
  require_auth(get_self());
  check(template_id > 0, "template_id must be the id of a template");
  config_table cfg(get_self(), get_self().value);
  auto c = cfg.get_or_default(); // keeps the count when run again
  c.collection = collection;
  c.schema = schema;
  c.template_id = template_id;
  cfg.set(c, get_self());
}

void %CLASS%::mint(name owner) {
  require_auth(owner);
  config_table cfg(get_self(), get_self().value);
  check(cfg.exists(), "run setconfig first");
  const auto c = cfg.get();

  // One asset per account. Without a limit anyone could mint until the
  // contract account's RAM is gone, because the contract pays for each asset.
  minted_table minted(get_self(), get_self().value);
  check(minted.find(owner.value) == minted.end(), "this account has already minted");
  minted.emplace(owner, [&](auto& row) { row.owner = owner; });

  // The contract is an authorized account of the collection and signs with
  // its own active permission: eosio.code.
  action(permission_level{get_self(), "active"_n}, ATOMICASSETS, "mintasset"_n,
         std::make_tuple(get_self(), c.collection, c.schema, c.template_id, owner, empty_attributes{}, empty_attributes{},
                         std::vector<asset>{}))
      .send();
}

void %CLASS%::on_logtransfer(name collection_name, name from, name to, std::vector<uint64_t> asset_ids, std::string memo) {
  // No check() in this handler: it returns for everything it does not count.
  if (to != get_self()) return;
  config_table cfg(get_self(), get_self().value);
  if (!cfg.exists()) return;
  auto c = cfg.get();
  if (collection_name != c.collection) return;
  c.received += asset_ids.size();
  c.last_sender = from;
  // The row exists and keeps its size, so the handler never needs new RAM.
  cfg.set(c, same_payer);
}
