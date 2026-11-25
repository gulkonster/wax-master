# Reward log

One contract that you deploy on two accounts. On the first account, the **game**, it gives players reward points and announces each reward with its own log action, `logreward`. On the second account, the **listener**, the same code only listens to those announcements and counts them. The third account, the **player**, needs no contract: the announcement still reaches his history.

A log action is how a contract tells the world what it did. Some results of an operation are known only inside the contract, such as the number of the reward and the player's new total. The contract puts them into a `logreward` action that it sends to itself, inline. That action changes no table: its data lives in the trace of the transaction and in the history that nodes and history services keep, where every web page, game and explorer can read it. AtomicAssets does the same with `logmint`, which carries the new `asset_id`.

This contract is an example to learn from: not audited; do not hold real value with it unchanged.

Before you build on it: the points are numbers in a table of the game account, not a token; whoever holds its keys can give any number of them. Every listener can make a reward fail (see "What goes wrong"), so list only accounts you trust.

## What is in it

- `reward(player, points, memo)`: signed by the game account. Checks that `player` exists, that `points` is from 1 to 1000000 and that the memo has at most 256 bytes. Adds the points to the player's row in `players` (the game account pays the RAM), takes the next reward number from `settings`, prints `reward <id>: <points> points to <player>` and sends the inline action `logreward(reward_id, player, points, total_points, memo)`.
- `logreward(reward_id, player, points, total_points, memo)`: the log action. `require_auth(get_self())`: only the contract itself can send it, otherwise anyone could fake a reward in a player's history. `require_recipient(player)` makes it part of the player's history and runs the player's contract, if he has one. `require_recipient` for every account in `listeners` notifies the listeners. It writes nothing.
- `addlistener(account)`, `rmlistener(account)`: signed by the game account; at most 5 listeners, and never the contract itself.
- `setsource(source)`: signed by the listener account; the game whose announcements it counts.
- `onlogreward` (a notification handler, not an action): `[[eosio::on_notify("*::logreward")]]` runs for the `logreward` of every contract that notifies this account, because `*` matches any contract. Anyone can deploy a contract with an action called `logreward`, so the handler first compares `get_first_receiver()`, the contract whose `logreward` is running, with the stored `source`, and returns for any other. Then it adds the reward to `heard`. It has no `check`: a handler that fails makes the game's whole reward fail.
- Table `players`, scope = the contract account: `player`, `points`, `reward_count`.
- Table `listeners`, scope = the contract account: `account`.
- Table `heard`, scope = the contract account, filled only on the listener: `player`, `points`, `reward_count`, `last_reward_id`.
- Table `settings` (one row), scope = the contract account: `next_reward_id`, `source`.

## Steps in WAX Master (WAX Testnet)

You need three accounts: the **game account**, the **listener account** and the **player account**.

1. File > New Project. Under **Examples** choose **Reward log (log action)**, keep the name `%CONTRACT%`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the **game account**, press **Request test tokens**, then **Open account** and press the star. The faucet limits how often it creates accounts and sends tokens, and shows its own message when it refuses; then send WAX to the game account from an account you have (its Account page, section **Transfer**). The **listener account** and the **player account** are accounts you already have, or are made from the game account: on its Account page, section **Create account**, with some **Stake CPU** and **Stake NET** (for example `1.00000000 WAX` each). Send the listener account WAX from the game account (section **Transfer**) for the RAM of the code (about 175,000 bytes; the Deploy dialog shows the price).
4. Contract > Deploy. **Account**: the game account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. Contract > Deploy again with the same build. **Account**: the listener account. **Buy RAM** if the dialog asks, then **Deploy**.
6. On the game account's Account page open **Keys and permissions**. On `active` tick **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve. Only the game needs it: it sends `logreward` inline. The listener sends nothing.
7. RAM, a check: the game account pays for its rows (about 480 bytes at the first reward, which makes the first player row and the settings row, about 230 for each listener, nothing for a player it already has); the listener pays for its `heard` rows (about 250 bytes for the first player). Open **RAM** on each Account page: when fewer than 2,048 bytes are free, buy 2048 bytes (**By bytes**).
8. Press **Contracts** in the top bar and open the listener account. Choose the action `setsource`: `source` = the game account. **Authorization**: the listener account with `active`. Press **Run** and approve.
9. Open the game account on the Contracts page. Choose `addlistener`: `account` = the listener account, **Authorization**: the game account. Press **Run** and approve. Pick the table `listeners` and press **Run query**: one row.
10. Choose `reward`: `player` = the player account, `points` = `100`, `memo` = `first win`, **Authorization**: the game account. Press **Run** and approve. The transaction view shows, in Traces, `reward`; under it the inline `logreward` with `reward_id` 1 and `total_points` 100; under `logreward` its notification to the player account and its notification to the listener account. The console of `reward` reads `reward 1: 100 points to <player>`.
11. Run `reward` again with `points` = `50`: `logreward` now carries `reward_id` 2 and `total_points` 150. Query `players`: one row, `points` 150, `reward_count` 2.
12. On the listener's Contract page query `heard`: one row for the player, `points` 150, `reward_count` 2, `last_reward_id` 2.
13. Open the player account's Account page, section **Transactions**: the two `logreward` actions are there, although the player signed nothing. The history service can take a few seconds to list them.

On the local chain (Network > Local Chain...) the steps are the same, with three accounts made with **New account** in place of step 3 and no RAM to buy: such an account has RAM for the code and the rows. The local chain has no history service, so step 13 shows nothing there; the transaction view of steps 10 and 11 shows everything.

## What goes wrong, and why

- `reward` refused with a message that names `eosio.code`: step 6 is missing.
- "missing authority of" the game account: `reward` or `logreward` was signed by another account. Only the game gives rewards, and only the contract itself sends `logreward`.
- "player account does not exist", "points must be more than zero", "points must be at most 1000000", "memo has more than 256 bytes": the input of `reward`.
- "listener account does not exist", "the contract does not notify itself", "already a listener", "at most 5 listeners", "not a listener": `addlistener` and `rmlistener`.
- "source account does not exist": `setsource` named an account that is not there.
- `heard` stays empty: `setsource` on the listener is missing or names another account (step 8), or `addlistener` on the game is missing (step 9).
- Every `reward` fails after a listener was added: the listener's contract fails when it is notified, for example because its account is out of RAM. Remove it with `rmlistener`.
- A transaction refused with a RAM error: the account named in it needs more RAM (step 7).

## What this example leaves out

- No token is paid: the points are a number in a table. To pay tokens, see the Token payments example and the Token template.
- No more than 5 listeners: each one runs on every reward, on the CPU of the account that signs it.
- Rows in `players` are never removed.
- No web page: Help > Documentation > Examples > Reward log shows three ways a web page or a game reads `logreward` from the trace and from a history service.

More in the documentation: Help > Documentation > Examples > Reward log, and Writing contracts > Notifications (on_notify).
