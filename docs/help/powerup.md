# PowerUp

PowerUp rents CPU and NET for a fixed time (one day on WAX) for a small fee, without staking. It is the quick way to get resources for a few transactions. The fee is spent: unlike a stake, it does not come back.

## How to do it here

Open the Account page, then the **PowerUp** section. The section is shown only when the chain's system contract has the PowerUp market (the `powup.state` table).

1. The section shows how much of the CPU and NET market is rented now and the smallest fee.
2. **Receiver**: the account that gets the CPU and NET. It is this account by default; you can rent for another account. The fee is paid by this account.
3. **CPU** and **NET**: the size, given as an amount of staked tokens. The account gets the share of CPU or NET that this much stake would give for the rental time. When the account has its own CPU stake, a line estimates the CPU time from it.
4. **Cost** is computed from the market before anything is signed. **Most it may take** (`max_payment`) is the cost plus 5 %, because the market can move a little before the transaction is in a block.
5. Press **PowerUp**. The market is read again, the cost is computed again, and the confirmation window shows the `eosio::powerup` action with `max_payment`.

### How the cost is computed

The price of a resource rises with how much of it is rented. With `u` the rented share of the market:

- price `p(u) = min_price + (max_price - min_price) * u^(exponent - 1)`
- the fee for renting from `u1` to `u2` is the area under the price between them: `f(u) = min_price * u + (max_price - min_price) / exponent * u^exponent`, fee `f(u2) - f(u1)`.

Recently rented amounts count at the current price until they decay (the `adjusted_utilization` of the table). The values `min_price`, `max_price`, `exponent` and the rented amounts are read from `powup.state`. The fee is rounded up to the token's smallest unit.

## Example

On WAX Testnet, enter `10` for CPU and leave NET empty. The section shows a cost of a fraction of a WAX. Press **PowerUp**, approve, and the CPU gauge of the account rises after a moment.

## What is needed

- Liquid tokens on this account for the fee.
- A key of the account in the vault.
- If the chain refuses with "max_payment is less than calculated fee", the market price rose since the cost was computed. Nothing was paid: press **PowerUp** again.
- "calculated fee is below minimum": rent a larger amount.

See also [CPU and NET](doc:resources-cpu-net) and [The Account page as a wallet](doc:wallet-overview).
