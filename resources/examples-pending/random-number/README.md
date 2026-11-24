# Random number (ORNG)

A dice roll with the WAX random number service, the contract `orng.wax`. `roll` stores a roll with no result and asks the service for a number (an inline `orng.wax::requestrand(assoc_id, signing_value, caller)`, so the contract account needs `eosio.code`). The service answers in a later transaction: it runs its own action `randnotify(request_id, dapp, assoc_id, rnd)` and notifies the contract, which handles it with `[[eosio::on_notify("orng.wax::randnotify")]]` and writes the result, 1 to 6, into the roll. It shows the request-and-answer pattern. (Contracts the service recorded before December 2025 get the older call `receiverand` instead; a contract deployed now never does.)

This contract is an example to learn from: not audited; do not hold real value with it unchanged.

Status: not tried on WAX Testnet, where the service does not answer at the moment; not included in New Project.

## What is in it

- `roll(player)`: signed by `player`, who pays for the new row. Asks `orng.wax` for a number with the row id as `assoc_id` and a signing value made from the hash of the transaction.
- `on_randnotify` (a notification handler, not an action): only `orng.wax` can send `randnotify`. It returns without a change for an answer meant for another contract, for an unknown roll and for a roll that already has its result; it does not fail, because a failure would leave the answer undelivered at `orng.wax`.
- Table `rolls`, scope = the contract account: `id`, `player`, `result` (0 until the answer arrives, then 1 to 6), `random_value`.

## What the service needs

- `eosio.code` on the contract account's `active` (step 6).
- RAM on the contract account: each open request is a row at `orng.wax` that the contract account pays for until the answer arrives (step 5).
- An allowance. Each contract gets a small number of free requests per hour. Anyone can raise it by staking WAX to `orng.wax` for the contract (a transfer with the memo `stake-<contract account>`); beyond it each request is paid from WAX deposited for the contract (memo `deposit-<contract account>`). The tables of `orng.wax` hold the numbers: `adaptcfg` the free rates, `config.a` the fee per request, `acctstate` the contract account's `credits`, `stake` and `fee_balance`. When the allowance is used up and nothing is deposited, `roll` is refused with "out of usage credits".

## Steps in WAX Master (WAX Testnet)

1. File > New Project. Under **Examples** choose **Random number (ORNG)**, keep the name `%CONTRACT%`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the **contract account**, press **Request test tokens**, then **Open account** and press the star. Create a second account the same way: the **player account**.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. On the contract account's Account page open **RAM** and buy 2048 more bytes (**By bytes**) for the requests at `orng.wax`.
6. On the contract account's Account page open **Keys and permissions**. On `active` use the switch **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. Press **Contracts** in the top bar and open the contract account. Choose the action `roll`: `player` = the player account. **Authorization**: the player account with `active`. Press **Run** and approve.
8. Pick the table `rolls` and press **Run query**: one row, `id` = 0, `player` = the player account, `result` = 0.
9. A few seconds later press **Run query** again: `result` is a number from 1 to 6 and `random_value` is filled. The contract account's **Transactions** on the Account page show the `randnotify` of `orng.wax`.
10. Each further `roll` adds a row with the next `id`.

## What goes wrong, and why

- `roll` refused with a message that names `eosio.code`: step 6 is missing.
- `roll` refused with "out of usage credits": the contract's allowance is used up. Wait, or stake or deposit WAX for it as above.
- `roll` refused with a RAM error: the contract account needs more RAM (step 5).
- `result` stays 0: the service has not answered. Open `orng.wax` on the Contract page and read its table `reqs`: your request is a row there while it waits.

More in the documentation: Help > Documentation > Examples > Random number (ORNG).
