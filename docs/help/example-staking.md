# Example: Staking

Staking inside a contract. WAX sent to the contract account with the memo `stake` is recorded as staked; `unstake` starts a waiting time of 5 minutes; `claim` pays out after it. It teaches a memo rule in a transfer listener, a waiting time with the block time, and a payout with an inline transfer.

The project is in File > New Project > **Examples** > **Staking**. Its `README.md` has the same steps as this page.

> Note: The example is there to learn from. It is not audited; do not hold real value with it unchanged.

## Two kinds of staking

**The system's staking** gives an account CPU and NET. You lock WAX with `eosio::delegatebw`; unstaking with `eosio::undelegatebw` starts a refund that waits 3 days, then `eosio::refund` frees the tokens. In this app it is the Account page, section **CPU / NET**; see [CPU and NET](doc:resources-cpu-net).

**Staking in a contract**, as in this example, is only a record in the contract's table. The WAX sits on the contract account. What staking gives (points, a share of rewards, access) is up to the contract; this example gives nothing and only shows the pattern: deposit, unstake, wait, claim. It copies the system's rule that a new unstake starts the waiting time again for everything that waits.

## How it works

- The transfer listener (see [Example: Transfer listener](doc:example-transfer-listener)) accepts WAX of `eosio.token` with the memo `stake` and adds it to the sender's `staked`. Any other memo fails a `check`, which refuses the whole transfer: the tokens never leave the sender.
- `unstake(owner, quantity)` moves `quantity` from `staked` to `unstaking` and sets `claim_after` to the block time plus `UNSTAKE_SECONDS` (5 minutes; one constant in the header). See [Time](doc:contract-time).
- `claim(owner)` checks that the block time has reached `claim_after`, sends the whole `unstaking` amount with an inline `eosio.token::transfer` (memo `claim`) and removes the row when nothing stays staked. The inline transfer needs `eosio.code`; see [The eosio.code permission](doc:eosio-code).

```cpp
// The waiting time between unstake and claim: 5 minutes.
static constexpr uint32_t UNSTAKE_SECONDS = 5 * 60;

r.claim_after = time_point_sec(current_time_point()) + UNSTAKE_SECONDS;
```

| Table | Scope | Fields |
|---|---|---|
| `stakes` | the contract account | `owner`, `staked`, `unstaking`, `claim_after` (UTC) |

## How to do it here

1. File > New Project. Under **Examples** choose **Staking**, keep the name `staking`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the contract account, press **Request test tokens**, then **Open account** and press the star. Do this before anything is deployed: after deployment a payment to the contract account goes through its contract (see "What goes wrong"). The faucet limits how often it creates accounts and sends tokens, and shows its own message when it refuses. The user account is an account you already have or one made from the contract account: on its Account page, section **Create account**, with some **Stake CPU** and **Stake NET** (for example `1.00000000 WAX` each). Send it 3 WAX from the contract account (section **Transfer**) if it has none. If **Request test tokens** is refused, send WAX to the contract account from an account you have (its Account page, section **Transfer**) before deploying.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. The contract account pays for the stake rows: about 250 bytes for the first, about 150 for each further account. Open **RAM** on its Account page: when fewer than 2,048 bytes are free, buy 2048 bytes (**By bytes**).
6. On the contract account's Account page open **Keys and permissions**. On `active` use the switch **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. Open the user account on the Account page, section **Transfer**. **To**: the contract account, **Amount**: `2`, **Memo**: `stake`. Press **Transfer** and approve.
8. Press **Contracts** in the top bar and open the contract account. Pick the table `stakes` and press **Run query**: one row, `staked` = `2.00000000 WAX`, `unstaking` = `0.00000000 WAX`.
9. Choose the action `unstake`: `owner` = the user account, `quantity` = `0.50000000 WAX`. **Authorization**: the user account with `active`. Press **Run** and approve. The query shows `staked` = `1.50000000 WAX`, `unstaking` = `0.50000000 WAX` and `claim_after` 5 minutes from now (UTC).
10. Run `claim` with `owner` = the user account right away: it is refused with "the waiting time is not over yet".
11. After `claim_after`, run `claim` again: the user account receives 0.5 WAX with the memo `claim`, and the row shows `unstaking` = `0.00000000 WAX`.
12. To finish: `unstake` the remaining `1.50000000 WAX`, wait 5 minutes, `claim`: the query shows no rows.

## What is needed

- A WAX Testnet account for the contract, with RAM for the code and for the rows (steps 4 and 5).
- `eosio.code` on its `active` (step 6), or `claim` is refused with an error that names `eosio.code`.
- A second account with test WAX that stakes.

## What goes wrong, and why

| What you see | Why |
|---|---|
| "send with the memo stake" | The transfer had another memo. It is refused on purpose, so the tokens stay with the sender. **Request test tokens** and any plain transfer to the deployed contract account are refused the same way: fund the contract account before deploying (step 3), or send with the memo `stake` and then `unstake` and `claim`. |
| "the waiting time is not over yet" | `claim` came before `claim_after`. A later `unstake` moves `claim_after` again. |
| "nothing is unstaking; call unstake first" | `claim` with nothing in `unstaking`. |
| `claim` refused, the error names `eosio.code` | Step 6 is missing. |

## Before you build on it

- The stakes and the contract account's own WAX are one balance. The table is the only record of whose WAX it is, so whoever holds the contract account's keys, or deploys new code to it, controls all of it.
- The contract pays the RAM of one row per sender: about 156 bytes, the first row 268. It takes any amount, so tiny stakes from many accounts can use up its RAM. A real contract sets a smallest amount.
- Staking here pays no reward. What a real contract gives for a stake, and from which funds, is up to it.
