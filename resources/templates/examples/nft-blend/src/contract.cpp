#include <%CONTRACT%.hpp>

static constexpr name ATOMICASSETS = "atomicassets"_n;

// mintasset takes two attribute maps. They are sent empty: the template holds
// the data. An empty map is written as a zero count whatever its value type.
using empty_attributes = std::vector<std::pair<std::string, std::string>>;

// The recipe id of the memo "blend:<id>": digits only, at most 18 so the
// number cannot overflow. Anything else gives 0, which is never a recipe id.
static uint64_t recipe_id_of(const std::string& memo) {
  const size_t start = 6; // the length of "blend:"
  if (memo.size() <= start || memo.size() > start + 18 || memo.compare(0, start, "blend:") != 0) return 0;
  uint64_t id = 0;
  for (size_t i = start; i < memo.size(); ++i) {
    if (memo[i] < '0' || memo[i] > '9') return 0;
    id = id * 10 + uint64_t(memo[i] - '0');
  }
  return id;
}

void %CLASS%::setrecipe(uint64_t id, name collection, std::vector<int32_t> ingredients, name result_schema, int32_t result_template) {
  require_auth(get_self());
  check(id > 0, "the recipe id must be 1 or more");
  check(!ingredients.empty() && ingredients.size() <= MAX_INGREDIENTS, "a recipe has 1 to 10 ingredients");
  recipes_table recipes(get_self(), get_self().value);
  check(recipes.find(id) == recipes.end(), "a recipe with this id exists; run delrecipe first");
  // Template ids are int32: a typed id can be negative; refuse it before it is a table key.
  atomicassets::templates_table templates(ATOMICASSETS, collection.value);
  for (int32_t t : ingredients) {
    check(t > 0, "a template id must be 1 or more");
    auto tpl = templates.find(uint64_t(t));
    check(tpl != templates.end(), "an ingredient template is not in this collection");
    check(tpl->burnable, "an ingredient template is not burnable");
  }
  check(result_template > 0, "a template id must be 1 or more");
  auto res = templates.find(uint64_t(result_template));
  check(res != templates.end() && res->schema_name == result_schema, "the result template is not in this collection and schema");
  std::sort(ingredients.begin(), ingredients.end()); // a blend compares sorted lists
  recipes.emplace(get_self(), [&](auto& r) { r = recipe{id, collection, ingredients, result_schema, result_template}; });
}

void %CLASS%::delrecipe(uint64_t id) {
  require_auth(get_self());
  recipes_table recipes(get_self(), get_self().value);
  recipes.erase(recipes.require_find(id, "no recipe with this id"));
}

void %CLASS%::on_transfer(name from, name to, std::vector<uint64_t> asset_ids, std::string memo) {
  // Not a blend: assets leaving the contract, or a notification that another
  // contract passed on (then `to` is that contract, not this one).
  if (from == get_self() || to != get_self()) return;

  const uint64_t id = recipe_id_of(memo);
  check(id != 0, "send the assets with the memo blend:<recipe id>");
  recipes_table recipes(get_self(), get_self().value);
  const auto& r = recipes.get(id, "no recipe with this id");
  check(asset_ids.size() == r.ingredients.size(), "send exactly as many assets as the recipe has ingredients");

  // The transfer has already run: the assets are rows in the contract's scope.
  atomicassets::assets_table assets(ATOMICASSETS, get_self().value);
  std::vector<int32_t> sent;
  for (uint64_t asset_id : asset_ids) {
    const auto& a = assets.get(asset_id, "an asset sent is not held by the contract");
    check(a.collection_name == r.collection, "an asset sent is not of the recipe's collection");
    sent.push_back(a.template_id);
  }
  std::sort(sent.begin(), sent.end());
  check(sent == r.ingredients, "the assets sent are not the ingredients of this recipe");

  // The contract owns the assets now and signs with its own active
  // permission (eosio.code): burn each ingredient, then mint the result.
  for (uint64_t asset_id : asset_ids)
    action(permission_level{get_self(), "active"_n}, ATOMICASSETS, "burnasset"_n, std::make_tuple(get_self(), asset_id)).send();
  action(permission_level{get_self(), "active"_n}, ATOMICASSETS, "mintasset"_n,
         std::make_tuple(get_self(), r.collection, r.result_schema, r.result_template, from, empty_attributes{}, empty_attributes{},
                         std::vector<asset>{}))
      .send();
}
