# Transfer listener

A deposit box. WAX sent to the contract account is recorded per sender in the table `deposits`; `withdraw` sends it back. It shows how a contract learns that it received tokens (`[[eosio::on_notify("eosio.token::transfer")]]`) and how it sends tokens itself (an inline `eosio.token::transfer`, which needs `eosio.code`).

This contract is an example to learn from: not audited; do not hold real value with it unchanged.

Before you build on it: the deposits and the contract account's own WAX are one balance, and the table is the only record, so whoever holds the account's keys or deploys new code controls all of it.
The contract pays the RAM of one row per sender (about 136 bytes, the first 248) and takes any amount, so tiny deposits from many accounts can use up its RAM; a real contract sets a smallest amount.

## What is in it

- `on_transfer` (a notification handler, not an action): runs when `eosio.token` reports a transfer to or from the contract account. It adds incoming WAX to the sender's row. It ignores the contract's own outgoing transfers, notifications another account passed on (`to` is not the contract; without that check anyone could forward a transfer he received and be credited for it), and payments from system accounts (`eosio.*`, for example a RAM sale). A token of any other contract, even one called WAX, never reaches it.
- `withdraw(owner, quantity)`: signed by `owner`; lowers the deposit and sends `quantity` back to `owner` with the memo `withdraw`. The row is removed when it reaches zero.
- Table `deposits`, scope = the contract account: `owner`, `balance`.

## Steps in WAX Master (WAX Testnet)

1. File > New Project. Under **Examples** choose **Transfer listener**, keep the name `%CONTRACT%`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the **contract account**, press **Request test tokens**, then **Open account** and press the star. Do this before anything is deployed: after deployment a payment to the contract account goes through its contract (see "What goes wrong"). The faucet limits how often it creates accounts and sends tokens, and shows its own message when it refuses. The **user account** is an account you already have or one made from the contract account: on its Account page, section **Create account**, with some **Stake CPU** and **Stake NET** (for example `1.00000000 WAX` each). Send it 2 WAX from the contract account (section **Transfer**) if it has none. If **Request test tokens** is refused, send WAX to the contract account from an account you have (its Account page, section **Transfer**) before deploying.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. The contract account pays for the deposit rows: about 250 bytes for the first, about 150 for each further account. Open **RAM** on its Account page: when fewer than 2,048 bytes are free, buy 2048 bytes (**By bytes**).
6. On the contract account's Account page open **Keys and permissions**. On `active` use the switch **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. Open the user account on the Account page, section **Transfer**. **To**: the contract account, **Amount**: `1`, any memo. Press **Transfer** and approve.
8. Press **Contracts** in the top bar and open the contract account. Pick the table `deposits` and press **Run query**: one row, `owner` = the user account, `balance` = `1.00000000 WAX`.
9. On the same Contract page choose the action `withdraw`: `owner` = the user account, `quantity` = `0.40000000 WAX`. **Authorization**: the user account with `active`. Press **Run** and approve.
10. Run the query again: `balance` = `0.60000000 WAX`. The user account's **Tokens** show the 0.4 WAX back, and its **Transactions** show a transfer with the memo `withdraw`.
11. Run `withdraw` with `0.60000000 WAX`: the query now shows no rows.

## What goes wrong, and why

- `withdraw` refused with a message that names `eosio.code`: step 6 is missing.
- A transfer to the contract refused with a RAM error: the contract account needs more RAM (step 5).
- `withdraw` of more than the deposit: refused with "the quantity is more than the deposit".
- **Request test tokens** or any other plain transfer to the deployed contract account is recorded as a deposit of the sender: after a faucet payment the faucet's account `faucet.wax` has a row. Fund the contract account before deploying (step 3).

More in the documentation: Help > Documentation > Examples > Transfer listener.
