# Before mainnet: a checklist

On WAX Mainnet a contract holds value, and a mistake cannot be undone by starting over. This page is one line per risk, each with the page that explains it. It is a list to work through before deploying, not a guarantee: a contract with real value should be read by someone who did not write it.

## The list

| Risk | What to check | Page |
|---|---|---|
| An action nobody should call is open | Every action that changes state or moves value starts with `require_auth` of the right account. Admin actions use `require_auth(get_self())`. | [Actions and authority checks](doc:contract-actions-auth) |
| An open action spends the contract's own allowance | If an action sends tokens or NFTs from the contract, ask who may call it, how often, and for how much. Without a signature of the user, a cooldown or a limit, anyone can empty the contract. | [Inline actions](doc:contract-inline-actions) |
| A fake token of the same symbol | The handler of `transfer` checks the token contract (`get_first_receiver()` or a fixed `"eosio.token::transfer"`), the symbol with its precision, `to == get_self()` and `from != get_self()`. | [Accepting tokens safely](doc:contract-accept-tokens), [Notifications (on_notify)](doc:contract-notifications) |
| A notification you did not expect | An account that receives tokens can pass the notification on, so `to` may be somebody else. Return early on anything that is not for your contract. | [Notifications (on_notify)](doc:contract-notifications) |
| A notify handler that fails | A handler that you add to somebody else's action, for example as the notify account of an NFT collection, must not fail, or it blocks their action. | [AtomicAssets notifications (logmint, logtransfer, ...)](doc:nft-notifications) |
| Negative amounts, wrap-around, overflow | Every number a user sends has a sign check and an upper limit; compare before you subtract; multiply before you divide, in 128 bits. | [Checking input: negative numbers, limits, overflow](doc:contract-validate-input), [Assets and symbols](doc:contract-assets) |
| The wrong RAM payer | Rows created in an action the user signed are paid by the user; rows paid by the contract have a limit; a notification handler can only charge the contract. | [Who pays: RAM and CPU for your users](doc:contract-who-pays), [Tables, scopes and payers](doc:contract-tables) |
| A loop or a list without a limit | A transaction has a CPU limit, so a loop over a table that grows, or a list of any length, is bounded by a number you chose, or is split into steps (the user calls again). | [Checking input: negative numbers, limits, overflow](doc:contract-validate-input) |
| Randomness from the chain | Never derive a random number from the block, the time or a hash of them. Use the random number service, and know that its answer comes in a later transaction. | [Random numbers (ORNG)](doc:contract-random) |
| Whose NFT is whose | When the contract holds an NFT for a user, a table says who owns it; the table is checked on every withdrawal. | [AtomicAssets in short](doc:nft-atomicassets), [Example: NFT staking](doc:example-nft-staking) |
| `eosio.code` and the keys | `eosio.code` is only on the permission that needs it, and nobody but you holds a key of the contract account. A contract that is not meant to change is made unchangeable by whoever holds the keys, not by the code alone. | [The eosio.code permission](doc:eosio-code), [Owner, active and permissions](doc:permissions-overview) |
| Who can upgrade the contract | The contract account's keys can replace the code at any time. Say who holds them, or move them to a multisig, and keep a backup. | [Thresholds and weights](doc:multisig-threshold), [Backing up keys](doc:key-backups) |
| A table changed after rows exist | Adding or reordering fields breaks the old rows. Test the upgrade on WAX Testnet over rows of the old version first. | [Changing a table: what breaks and how to migrate](doc:contract-table-migration), [Upgrading a contract and its tables](doc:contract-upgrade) |
| Errors that say nothing | Every `check` has a message a user can understand. | [Error messages](doc:contract-errors) |
| Never tried | Deploy to WAX Testnet and run every action, including the refusals. See what the node says. | [First contract from zero](doc:first-contract), [Mainnet and testnet](doc:mainnet-and-testnet) |
| RAM of the contract account | Buy enough RAM for the code, the ABI and the rows it pays, with room to spare. | [RAM](doc:resources-ram), [Deploy](doc:deploy) |

## Example

A complete contract that closes the first row of the list: an open action that sends tokens from the contract. The sender signs, the amount is fixed by the contract, there is a cooldown per account, and the total is limited.

```cpp
#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>
#include <eosio/system.hpp>
using namespace eosio;

class [[eosio::contract("claimbox")]] claimbox : public contract {
public:
  using contract::contract;

  static constexpr symbol WAX_SYMBOL = symbol(symbol_code("WAX"), 8);
  static constexpr int64_t CLAIM_AMOUNT = 10000000;   // 0.10000000 WAX per claim
  static constexpr uint32_t COOLDOWN = 24 * 60 * 60;   // seconds between two claims of one account
  static constexpr int64_t TOTAL_LIMIT = 1000000000;   // 10.00000000 WAX in all, then the box is closed

  struct [[eosio::table]] claim_row {
    name         owner;
    time_point_sec last_claim;
    uint64_t primary_key() const { return owner.value; }
  };
  typedef multi_index<"claims"_n, claim_row> claims_table;

  // One row that keeps the total paid so far.
  struct [[eosio::table]] total_row {
    uint64_t id;
    int64_t  paid;
    uint64_t primary_key() const { return id; }
  };
  typedef multi_index<"totals"_n, total_row> totals_table;

  [[eosio::action]]
  void claim(name user) {
    require_auth(user);   // the user signs: nobody can claim for somebody else, or for an account that does not exist
    check(user != get_self(), "the contract cannot claim from itself");

    totals_table totals(get_self(), get_self().value);
    auto t = totals.find(0);
    int64_t paid = t == totals.end() ? 0 : t->paid;
    check(paid + CLAIM_AMOUNT <= TOTAL_LIMIT, "the box is empty");

    claims_table claims(get_self(), get_self().value);
    auto it = claims.find(user.value);
    time_point_sec now = current_time_point();
    if (it == claims.end()) {
      claims.emplace(user, [&](auto& row) {   // the user pays the row
        row.owner = user;
        row.last_claim = now;
      });
    } else {
      check(now.sec_since_epoch() >= it->last_claim.sec_since_epoch() + COOLDOWN, "come back later, one claim per day");
      claims.modify(it, same_payer, [&](auto& row) { row.last_claim = now; });
    }

    if (t == totals.end()) {
      totals.emplace(get_self(), [&](auto& row) { row.id = 0; row.paid = CLAIM_AMOUNT; });
    } else {
      totals.modify(t, same_payer, [&](auto& row) { row.paid += CLAIM_AMOUNT; });
    }

    // Needs yourcontract@eosio.code on the contract's active permission.
    action(permission_level{get_self(), "active"_n}, "eosio.token"_n, "transfer"_n,
      std::make_tuple(get_self(), user, asset(CLAIM_AMOUNT, WAX_SYMBOL), std::string("claim"))).send();
  }
};
```

A cooldown per account does not stop one person who makes many accounts. The total limit does: that is the most the box can lose.

## How to do it here

1. Build and deploy to a testnet account and tick **eosio.code** for it (Account page > Keys and permissions); see [The eosio.code permission](doc:eosio-code). Send some testnet WAX to the contract account.
2. Run `claim` with `user` = a second account and Authorization = that account. The inspector shows the inline `transfer`.
3. Run it again at once: `come back later, one claim per day`.
4. Run it with Authorization = another account: the node refuses it with `missing authority`.
5. Go down the list above and write next to each line the page or the test that closes it for your own contract. A line you cannot close is a reason not to deploy to mainnet yet.

## What is needed

- A testnet run of every action, including the refusals.
- Someone other than the author to read the code.

> Note: The sample is not audited and is meant for learning. Every signature on mainnet moves real value, and the app asks for a confirmation window on it. See [Mainnet confirmation](doc:mainnet-confirmation).
