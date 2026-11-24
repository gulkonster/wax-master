# Transfer listener

A deposit box. WAX sent to the contract account is recorded per sender in the table `deposits`; `withdraw` sends it back. It shows how a contract learns that it received tokens (`[[eosio::on_notify("eosio.token::transfer")]]`) and how it sends tokens itself (an inline `eosio.token::transfer`, which needs `eosio.code`).

This contract is an example to learn from: not audited; do not hold real value with it unchanged.

## What is in it

- `on_transfer` (a notification handler, not an action): runs when `eosio.token` reports a transfer to or from the contract account. It adds incoming WAX to the sender's row. It ignores the contract's own outgoing transfers and payments from system accounts (`eosio.*`, for example a RAM sale). A token of any other contract, even one called WAX, never reaches it.
- `withdraw(owner, quantity)`: signed by `owner`; lowers the deposit and sends `quantity` back to `owner` with the memo `withdraw`. The row is removed when it reaches zero.
- Table `deposits`, scope = the contract account: `owner`, `balance`.

## Steps in WAX Master (WAX Testnet)

1. File > New Project. Under **Examples** choose **Transfer listener**, keep the name `%CONTRACT%`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the **contract account**, press **Request test tokens**, then **Open account** and press the star. Create a second account the same way: the **user account** that makes deposits.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. The contract account pays for the deposit rows. On its Account page open **RAM** and buy 2048 more bytes (**By bytes**).
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

More in the documentation: Help > Documentation > Examples > Transfer listener.
