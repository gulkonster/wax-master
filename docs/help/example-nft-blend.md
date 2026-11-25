# Example: NFT blend

A blender for AtomicAssets NFTs. The contract account stores recipes: a list of ingredient templates and one result template. A user sends the ingredients to the contract with an ordinary `atomicassets::transfer` and the memo `blend:<recipe id>`; the contract checks that the assets are exactly the recipe, burns them and mints the result to the sender, all in the same transaction. It teaches how a contract reads the tables of `atomicassets`, how a notification handler refuses a transfer on purpose, and how a contract burns and mints with inline actions.

The project is in File > New Project > **Examples** > **NFT blend**. Its `README.md` has the same steps as this page.

> Note: The example is there to learn from. It is not audited; do not hold real value with it unchanged.

Collections, schemas, templates and assets are explained in [AtomicAssets in short](doc:nft-atomicassets) and in [Example: AtomicAssets](doc:example-atomicassets).

## How it works

`setrecipe(id, collection, ingredients, result_schema, result_template)` adds a row to the table `recipes`. Only the contract account can run it, and it pays for the row. Every field is checked before the row is written, because a wrong recipe would make every blend fail later:

```cpp
check(id > 0, "the recipe id must be 1 or more");
check(!ingredients.empty() && ingredients.size() <= MAX_INGREDIENTS, "a recipe has 1 to 10 ingredients");
...
for (int32_t t : ingredients) {
  check(t > 0, "a template id must be 1 or more");
  auto tpl = templates.find(uint64_t(t));
  check(tpl != templates.end(), "an ingredient template is not in this collection");
  check(tpl->burnable, "an ingredient template is not burnable");
}
```

- Template ids are `int32` in `atomicassets`, so a typed id can be negative. It is refused before it becomes a table key, where -1 would turn into a huge unsigned number. See [Checking input: negative numbers, limits, overflow](doc:contract-validate-input).
- `ingredients` holds 1 to 10 template ids, and a template may repeat (`[12, 12]` asks for two assets of template 12). The limit keeps every loop of a blend short: one burn per ingredient runs in the same transaction.
- `templates` is the table `templates` of `atomicassets` with the collection as scope. Every ingredient template must be `burnable`, which cannot be changed after the template is made, and the result template must belong to the collection and to `result_schema`.
- The ingredients are stored sorted, so a blend compares two sorted lists.
- `delrecipe(id)` removes a recipe; a recipe id that exists is refused by `setrecipe`, so a recipe is never changed under a user who is about to blend.

## The blend

`atomicassets` notifies `from` and `to` of every `transfer`. The contract listens to that notification:

```cpp
if (from == get_self() || to != get_self()) return;

const uint64_t id = recipe_id_of(memo);
check(id != 0, "send the assets with the memo blend:<recipe id>");
recipes_table recipes(get_self(), get_self().value);
const auto& r = recipes.get(id, "no recipe with this id");
check(asset_ids.size() == r.ingredients.size(), "send exactly as many assets as the recipe has ingredients");

atomicassets::assets_table assets(ATOMICASSETS, get_self().value);
std::vector<int32_t> sent;
for (uint64_t asset_id : asset_ids) {
  const auto& a = assets.get(asset_id, "an asset sent is not held by the contract");
  check(a.collection_name == r.collection, "an asset sent is not of the recipe's collection");
  sent.push_back(a.template_id);
}
std::sort(sent.begin(), sent.end());
check(sent == r.ingredients, "the assets sent are not the ingredients of this recipe");
```

- The first line returns when the contract itself sends assets, and when `to` is another account. That second case is a notification that another contract passed on: a contract that receives assets can notify this one with the same `transfer`, and without the line this contract would treat assets it never received as its own.
- `recipe_id_of` accepts `blend:` followed by 1 to 18 digits and nothing else, so the number cannot overflow; anything else gives 0, which is never a recipe id.
- By the time a notification runs, the action that sent it has finished: the assets are rows of the table `assets` of `atomicassets` with the contract account as scope. The handler reads each one and compares its collection and template with the recipe. See [Reading another contract's table](doc:contract-read-other-table).
- Every `check` here refuses the whole transfer, so a wrong blend leaves the assets with their sender. That is the point of listening to `transfer`: a handler of `logtransfer`, which goes to the collection's notify accounts, must never fail, because it would stop every movement of the collection (see [AtomicAssets notifications (logmint, logtransfer, ...)](doc:nft-notifications)). This contract is not a notify account and does not need to be one.
- A transfer to the contract account with any other memo is refused, so nobody can leave assets with it by mistake.

The rows of the tables `assets` and `templates` of `atomicassets` are declared in the header from the fields of its ABI, in the same order, in the namespace `atomicassets` outside the contract class: inside the class the compiler would put those tables into this contract's ABI without their structs, and the ABI check would stop Deploy.

When the assets are the recipe, the contract burns them and mints the result:

```cpp
for (uint64_t asset_id : asset_ids)
  action(permission_level{get_self(), "active"_n}, ATOMICASSETS, "burnasset"_n, std::make_tuple(get_self(), asset_id)).send();
action(permission_level{get_self(), "active"_n}, ATOMICASSETS, "mintasset"_n,
       std::make_tuple(get_self(), r.collection, r.result_schema, r.result_template, from, empty_attributes{}, empty_attributes{},
                       std::vector<asset>{}))
    .send();
```

- `burnasset(asset_owner, asset_id)` needs the owner's signature: the owner is now the contract account, which signs with its own `active`, so it needs `eosio.code`. See [The eosio.code permission](doc:eosio-code) and [Inline actions](doc:contract-inline-actions).
- `mintasset` needs the contract account as an authorized account of the collection; the result goes to `from`, the sender of the ingredients. The attribute maps are sent empty, as in [Example: AtomicAssets](doc:example-atomicassets): the template holds the data.
- If an inline action fails (no `eosio.code`, the contract not authorized, the result template at its `max_supply`, no RAM), the whole transaction fails, the transfer too.

| Table | Scope | Fields |
|---|---|---|
| `recipes` | the contract account | `id`, `collection`, `ingredients`, `result_schema`, `result_template` |

## How to do it here

1. File > New Project. Under **Examples** choose **NFT blend**, keep the name `blender`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the contract account, press **Request test tokens**, then **Open account** and press the star. The faucet limits how often it creates accounts and sends tokens, and shows its own message when it refuses. The user account is the author of a collection: any collection where it is an authorized account will do, for example the one made for the AtomicAssets or the NFT staking example. Otherwise it is an account you already have or one made from the contract account: on its Account page, section **Create account**, with **RAM (bytes)** `8192` and some **Stake CPU** and **Stake NET** (for example `1.00000000 WAX` each). If **Request test tokens** is refused, send WAX to the contract account from an account you have (its Account page, section **Transfer**) before deploying.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. The contract account pays for each recipe row (about 260 bytes for the first) and for every asset it mints (about 150 bytes, about 260 when the sender holds no other asset). Open **RAM** on its Account page: when fewer than 2,048 bytes are free, buy 2048 bytes (**By bytes**). The user account pays for the schema, the three templates and the three assets it mints: check it the same way.
6. On the contract account's Account page open **Keys and permissions**. On `active` tick **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. Press **Contracts** in the top bar and open `atomicassets`. In every action of steps 7 to 11 **Authorization** is the user account with `active`. If the user account has no collection yet, choose `createcol` and fill in: `author` = the user account; `collection_name` = the user account (a collection named after an existing account needs that account's signature); `allow_notify`: ticked; `authorized_accounts` = `["<user account>"]`; `notify_accounts` = `[]`; `market_fee` = `0.01`; `data` = `[{"key":"name","value":["string","Example collection"]}]`. Press **Run** and approve. Below, `<collection>` is the name of the collection.
8. Choose `createschema`: `authorized_creator` = the user account, `collection_name` = `<collection>`, `schema_name` = `blend`, `schema_format` = `[{"name":"name","type":"string"}]` (every schema needs the attribute `name`). **Run** and approve.
9. Choose `createtempl` three times, each with `authorized_creator` = the user account, `collection_name` = `<collection>`, `schema_name` = `blend`, `transferable` and `burnable`: ticked, `max_supply` = `10`; `immutable_data` = `[{"key":"name","value":["string","Wood"]}]` the first time, `[{"key":"name","value":["string","Stone"]}]` the second and `[{"key":"name","value":["string","Axe"]}]` the third. After each **Run** press **Open in inspector**: the action `lognewtempl` shows the new `template_id`. Note the three ids: `<wood>`, `<stone>` and `<axe>`. You can also read them later: table `templates`, **Scope** = `<collection>`.
10. Choose `addcolauth`: `collection_name` = `<collection>`, `account_to_add` = the contract account. **Run** and approve. The contract may now mint in the collection. Pick the table `collections`, **Lower bound** = `<collection>`, **Limit** = `1`, **Run query**: `authorized_accounts` lists the user account and the contract account.
11. Choose `mintasset` three times, each with `authorized_minter` = the user account, `collection_name` = `<collection>`, `schema_name` = `blend`, `new_asset_owner` = the user account, `immutable_data` = `[]`, `mutable_data` = `[]`, `tokens_to_back` = `[]`; `template_id` = `<wood>`, then `<stone>`, then `<wood>` again. Pick the table `assets`, **Scope** = the user account, **Run query**: note the `asset_id` of the first Wood (`<wood 1>`), of the Stone (`<stone 1>`) and of the second Wood (`<wood 2>`).
12. Press **Contracts** and open the contract account. Choose `setrecipe`: `id` = `1`, `collection` = `<collection>`, `ingredients` = `[<wood>, <stone>]`, `result_schema` = `blend`, `result_template` = `<axe>`. **Authorization**: the contract account with `active`. **Run** and approve. Pick the table `recipes`, **Run query**: one row with the two ids sorted.
13. A wrong set: on the `atomicassets` tab choose `transfer`: `from` = the user account, `to` = the contract account, `asset_ids` = `["<wood 1>", "<wood 2>"]`, `memo` = `blend:1`. **Authorization**: the user account with `active`. **Run**: refused with "the assets sent are not the ingredients of this recipe". Both assets are still in the user account.
14. An unknown recipe: the same `transfer` with `asset_ids` = `["<wood 1>", "<stone 1>"]` and `memo` = `blend:7`: refused with "no recipe with this id".
15. The blend: the same `transfer` with `asset_ids` = `["<wood 1>", "<stone 1>"]` and `memo` = `blend:1`. **Run** and approve. Press **Open in inspector**: under the `transfer` the contract's two `burnasset` actions and its `mintasset`; open `mintasset` to see the `logmint` of the new asset. (Opened later from Transactions, the same actions are listed one after another, not under the transfer.)
16. Table `assets`, **Scope** = the user account, **Run query**: `<wood 1>` and `<stone 1>` are gone, `<wood 2>` is still there, and a new asset has `template_id` = `<axe>`. With **Scope** = the contract account the table has no rows: the contract keeps nothing.
17. On the contract account's tab choose `delrecipe`: `id` = `1`. **Authorization**: the contract account. **Run** and approve. A transfer with the memo `blend:1` is now refused with "no recipe with this id".

## What is needed

- A WAX Testnet account for the contract, with RAM for the code, the recipe rows and every asset it mints (steps 4 and 5).
- `eosio.code` on its `active` (step 6): the burns and the mint are signed by the contract itself.
- The contract account as an authorized account of the collection (step 10), for `mintasset`.
- Ingredient templates made with `burnable` ticked, and a result template whose `max_supply` is not reached (0 means no limit).

## What goes wrong, and why

| What you see | Why |
|---|---|
| The transfer refused, the error names `eosio.code` | Step 6 is missing. |
| "Missing authorization for this collection" | Step 10 is missing, or the recipe names another collection. |
| `send the assets with the memo blend:<recipe id>` | The memo is not `blend:` followed by digits only. The contract accepts no assets for anything else. |
| "no recipe with this id" | No row in `recipes` has that id (step 12, or removed in step 17). |
| "send exactly as many assets as the recipe has ingredients" | Too many or too few assets. They stay with the sender. |
| "an asset sent is not of the recipe's collection" | An asset of another collection. It stays with the sender. |
| "the assets sent are not the ingredients of this recipe" | The templates differ from the recipe (step 13). The assets stay with the sender. |
| "The template's maxsupply has already been reached" | `max_supply` results are minted. Make a new result template and a new recipe. |
| "an ingredient template is not burnable" | `burnable` cannot be changed on a template; make a new one with `burnable` ticked. |
| "an ingredient template is not in this collection" | A template id of step 12 is wrong, or belongs to another collection. |
| "the result template is not in this collection and schema" | `result_template` or `result_schema` of step 12 is wrong. |
| "a recipe has 1 to 10 ingredients", "a template id must be 1 or more", "the recipe id must be 1 or more" | The fields of step 12. |
| "a recipe with this id exists; run delrecipe first" | Recipes are not changed in place; remove it first or use another id. |
| A refusal with a RAM error | The account that pays for the new row or asset needs more RAM (step 5). A transfer to an account that holds no asset also needs about 110 free bytes of the sender for a moment: `atomicassets` makes the receiver's table with the sender as payer, and the burns give the bytes back. |

## Before you build on it

- The contract account pays the RAM of every asset it mints (about 150 bytes, about 260 when the sender holds no other asset of AtomicAssets), and anybody who holds the ingredients can blend. A busy blender needs RAM, or a fee in the same transaction. The RAM of a burned ingredient goes back to the account that paid for it, not to the contract.
- When an ingredient is backed by tokens, burning it adds them to the contract account's balance at `atomicassets` (table `balances`, paid by the contract account), and the example has no action that sends them on.
- A recipe names templates. It cannot ask for an attribute value (a level, a rarity): reading the attribute data of an asset inside a contract needs the AtomicAssets serialization code. A table of the contract's own keyed by template id, like `recipes`, is the simpler way.
- A blend has no chance: the result is always the same template. A blend with chances needs the random number service and a second transaction for its answer; see [Random numbers (ORNG)](doc:contract-random) and [Example: Random number (ORNG)](doc:example-random-number).
- Assets that reach the contract account in another way, for example minted to it, are not blended and stay with it: the contract has no action that sends them on.
- Ready-made blend services exist on WAX: `blenderizerx` and `blend.nefty` (NeftyBlocks). Both have code on WAX Testnet that differs from their mainnet code; see [Contracts and services a WAX game uses](doc:wax-services).

See also [Example: NFT staking](doc:example-nft-staking) for NFTs that a contract keeps and gives back, and [All examples](doc:examples).
