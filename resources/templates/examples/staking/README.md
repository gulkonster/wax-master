# Staking

Staking inside a contract. WAX sent to the contract account with the memo `stake` is recorded as staked; `unstake` moves an amount to "unstaking" and starts a waiting time of 5 minutes; `claim` pays it out after the waiting time with an inline `eosio.token::transfer` (so the contract account needs `eosio.code`). The waiting time is one constant, `UNSTAKE_SECONDS`, in `include/%CONTRACT%.hpp`.

This is not the system's own staking for CPU and NET, which is on the Account page, section **CPU / NET**. Staking here only records amounts in the contract's table.

This contract is an example to learn from: not audited; do not hold real value with it unchanged.

## What is in it

- `on_transfer` (a notification handler, not an action): an incoming WAX transfer of `eosio.token` with the memo `stake` adds to the sender's `staked`. A transfer with another memo is refused, so the tokens stay with the sender. The contract's own outgoing transfers and payments from system accounts (`eosio.*`) are ignored.
- `unstake(owner, quantity)`: signed by `owner`; moves `quantity` from `staked` to `unstaking` and sets `claim_after` to now + 5 minutes. A new unstake starts the waiting time again for the whole unstaking amount.
- `claim(owner)`: signed by `owner`; after `claim_after`, sends the whole `unstaking` amount to `owner` with the memo `claim`. The row is removed when nothing stays staked.
- Table `stakes`, scope = the contract account: `owner`, `staked`, `unstaking`, `claim_after`.

## Steps in WAX Master (WAX Testnet)

1. File > New Project. Under **Examples** choose **Staking**, keep the name `%CONTRACT%`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the **contract account**, press **Request test tokens**, then **Open account** and press the star. Create a second account the same way: the **user account** that stakes.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. The contract account pays for the stake rows. On its Account page open **RAM** and buy 2048 more bytes (**By bytes**).
6. On the contract account's Account page open **Keys and permissions**. On `active` use the switch **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. Open the user account on the Account page, section **Transfer**. **To**: the contract account, **Amount**: `2`, **Memo**: `stake`. Press **Transfer** and approve.
8. Press **Contracts** in the top bar and open the contract account. Pick the table `stakes` and press **Run query**: one row, `staked` = `2.00000000 WAX`, `unstaking` = `0.00000000 WAX`.
9. Choose the action `unstake`: `owner` = the user account, `quantity` = `0.50000000 WAX`. **Authorization**: the user account with `active`. Press **Run** and approve. The query shows `staked` = `1.50000000 WAX`, `unstaking` = `0.50000000 WAX` and `claim_after` 5 minutes from now (UTC).
10. Run `claim` with `owner` = the user account right away: it is refused with "the waiting time is not over yet".
11. After `claim_after`, run `claim` again: the user account receives 0.5 WAX with the memo `claim`, and the row shows `unstaking` = `0.00000000 WAX`.
12. To finish: `unstake` the remaining `1.50000000 WAX`, wait 5 minutes, `claim`: the query shows no rows.

## What goes wrong, and why

- A transfer with another memo is refused with "send with the memo stake". That is on purpose: the tokens never leave the sender.
- `claim` refused with a message that names `eosio.code`: step 6 is missing.
- A transfer refused with a RAM error: the contract account needs more RAM (step 5).

More in the documentation: Help > Documentation > Examples > Staking.
