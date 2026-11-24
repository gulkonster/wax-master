# Token payments

Accepts payments in more than one token and refuses look-alikes. The contract keeps a list of accepted tokens in the table `tokens`; a token there is two things together: the contract that issues it and its symbol with the precision. Tokens on the list that are sent to the contract account are recorded per sender and token in the table `balances`; `withdraw` sends them back. Any other token is refused, also a token called `WAX` that was not issued by `eosio.token`: anyone can create such a token on his own contract, and a contract that checks only the symbol credits it as if it were WAX.

This contract is an example to learn from: not audited; do not hold real value with it unchanged.

Before you build on it: the balances and the contract account's own tokens are one balance, and the table is the only record, so whoever holds the account's keys or deploys new code controls all of it. The same keys decide the list: a wrong contract in `addtoken` accepts a worthless token as real.
The contract pays the RAM of the rows (about 250 bytes for an account's first token, about 140 for each further token) and takes any amount, so tiny payments from many accounts can use up its RAM; a real contract sets a smallest amount per token.

## What is in it

- `addtoken(token_contract, sym)`: signed by the contract account; puts a token on the list, for example `eosio.token` and `8,WAX`. It reads the token's `stat` table on `token_contract` first: the token must exist there with exactly this precision. One contract per symbol code.
- `deltoken(code)`: signed by the contract account; takes a symbol code off the list. Balances already recorded stay and can still be withdrawn.
- `on_transfer` (a notification handler, not an action): `[[eosio::on_notify("*::transfer")]]` runs for the `transfer` action of every contract, so it checks which contract sent it. `get_first_receiver()` is that contract. The pair of it and the symbol in the transfer (`extended_symbol`) must be the pair on the list, otherwise the transfer is refused with "this token is not accepted here" and the tokens stay with the sender. Then the amount must be valid and positive, and it is added to the sender's row. It ignores the contract's own outgoing transfers, notifications another account passed on (`to` is not the contract; without that check anyone could forward a transfer he received and be credited for it), and payments from system accounts (`eosio.*`, for example a RAM sale).
- `withdraw(owner, quantity)`: signed by `owner`; lowers the balance and sends `quantity` back with the memo `withdraw`. The token contract of that transfer is taken from the balance row, never from the caller. The row is removed when it reaches zero.
- Table `tokens`, scope = the contract account: `token_contract`, `sym`.
- Table `balances`, scope = the owner's account: `token_contract`, `balance`.

## Steps in WAX Master (WAX Testnet)

You need four accounts: the **contract account**, a **user account**, a **token account** for a second real token, and a **fake token account** for a token that only looks like WAX.

1. File > New Project. Under **Examples** choose **Token payments**, keep the name `%CONTRACT%`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the **contract account**, press **Request test tokens**, then **Open account** and press the star. Do this before anything is deployed: after deployment a payment to the contract account goes through its contract (see "What goes wrong"). The faucet limits how often it creates accounts and sends tokens, and shows its own message when it refuses. The **user account** is an account you already have or one made from the contract account: on its Account page, section **Create account**, with some **Stake CPU** and **Stake NET** (for example `1.00000000 WAX` each). Send it 2 WAX from the contract account (section **Transfer**) if it has none. If **Request test tokens** is refused, send WAX to the contract account from an account you have (its Account page, section **Transfer**) before deploying.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. The contract account pays for the rows: about 250 bytes for the first token of an account, about 140 for each further token, about 130 for each token on the list. Open **RAM** on its Account page: when fewer than 2,048 bytes are free, buy 2048 bytes (**By bytes**).
6. On the contract account's Account page open **Keys and permissions**. On `active` use the switch **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. Press **Contracts** in the top bar and open the contract account. Choose the action `addtoken`: `token_contract` = `eosio.token`, `sym` = `8,WAX`. **Authorization**: the contract account with `active`. Press **Run** and approve. Pick the table `tokens` and press **Run query**: one row.
8. Open the user account on the Account page, section **Transfer**. **To**: the contract account, **Amount**: `1`, any memo. Press **Transfer** and approve.
9. On the contract's Contract page pick the table `balances`, **Scope** = the user account, and press **Run query**: one row, `token_contract` = `eosio.token`, `balance` = `1.00000000 WAX`.
10. A second real token. On the user account's Account page, section **Create account**, make the **token account** with some **Stake CPU** and **Stake NET**, and send it WAX for the RAM of a token contract (about 160,000 bytes; the Deploy dialog shows the price). File > New Project > **Token**, name it `paytoken`, build it, and deploy it to the token account (Contract > Deploy, **Buy RAM** if the dialog asks).
11. On the token account's Contract page run `create`: `issuer` = the user account, `maximum_supply` = `1000000.0000 WMT`, **Authorization**: the token account. Then `issue`: `to` = the user account, `quantity` = `100.0000 WMT`, any memo, **Authorization**: the user account.
12. On the contract's Contract page run `addtoken`: `token_contract` = the token account, `sym` = `4,WMT`, **Authorization**: the contract account.
13. On the token account's Contract page run `transfer`: `from` = the user account, `to` = the contract account, `quantity` = `10.0000 WMT`, any memo, **Authorization**: the user account. Query `balances` with **Scope** = the user account again: two rows, the WAX row and `10.0000 WMT` with `token_contract` = the token account.
14. The fake. Make the **fake token account** as in step 10 and deploy the same `paytoken` project to it (Contract > Deploy, **Account**: the fake token account). On its Contract page run `create`: `issuer` = the user account, `maximum_supply` = `1000000.00000000 WAX` (8 decimals, as the real WAX), then `issue`: `to` = the user account, `quantity` = `100.00000000 WAX`, **Authorization**: the user account. The user account now holds two tokens called WAX. Its **Tokens** list marks a WAX of another contract as not the network's WAX when it shows one.
15. On the fake token account's Contract page run `transfer`: `from` = the user account, `to` = the contract account, `quantity` = `1.00000000 WAX`, **Authorization**: the user account. It is refused with "this token is not accepted here": the fake WAX stays with the user account and `balances` is unchanged.
16. On the contract's Contract page run `withdraw`: `owner` = the user account, `quantity` = `1.00000000 WAX`, **Authorization**: the user account. Then `withdraw` with `10.0000 WMT`. The query of `balances` now shows no rows; the user account's **Transactions** show two transfers with the memo `withdraw`, one of `eosio.token` and one of the token account.

## What goes wrong, and why

- "this token is not accepted here": the token is not on the list (step 7 or 12 is missing), or it is the same symbol from another contract (step 15), or the precision differs.
- `addtoken` refused with "this contract has no token with this symbol": `token_contract` has no `create` for that symbol code yet (step 11), or it is the wrong account. With "the token has another precision on its contract": `sym` has the wrong number of decimals, for example `4,WAX`.
- `withdraw` refused with a message that names `eosio.code`: step 6 is missing.
- A transfer to the contract refused with a RAM error: the contract account needs more RAM (step 5).
- `withdraw` of more than the balance: refused with "the quantity is more than the balance".
- A transfer refused with "withdraw the old balance of this symbol first": the list was changed with `deltoken` and `addtoken` and now names another contract for this symbol code, and the sender still has a balance of the old token. He withdraws it, then sends again.
- **Request test tokens** or any other plain WAX transfer to the deployed contract account: before step 7 it is refused with "this token is not accepted here"; after step 7 it is recorded as a balance of the sender, for a faucet payment the faucet's account `faucet.wax`. Fund the contract account before deploying (step 3).
- An NFT sent to the contract account: the handler also runs for `atomicassets::transfer`, whose data is not a token transfer, so the transfer fails. This contract does not take NFTs.

More in the documentation: Help > Documentation > Examples > Token payments, and Writing contracts > Accepting tokens safely.
