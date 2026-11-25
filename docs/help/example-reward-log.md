# Example: Reward log (log actions and notifications)

A contract that gives players reward points and announces each reward with its own log action, `logreward`. The announcement reaches the player's history, although the player signs nothing, and it notifies other contracts, which can react to it. The page then shows three ways a web page or a game reads the announcement: from the answer of the send, later by transaction id, and as a player's feed.

The project is in File > New Project > **Examples** > **Reward log (log action)**. It is one contract that you deploy on two accounts: on the **game** account it gives rewards and announces them; on a **listener** account the same code only listens. Its `README.md` has the same steps as this page.

> Note: The example is there to learn from. It is not audited; do not hold real value with it unchanged.

## What you will see

- One `reward` run by the game, and under it in the transaction view: the inline action `logreward` with the reward's number and the player's new total, and under that a notification to the player and one to the listener.
- The player's **Transactions** list shows `logreward`: the action is part of his history.
- The listener's table `heard` counts the rewards it was told about.

## Why a log action

Some results of an operation are known only inside the contract: here the number of the reward and the player's new total, in AtomicAssets the id of a new asset. The caller does not know them when he signs. The contract puts them into an action that it sends to itself, inline: a log action. It changes no table. Its data lives in the trace of the transaction and in the history that nodes and history services keep, where every web page, game and explorer can read it.

```cpp
// The reward id and the new total are known only here. The log action puts them into the trace
// and the history nodes keep (not into a table), where every interface can read them. The
// contract signs it with its own active permission, so that permission needs eosio.code.
action(permission_level{get_self(), "active"_n}, get_self(), "logreward"_n, std::make_tuple(reward_id, player, points, it->points, memo))
    .send();
```

An inline action signed by the contract needs `<contract>@eosio.code` on the contract's `active` permission; see [The eosio.code permission](doc:eosio-code) and [Inline actions](doc:contract-inline-actions).

## How it works

`logreward` itself is three lines that matter:

```cpp
void rewards::logreward(uint64_t reward_id, name player, uint64_t points, uint64_t total_points, std::string memo) {
  require_auth(get_self());
  require_recipient(player);
  listeners_table listeners(get_self(), get_self().value);
  for (const auto& l : listeners)
    require_recipient(l.account);
}
```

- `require_auth(get_self())`: only the contract itself can send it. Without it anyone could run `logreward` and fake a reward in a player's history.
- `require_recipient(player)`: the action is also delivered to the player's account. That makes it part of his history, and if the player's account has a contract, that contract runs.
- `require_recipient` for every account in `listeners`: each listener's contract runs too.

The listener is the same code on another account. Its handler listens to `logreward`:

```cpp
[[eosio::on_notify("*::logreward")]]
void onlogreward(uint64_t reward_id, name player, uint64_t points, uint64_t total_points, std::string memo);
```

- `*` matches the `logreward` of every contract, and anyone can deploy a contract with an action called `logreward`. So the handler first compares `get_first_receiver()`, the contract whose `logreward` is running, with the game it chose with `setsource`, and returns for any other:

```cpp
if (!settings.exists() || get_first_receiver() != settings.get().source) return;
```

- Then it adds the reward to its table `heard`, with the listener's own RAM: a handler can spend only its own account's RAM.
- It has no `check`. A listener whose handler fails makes the game's whole `reward` fail, so the game lists only accounts it trusts, and a handler returns for what it can ignore.

| Table | Scope | Fields | Role |
|---|---|---|---|
| `players` | the contract account | `player`, `points`, `reward_count` | game |
| `listeners` | the contract account | `account` | game |
| `heard` | the contract account | `player`, `points`, `reward_count`, `last_reward_id` | listener |
| `settings` (one row) | the contract account | `next_reward_id`, `source` | both |

The checks, with their texts: `reward` refuses with "player account does not exist", "points must be more than zero", "points must be at most 1000000", "memo has more than 256 bytes"; `addlistener` and `rmlistener` with "listener account does not exist", "the contract does not notify itself", "already a listener", "at most 5 listeners", "not a listener"; `setsource` with "source account does not exist".

## The three accounts

- **Game**: holds the contract, gives the rewards, needs `eosio.code` on `active`.
- **Listener**: holds the same contract, counts the rewards. It sends nothing, so it needs no `eosio.code`.
- **Player**: any account; it needs no contract.

Where to get them:

- On the [local chain](doc:local-chain): **New account** three times in Network > Local Chain... Each starts with WAX and RAM for the code and the rows.
- On WAX Testnet: the game account with Accounts > Create Testnet Account and **Request test tokens**; the listener and the player are accounts you already have, or are made from the game account on its Account page, section **Create account**.

## How to do it here

1. File > New Project. Under **Examples** choose **Reward log (log action)**, keep the name `rewards`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select the network and make the three accounts (see above). On WAX Testnet the faucet limits how often it creates accounts and sends tokens, and shows its own message when it refuses; then send WAX to the game account from an account you have (its Account page, section **Transfer**). Send the listener account WAX from the game account for the RAM of the code (about 175,000 bytes; the Deploy dialog shows the price).
4. Contract > Deploy. **Account**: the game account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. Contract > Deploy again with the same build. **Account**: the listener account. **Buy RAM** if the dialog asks, then **Deploy**.
6. On the game account's Account page open **Keys and permissions**. On `active` tick **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. RAM, a check (WAX Testnet): the game account pays for its rows (about 480 bytes at the first reward, which makes the first player row and the settings row, about 230 for each listener, nothing for a player it already has); the listener pays for its `heard` rows (about 250 bytes for the first player). Open **RAM** on each Account page: when fewer than 2,048 bytes are free, buy 2048 bytes (**By bytes**). An account of the local chain has enough.
8. Press **Contracts** in the top bar and open the listener account. Run `setsource`: `source` = the game account, **Authorization**: the listener account with `active`.
9. Open the game account on the Contracts page. Run `addlistener`: `account` = the listener account, **Authorization**: the game account. Pick the table `listeners` and press **Run query**: one row.
10. Run `reward`: `player` = the player account, `points` = `100`, `memo` = `first win`, **Authorization**: the game account. The transaction view opens on the trace (next section).
11. Run `reward` again with `points` = `50`. Query `players`: one row, `points` 150, `reward_count` 2.
12. On the listener's Contract page query `heard`: one row for the player, `points` 150, `reward_count` 2, `last_reward_id` 2.
13. On WAX Testnet open the player account's Account page, section **Transactions**: the two `logreward` actions are listed.

## What the transaction view shows

After step 10, Traces shows the tree of everything that ran, each entry under the action that caused it:

```text
reward                      game       console: reward 1: 100 points to <player>
  logreward (inline)        game       reward_id 1, player, points 100, total_points 100, memo "first win"
    logreward (notified)    player
    logreward (notified)    listener   RAM +252 bytes (the first row of heard)
```

The two notified entries carry the same data as `logreward`: a notification is the same action, delivered to one more account. See [Simulate and the transaction inspector](doc:simulate-inspector).

## The player's history

On WAX Testnet the player's **Transactions** list shows each `logreward`, with its data: an action that named the player with `require_recipient` is part of his history, as an incoming transfer is. A history service can take a few seconds to list it. The local chain has no history service; there the transaction view of each send shows the trace. See [Transaction history](doc:transaction-history).

## The listener's table

`heard` on the listener account holds one row per player: the points and the number of rewards it was told about, and the number of the last one. It counts only the game it chose with `setsource`. A contract cannot read traces or history, only tables: a listener that needs to remember a reward writes it into its own table, as this one does.

## Reading it from a web page or a game

A contract cannot read traces; web pages, games and explorers can. Each sample below is complete, uses only `fetch`, and returns the data of `logreward`: `reward_id`, `player`, `points`, `total_points`, `memo`.

From the answer of the send. Your wallet library signs the transaction; the node's answer to `send_transaction` holds every action that ran, notifications included. The entry wanted is `logreward` received by the contract itself, not one of its notified copies:

```js
// node: an API endpoint, for example https://testnet.waxsweden.org
// contract: the game account; signed: { signatures, compression, packed_context_free_data, packed_trx }
async function sendAndReadReward(node, contract, signed) {
  const res = await fetch(`${node}/v1/chain/send_transaction`, { method: 'POST', body: JSON.stringify(signed) })
  const answer = await res.json()
  if (!res.ok) throw new Error(answer.error?.details?.[0]?.message ?? 'The node refused the transaction.')
  const log = answer.processed.action_traces.find((t) => t.act.name === 'logreward' && t.receiver === contract)
  return log ? log.act.data : null
}
```

Later, by transaction id, from a history service (Hyperion). In its answer a notification is not an entry of its own but another receipt of the same action, so the entry is found by contract and name:

```js
// history: a history service, for example https://testnet.waxsweden.org
async function rewardOfTransaction(history, contract, id) {
  const res = await fetch(`${history}/v2/history/get_transaction?id=${id}`)
  const answer = await res.json()
  if (!answer.executed) return null // unknown id, or not indexed yet
  const log = answer.actions.find((a) => a.act.account === contract && a.act.name === 'logreward')
  return log ? log.act.data : null
}
```

A player's feed: the last 20 rewards of one player, newest first. The player's own history holds them because he was notified:

```js
async function playerFeed(history, contract, player) {
  const url = `${history}/v2/history/get_actions?account=${player}&filter=${contract}:logreward&sort=desc&limit=20`
  const answer = await (await fetch(url)).json()
  return answer.actions.map((a) => ({ time: a['@timestamp'], transaction: a.trx_id, ...a.act.data }))
}
```

A contract can also hand a result back as an action return value, which the answer of the send carries. A log action is still the usual way, because it is kept in every account's history it names and it can notify other contracts; a return value notifies nobody.

## How AtomicAssets does the same

`atomicassets::mintasset` sends the inline log action `logmint`, which carries the new `asset_id` that the caller could not know, and notifies the new owner and the collection's notify accounts. A pack or a drop that mints is read the same way: the new asset ids are taken from the `logmint` entries of the trace. See [AtomicAssets notifications](doc:nft-notifications).

## The rules, in short

- A log action carries what only the contract knows; it changes no table, its data lives in the history.
- It is an inline action: the contract's `active` needs `eosio.code`.
- `require_auth(get_self())` on the log action, or anyone can fake one.
- `require_recipient(player)` puts it into the player's history and runs the player's contract, if he has one.
- A listener of `*::logreward` checks `get_first_receiver()`: `*` matches every contract.
- A listener that fails makes the action fail: list only trusted accounts; a handler returns for what it can ignore instead of calling `check`.
- A handler can spend only its own account's RAM.
- The listeners' handlers run on the CPU of the account that pays for the transaction; see [Who pays: RAM and CPU for your users](doc:contract-who-pays).
- A contract cannot read traces; only interfaces can.

## What goes wrong, and why

| What you see | Why |
|---|---|
| `reward` refused, the error names `eosio.code` | Step 6 is missing. |
| "missing authority of" the game account | `reward` or `logreward` was signed by another account. Only the game gives rewards, and only the contract itself sends `logreward`. |
| "player account does not exist", "points must be more than zero", "points must be at most 1000000", "memo has more than 256 bytes" | The input of `reward`. |
| "already a listener", "at most 5 listeners", "the contract does not notify itself", "listener account does not exist", "not a listener" | The input of `addlistener` or `rmlistener`. |
| "source account does not exist" | `setsource` named an account that is not there. |
| `heard` stays empty | `setsource` on the listener is missing or names another account (step 8), or `addlistener` on the game is missing (step 9). |
| Every `reward` fails after a listener was added | The listener's contract fails when it is notified, for example because its account is out of RAM. Remove it with `rmlistener`. |
| A RAM error | The account named in it needs more RAM (step 7). |
| The player's **Transactions** list does not show `logreward` | On the local chain there is no history service. On WAX Testnet wait a few seconds and refresh. |

## What this example leaves out

- No token is paid: the points are a number in a table. To pay tokens, see [Example: Token payments](doc:example-payments) and [The token contract](doc:token-contract).
- No more than 5 listeners: each one runs on every reward, on the CPU of the account that signs it.
- Rows in `players` are never removed.
- No web page project: the samples above are the reads such a page makes.

## Before you build on it

- The points are numbers in a table of the game account, not a token. Whoever holds its keys, or deploys new code to it, can give any number of them.
- Every listener can stop every reward. Add only accounts whose contracts you trust, and remove one with `rmlistener` when it fails.
- The game account pays for a row of every player it rewards. A real game limits who can be rewarded, or lets players pay for their own rows; see [Who pays: RAM and CPU for your users](doc:contract-who-pays).

See also [Notifications (on_notify)](doc:contract-notifications) and [All examples](doc:examples).
