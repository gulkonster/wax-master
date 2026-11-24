# CPU and NET

CPU is processing time and NET is transaction size. Every transaction uses a little of both. An account gets them by staking WAX: the tokens are locked, and in return the account may use a share of the chain's CPU and NET. Staked tokens are not spent; you get them back when you unstake.

## How to do it here

Open the Account page, then the CPU and NET section. It shows what is staked, the gauges, and any refund in progress.

- **Stake**: enter the WAX for CPU and for NET. By default the stake goes to the account itself. You can stake to another account instead, and choose whether the tokens then belong to that account. It sends `eosio::delegatebw`.
- **Unstake**: enter the WAX to take back from CPU and from NET. It sends `eosio::undelegatebw`. The tokens do not return at once.
- **Refund**: unstaked tokens wait before they are free. The section shows the amount and the time when they can be claimed. The waiting time is a few days; the page shows the exact time.
- **Claim refund**: when the time has passed, the button sends `eosio::refund` and the tokens move to the liquid balance. On many chains this also happens by itself with the next stake or unstake.

Choose the signer, check the action shown below the fields and approve in the confirmation window.

## Example

Stake `1.00000000 WAX` to CPU on your testnet account, approve, then unstake the same amount. The section now shows a refund with its time. When the time has passed, press **Claim refund**.

## What is needed

- Liquid WAX to stake, and a key of the staking account in the vault.
- Patience when unstaking: the tokens come back after the waiting time.

> Note: Staking to another account gives that account CPU or NET. If the tokens do not belong to it, you can take them back later by unstaking.

See also [The Account page as a wallet](doc:wallet-overview), [RAM](doc:resources-ram) and [Simulate and the transaction inspector](doc:simulate-inspector).
