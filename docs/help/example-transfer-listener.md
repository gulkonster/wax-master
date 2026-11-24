# Example: Transfer listener

A deposit box. WAX sent to the contract account is recorded per sender in a table, and `withdraw` sends it back. It teaches two things a WAX contract meets first: hearing about incoming tokens with a notification handler, and sending tokens from the contract with an inline action, which needs `eosio.code`.

The project is in File > New Project > **Examples** > **Transfer listener**. Its `README.md` has the same steps as this page.

> Note: The example is there to learn from. It is not audited; do not hold real value with it unchanged.

## How it works

`eosio.token` notifies both the sender and the receiver of every `transfer` (see [Notifications (on_notify)](doc:contract-notifications)). The contract has a handler for that notification:

```cpp
[[eosio::on_notify("eosio.token::transfer")]]
void on_transfer(name from, name to, asset quantity, std::string memo);
```

- The handler runs only when `eosio.token` itself sent the transfer. A fake token contract with its own `transfer` and the symbol `WAX` never reaches it, so nobody can credit himself with a worthless token.
- The contract is notified of its own outgoing transfers too (the ones `withdraw` sends). The handler returns at once when `from` is the contract or `to` is not.
- `to != get_self()` also stops a forwarded notification. Any account that receives WAX can pass the notification on with `require_recipient`; the token contract is still `eosio.token`, but `to` is that account. A handler that does not check `to` credits deposits that were never paid to it, and anyone could then withdraw the contract's WAX.
- Payments from system accounts (`eosio.*`, for example the WAX of a RAM sale) are not deposits and are skipped.
- In a notification only the contract can pay for a new row, so the contract account needs RAM for its rows.

`withdraw(owner, quantity)` checks that `owner` signed and has enough, lowers the row (or removes it at zero), and sends the tokens with an inline action:

```cpp
action(permission_level{get_self(), "active"_n}, "eosio.token"_n, "transfer"_n,
       std::make_tuple(get_self(), owner, quantity, std::string("withdraw")))
  .send();
```

The contract signs this transfer with its own `active` permission. That works only when `active` lists `<contract>@eosio.code`; see [The eosio.code permission](doc:eosio-code) and [Inline actions](doc:contract-inline-actions).

| Table | Scope | Fields |
|---|---|---|
| `deposits` | the contract account | `owner`, `balance` |

## How to do it here

1. File > New Project. Under **Examples** choose **Transfer listener**, keep the name `listener`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the contract account, press **Request test tokens**, then **Open account** and press the star. Do this before anything is deployed: after deployment a payment to the contract account goes through its contract (see "What goes wrong"). The faucet limits how often it creates accounts and sends tokens, and shows its own message when it refuses. The user account is an account you already have or one made from the contract account: on its Account page, section **Create account**, with some **Stake CPU** and **Stake NET** (for example `1.00000000 WAX` each). Send it 2 WAX from the contract account (section **Transfer**) if it has none. If **Request test tokens** is refused, send WAX to the contract account from an account you have (its Account page, section **Transfer**) before deploying.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. The contract account pays for the deposit rows: about 250 bytes for the first, about 150 for each further account. Open **RAM** on its Account page: when fewer than 2,048 bytes are free, buy 2048 bytes (**By bytes**).
6. On the contract account's Account page open **Keys and permissions**. On `active` use the switch **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. Open the user account on the Account page, section **Transfer**. **To**: the contract account, **Amount**: `1`, any memo. Press **Transfer** and approve.
8. Press **Contracts** in the top bar and open the contract account. Pick the table `deposits` and press **Run query**: one row, `owner` = the user account, `balance` = `1.00000000 WAX`.
9. Choose the action `withdraw`: `owner` = the user account, `quantity` = `0.40000000 WAX`. **Authorization**: the user account with `active`. Press **Run** and approve.
10. Run the query again: `balance` = `0.60000000 WAX`. The user account's **Tokens** show the 0.4 WAX back, and its **Transactions** show a transfer with the memo `withdraw`.
11. Run `withdraw` with `0.60000000 WAX`: the query now shows no rows.

## What is needed

- A WAX Testnet account for the contract, with RAM for the code and for the rows (steps 4 and 5).
- `eosio.code` on its `active` (step 6), or `withdraw` is refused with an error that names `eosio.code`.
- A second account with test WAX to make deposits.

## What goes wrong, and why

| What you see | Why |
|---|---|
| `withdraw` refused, the error names `eosio.code` | Step 6 is missing. |
| The transfer to the contract is refused with a RAM error | The contract account needs more RAM for the new row (step 5). |
| "the quantity is more than the deposit" | `withdraw` asked for more than the row holds. |
| "only WAX is accepted" | A token of `eosio.token` other than WAX was sent. |
| The faucet's account `faucet.wax` has a row in `deposits` | **Request test tokens**, or any other plain transfer to the deployed contract account, is recorded as a deposit of the sender. Fund the contract account before deploying (step 3). |

## Before you build on it

- The deposits and the contract account's own WAX are one balance. The table is the only record of whose WAX it is, so whoever holds the contract account's keys, or deploys new code to it, controls all of it.
- The contract pays the RAM of one row per sender: about 136 bytes, the first row 248. It takes any amount, so tiny deposits from many accounts can use up its RAM. A real contract sets a smallest amount.

See also [Example: Staking](doc:example-staking), which builds on this one, and [Example: Token payments](doc:example-payments), which accepts more than one token.
