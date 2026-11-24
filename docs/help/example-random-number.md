# Example: Random number (ORNG)

> Note: Not tried on WAX Testnet; not included as a project. The random number service on WAX Testnet does not answer requests at the moment, so this example is not in File > New Project yet. The page shows the contract and the steps it will have.

A dice roll with the WAX random number service on the account `orng.wax`. `roll` stores a roll without a result and asks the service for a number; the service answers in a later transaction, and the contract writes the result, 1 to 6, into the roll. It teaches the request-and-answer pattern, a notification handler and `eosio.code`. Why a contract cannot make the number itself is on [Random numbers (ORNG)](doc:contract-random).

> Note: The example is there to learn from. It is not audited; do not hold real value with it unchanged.

## The request

`roll` sends one inline action to the service (`ORNG` is the constant `"orng.wax"_n` at the top of the source), signed by the contract's own `active` permission:

```cpp
action(permission_level{get_self(), "active"_n}, ORNG, "requestrand"_n,
       std::make_tuple(id, signing_value, get_self()))
  .send();
```

| Field | Type | Meaning |
|---|---|---|
| `assoc_id` | `uint64` | Your own number, returned with the answer. Here the id of the roll row. |
| `signing_value` | `uint64` | A value that does not repeat. Here the first 8 bytes of the transaction's hash plus the row id. It only makes the request unique; it is not the random number. |
| `caller` | `name` | The contract account. It must sign the request, which is why `eosio.code` is needed. |

## The answer

The service runs its own action `orng.wax::randnotify(request_id, dapp, assoc_id, rnd)` and notifies the account named in `dapp`. The contract receives it with a notification handler (see [Notifications (on_notify)](doc:contract-notifications)). Only `orng.wax` can send that action, so nobody else can fake an answer.

```cpp
[[eosio::on_notify("orng.wax::randnotify")]]
void on_randnotify(uint64_t request_id, name dapp, uint64_t assoc_id, checksum256 rnd) {
  if (dapp != get_self()) return;
  rolls_table rolls(get_self(), get_self().value);
  auto it = rolls.find(assoc_id);
  if (it == rolls.end() || it->result != 0) return;   // unknown or already answered
  // ... write result = first 8 bytes of rnd % 6 + 1 with same_payer
}
```

- The handler returns instead of failing. A failing handler does not stop the service: the answer is kept at `orng.wax` as undelivered, with the error text.
- It changes the row with `same_payer` and does not make it bigger. In a notification only the contract itself (`get_self()`) could pay for more RAM.
- Older contracts that the service recorded before December 2025 get an inline call of their action `receiverand(assoc_id, random_value)` instead. A contract deployed now is never called that way, so a new contract must use the notification.

| Table | Scope | Fields |
|---|---|---|
| `rolls` | the contract account | `id`, `player`, `result` (0 while waiting, then 1 to 6), `random_value` |

The player pays for the row of his roll. `remove(id)`, signed by the player, removes a roll that has its result, so the RAM goes back to him. A roll that still waits is refused with "the roll has no result yet".

## What the service needs

- `eosio.code` on the contract account's `active`.
- RAM on the contract account: each open request is a row in the table `reqs` of `orng.wax`, paid by the contract account until the answer arrives.
- An allowance. Each contract gets a small number of free requests per hour. Anyone can raise it by staking WAX to `orng.wax` for the contract (a transfer with the memo `stake-<contract account>`). Beyond the allowance each request is paid from WAX deposited for the contract (memo `deposit-<contract account>`). Without allowance and without a deposit, `roll` is refused with "out of usage credits".

The numbers are the service's own and can change. Open `orng.wax` on the Contract page to read them: `adaptcfg` holds the free rates, `config.a` the fee per request, `acctstate` each contract's `credits`, `stake` and `fee_balance`, and `reqs` the requests that wait for an answer.

## How to do it here

These are the steps the project will have once it is included.

1. File > New Project. Under **Examples** choose **Random number (ORNG)**, keep the name `dice`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the contract account, press **Request test tokens**, then **Open account** and press the star. The faucet creates only one account a day, so the player account is either an account you already have or one made from the contract account: on its Account page, section **Create account**, with some **Stake CPU** and **Stake NET** (for example `1.00000000 WAX` each). The player pays the RAM of his rolls from his own account.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. The contract account pays for each request at `orng.wax` while it waits for the answer: about 212 bytes. Open **RAM** on its Account page: when fewer than 2,048 bytes are free, buy 2048 bytes (**By bytes**).
6. On the contract account's Account page open **Keys and permissions**. On `active` use the switch **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. Press **Contracts** in the top bar and open the contract account. Choose the action `roll`: `player` = the player account. **Authorization**: the player account with `active`. Press **Run** and approve.
8. Pick the table `rolls` and press **Run query**: one row, `id` = 0, `player` = the player account, `result` = 0.
9. A few seconds later press **Run query** again: `result` is a number from 1 to 6 and `random_value` is filled. The contract account's **Transactions** on the Account page show the `randnotify` of `orng.wax`.
10. Choose the action `remove`: `id` = 0. **Authorization**: the player account with `active`. Press **Run** and approve. The query no longer shows the row, and its RAM is back with the player.

## What goes wrong, and why

| What you see | Why |
|---|---|
| `roll` refused, the error names `eosio.code` | Step 6 is missing. |
| "out of usage credits" | The contract's allowance is used up. Wait, or stake or deposit WAX for it. |
| `roll` refused with a RAM error | The contract account needs RAM for the request row (step 5). |
| "the roll has no result yet" | `remove` came before the service answered that roll. |
| `result` stays 0 | The service has not answered. The request is a row in the table `reqs` of `orng.wax` while it waits. |

## Before you build on it

- `roll` is open to everybody. Each call uses one of the contract's free requests at the service and about 212 bytes of the contract account's RAM until it is answered, so a stranger can use up the allowance. A real game takes a payment or limits the calls per account.

> Note: Until the answer arrives the roll is open. A real game must not let the player cancel and get his stake back in that time, or he cancels whenever he dislikes the odds.
