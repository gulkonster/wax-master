# Alcor swap

A contract that swaps its own tokens on Alcor, the exchange of WAX. `swap` sends a token to `swap.alcor` with Alcor's swap memo (pool, recipient, minimum out, deadline); the pool sends the other token back to the contract account in the same transaction. It shows how a contract calls another contract through a token transfer with a memo, why the token going in is an `extended_asset`, and where the minimum out must come from.

This contract is an example to learn from: not audited; do not hold real value with it unchanged.

Before you build on it: only the contract account can call `swap`, because an action anybody could call would let him trade the contract's tokens at a price he moved in the same transaction; and the minimum out comes from the caller, read from the pool before sending, never worked out inside the contract from the pool's price.
The deadline in the memo is worked out when the action runs, so it never passes; a contract whose swap can run later than it was signed (a multisig proposal, for example) takes the deadline from the caller, like the minimum out.
The pools belong to others: their tokens, price and liquidity can change at any time. The contract does not check what came back; a contract that must use the result listens for the transfer from `swap.alcor` on the token contract it expects.

## What is in it

- `swap(pool_id, token_in, min_out)`: signed by the contract account. `token_in` and `min_out` are `extended_asset`s: a quantity and the token contract that issues it, so the transfer goes to the right token contract and the memo names the token wanted. Sends `token_in` from the contract account to `swap.alcor` with the memo `swapexactin#<pool_id>#<contract account>#<min_out quantity>@<min_out contract>#<deadline>`; the deadline is the block time of the action plus 3 minutes (`DEADLINE_SECONDS`), so it cannot pass and protects nothing. The inline transfer is signed by the contract's own `active`, so it needs `eosio.code`. The memo is printed to the console.
- `swap.alcor` checks the memo, swaps in the pool and sends the other token to the contract account with the memo `Swap tokenOut - Pool ID #<id>`. If the pool cannot give `min_out`, the whole transaction is refused and nothing moves.
- No tables.

## Steps in WAX Master (WAX Testnet)

1. File > New Project. Under **Examples** choose **Alcor swap**, keep the name `%CONTRACT%`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the **contract account**, press **Request test tokens**, then **Open account** and press the star. This example needs no second account: the contract swaps its own WAX. If **Request test tokens** is refused (the faucet limits how often it sends tokens and shows its own message), send WAX to the contract account from an account you have (its Account page, section **Transfer**) before deploying.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. This contract has no tables, so it needs no RAM for rows. The first time the contract account receives a token, `swap.alcor` pays for its balance row at that token's contract.
6. On the contract account's Account page open **Keys and permissions**. On `active` tick **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. Choose a pool. Press **Contracts** in the top bar and open `swap.alcor`. Pick the table `pools`, **Lower bound** = `37`, **Limit** = `1`, **Run query**. Pool 37 holds `ROGUE` of `dungeonwaxlp` (`tokenA`, 4 decimals) and WAX of `eosio.token` (`tokenB`). Use it when `active` is `1` and `liquidity` is not `0`. If not, run the query with **Lower bound** `0` and **Limit** `100` and take a pool with WAX of `eosio.token` as `tokenA` or `tokenB`, `active` `1` and `liquidity` not `0`; in the steps below use its id, and its other token's contract, symbol and decimals.
8. Press **Contracts** and open the contract account. Choose `swap`: `pool_id` = `37`, `token_in` = `{"quantity":"1.00000000 WAX","contract":"eosio.token"}`, `min_out` = `{"quantity":"0.0001 ROGUE","contract":"dungeonwaxlp"}`. **Authorization**: the contract account with `active`. Press **Simulate** (nothing is sent), then **Open in inspector**. The transfer of `dungeonwaxlp` from `swap.alcor` to the contract account, memo `Swap tokenOut - Pool ID #37`, shows what 1 WAX buys now: about `0.04 ROGUE`.
9. Set `min_out` to about 2 % less than that amount, for example `{"quantity":"0.0400 ROGUE","contract":"dungeonwaxlp"}`. Press **Run** and approve. The trace shows the inline `eosio.token::transfer` to `swap.alcor` with the memo `swapexactin#37#<contract account>#0.0400 ROGUE@dungeonwaxlp#<deadline>`, `swap.alcor::logswap` and the ROGUE transfer back. Console: the memo.
10. The contract account's **Tokens** on its Account page show ROGUE of `dungeonwaxlp`, and WAX is 1 lower. If ROGUE is not listed: press **Contracts**, open `dungeonwaxlp`, pick the table `accounts`, **Scope** = the contract account, **Run query**.
11. On the contract account's tab run `swap` once more with `min_out` = `{"quantity":"1.0000 ROGUE","contract":"dungeonwaxlp"}` and press **Simulate**: refused with "Received lower than minTokenOut: 416, poolId: 37" (the number is what the pool would give now, in the token's smallest unit: 416 is 0.0416 ROGUE). Sent, it would be refused the same way and nothing would move.

## What goes wrong, and why

- `swap` refused with a message that names `eosio.code`: step 6 is missing.
- `swap` refused with "missing authority of" the contract account: **Authorization** is another account. Only the contract account can swap its tokens.
- "min_out must be positive: zero accepts any price": `min_out` is 0.
- "Received lower than minTokenOut": the pool gives less than `min_out` now. Simulate again (step 8) and set a lower `min_out`.
- "Invalid tokenOut - Pool ID #37": `min_out` is not the pool's other token, or its decimals differ (`ROGUE` has 4: `0.0400 ROGUE`, not `0.04 ROGUE`), or `pool_id` is another pool.
- A refusal from `eosio.token` about the balance: the contract account has less WAX than `token_in`.

More in the documentation: Help > Documentation > Examples > Alcor swap.
