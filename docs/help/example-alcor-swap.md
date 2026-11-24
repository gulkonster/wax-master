# Example: Alcor swap

A contract that swaps its own tokens on Alcor, the exchange of WAX. `swap` sends a token to `swap.alcor` with Alcor's swap memo; the pool sends the other token back to the contract account in the same transaction. It teaches how a contract uses another contract through a token transfer with a memo, why the token going in is an `extended_asset`, and why the smallest amount out must come from the caller.

The project is in File > New Project > **Examples** > **Alcor swap**. Its `README.md` has the same steps as this page.

> Note: The example is there to learn from. It is not audited; do not hold real value with it unchanged.

## Alcor's swap contract

`swap.alcor` holds pools. A pool has two tokens, `tokenA` and `tokenB`, each an `extended_asset` (quantity and token contract), a fee and its liquidity; the table `pools` of `swap.alcor` lists them. The pools belong to the accounts that put liquidity in them: their price and liquidity change at any time.

A swap is a plain token transfer to `swap.alcor` whose memo says what to do:

```
swapexactin#<pool id>#<recipient>#<minimum out>@<token contract>#<deadline>
```

| Part | Meaning |
|---|---|
| `swapexactin` | Swap exactly the transferred quantity in. |
| pool id | The `id` of a row of `pools` that holds both tokens. |
| recipient | The account that receives the token out. |
| minimum out | A quantity with the token's precision, for example `0.0400 ROGUE`. The swap is refused when the pool gives less. |
| token contract | The contract of the token out, for example `dungeonwaxlp`. |
| deadline | A time in seconds since 1970 (UTC). The swap is refused with "Expired" after it. `0` means no deadline. |

The token out comes back as a transfer from `swap.alcor` with the memo `Swap tokenOut - Pool ID #<id>`. You can make the same swap by hand from the **Transfer** section of the Account page: **To** `swap.alcor`, the amount, and the memo above.

## How it works

`swap(pool_id, token_in, min_out)` checks that the contract account signed and that both quantities are positive and different tokens, builds the memo and sends `token_in` with an inline transfer:

```cpp
const std::string memo = "swapexactin#" + std::to_string(pool_id) + "#" + get_self().to_string() + "#" +
                         min_out.quantity.to_string() + "@" + min_out.contract.to_string() + "#" +
                         std::to_string(deadline);
```

```cpp
action(permission_level{get_self(), "active"_n}, token_in.contract, "transfer"_n,
       std::make_tuple(get_self(), ALCOR_SWAP, token_in.quantity, memo))
  .send();
```

- `token_in` is an `extended_asset`: the transfer goes to `token_in.contract`, the contract that issues the token. With a plain `asset` the contract would have to guess the token contract, and a token with the same symbol on another contract is a different token. See [Assets and symbols](doc:contract-assets).
- `min_out` is an `extended_asset` too: its quantity and contract are the memo's minimum out.
- The deadline is the block time plus `DEADLINE_SECONDS` (3 minutes). Inside one transaction it cannot pass; it matters when a swap is sent later.
- The transfer is signed by the contract's own `active` permission, so the account needs `eosio.code`; see [The eosio.code permission](doc:eosio-code) and [Inline actions](doc:contract-inline-actions).
- `swap.alcor` runs the swap when it receives the transfer and sends the token out to the recipient, the contract account. If anything is refused, the whole transaction is undone and nothing moves.

## Whose tokens, and where the minimum comes from

`swap` starts with `require_auth(get_self())`: only the contract account can trade the contract account's tokens.

- An action that anybody could call would let anybody choose the pool and the minimum. He could move a pool's price with a large swap of his own, call `swap` with a low minimum in the same transaction, and swap back: the contract sells cheap and he keeps the difference.
- For the same reason the minimum out comes from the caller, who read the pool before sending, never from the pool's price read inside the contract. The sender of a transaction can put his own swap before yours in it, so a minimum worked out from the price at that moment protects nothing.
- `min_out` of zero is refused: it accepts any price.

## How to do it here

1. File > New Project. Under **Examples** choose **Alcor swap**, keep the name `swapper`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the contract account, press **Request test tokens**, then **Open account** and press the star. This example needs no second account: the contract swaps its own WAX.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. This contract has no tables, so it needs no RAM for rows. The first time the contract account receives a token, `swap.alcor` pays for its balance row at that token's contract.
6. On the contract account's Account page open **Keys and permissions**. On `active` use the switch **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. Choose a pool. Press **Contracts** in the top bar and open `swap.alcor`. Pick the table `pools`, **Lower bound** = `37`, **Limit** = `1`, **Run query**. Pool 37 holds `ROGUE` of `dungeonwaxlp` (`tokenA`, 4 decimals) and WAX of `eosio.token` (`tokenB`). Use it when `active` is `1` and `liquidity` is not `0`. If not, run the query with **Lower bound** `0` and **Limit** `100` and take a pool with WAX of `eosio.token` as `tokenA` or `tokenB`, `active` `1` and `liquidity` not `0`; in the steps below use its id, and its other token's contract, symbol and decimals.
8. Press **Contracts** and open the contract account. Choose `swap`: `pool_id` = `37`, `token_in` = `{"quantity":"1.00000000 WAX","contract":"eosio.token"}`, `min_out` = `{"quantity":"0.0001 ROGUE","contract":"dungeonwaxlp"}`. **Authorization**: the contract account with `active`. Press **Simulate** (nothing is sent), then **Open in inspector**. The transfer of `dungeonwaxlp` from `swap.alcor` to the contract account, memo `Swap tokenOut - Pool ID #37`, shows what 1 WAX buys now: about `0.04 ROGUE`.
9. Set `min_out` to about 2 % less than that amount, for example `{"quantity":"0.0400 ROGUE","contract":"dungeonwaxlp"}`. Press **Run** and approve. The trace shows the inline `eosio.token::transfer` to `swap.alcor` with the memo `swapexactin#37#<contract account>#0.0400 ROGUE@dungeonwaxlp#<deadline>`, `swap.alcor::logswap` and the ROGUE transfer back. Console: the memo.
10. The contract account's **Tokens** on its Account page show ROGUE of `dungeonwaxlp`, and WAX is 1 lower. If ROGUE is not listed: press **Contracts**, open `dungeonwaxlp`, pick the table `accounts`, **Scope** = the contract account, **Run query**.
11. On the contract account's tab run `swap` once more with `min_out` = `{"quantity":"1.0000 ROGUE","contract":"dungeonwaxlp"}` and press **Simulate**: refused with "Received lower than minTokenOut: 416, poolId: 37" (the number is what the pool would give now, in the token's smallest unit: 416 is 0.0416 ROGUE). Sent, it would be refused the same way and nothing would move.

## What is needed

- A WAX Testnet account for the contract, with RAM for the code (step 4) and the WAX it swaps.
- `eosio.code` on its `active` (step 6), or `swap` is refused with an error that names `eosio.code`.
- A pool of `swap.alcor` with WAX on one side and liquidity (step 7).

## What goes wrong, and why

| What you see | Why |
|---|---|
| `swap` refused, the error names `eosio.code` | Step 6 is missing. |
| "missing authority of" the contract account | **Authorization** is another account. Only the contract account can swap its tokens. |
| "min_out must be positive: zero accepts any price" | `min_out` is 0. |
| "Received lower than minTokenOut" | The pool gives less than `min_out` now. Simulate again (step 8) and set a lower `min_out`. |
| "Invalid tokenOut - Pool ID #37" | `min_out` is not the pool's other token, or its decimals differ (`ROGUE` has 4: `0.0400 ROGUE`, not `0.04 ROGUE`), or `pool_id` is another pool. |
| A refusal from `eosio.token` about the balance | The contract account has less WAX than `token_in`. |

## Before you build on it

- Only the contract account can call `swap`. An action anybody could call would let him trade the contract's tokens at a price he moved in the same transaction.
- The minimum out comes from the caller, read from the pool before sending, never worked out inside the contract from the pool's price.
- The pools belong to others: their tokens, price and liquidity can change at any time, and a pool id can point to another pair on another network.
- The contract does not check what came back. A contract that must use the result listens for the transfer from `swap.alcor` with a notification handler on the token contract it expects (see [Notifications (on_notify)](doc:contract-notifications)) and checks `from` and the quantity.

See also [Example: Transfer listener](doc:example-transfer-listener) for a contract that sends tokens, and [All examples](doc:examples).
