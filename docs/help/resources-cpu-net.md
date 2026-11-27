# CPU and NET

CPU is processing time and NET is transaction size. Every transaction uses a little of both. An account gets them by staking WAX: the tokens are locked, and in return the account may use a share of the chain's CPU and NET. Staked tokens are not spent; you get them back when you unstake.

## How to do it here

Open the Account page, then the **CPU / NET** section. It shows what is staked, the gauges, and any refund in progress. The list **Staked by** (with the account name) shows each account it stakes to; its **Unstake...** button fills the Unstake form. The switch **Stake | Unstake** chooses the form.

- **Stake**: enter the WAX for CPU and for NET. By default the stake goes to the account itself. You can stake to another account instead; the tokens stay yours. It sends `eosio::delegatebw`. A new stake is taken from a waiting refund first, before the liquid balance.
- **Unstake**: enter the WAX to take back from CPU and from NET. It sends `eosio::undelegatebw`. The tokens do not return at once. While a refund waits, a new unstake starts the waiting time again for the whole refund.
- **Refund**: unstaked tokens wait before they are free. The waiting time is 3 days on WAX; it is fixed in the system contract and is not something the chain reports. On WAX the section shows the exact time when the refund can be claimed. On other chains it shows "about 3 days". The **Claim refund** button is always on: the chain refuses a claim while its own waiting time runs, and its answer is shown under the button.
- **Claim refund**: sends `eosio::refund`; when the time has passed, the tokens move to the liquid balance.

Choose the signer, press **Command** to see the action, and approve in the confirmation window.

## Example

Stake `1.00000000 WAX` to CPU on your testnet account, approve, then unstake the same amount. The section now shows a refund with its time. When the time has passed, press **Claim refund**.

## What is needed

- Liquid WAX to stake, and a key of the staking account in the vault.
- Patience when unstaking: the tokens come back after the waiting time.

> Note: Staking to another account gives that account CPU or NET. The tokens stay yours: you can take them back later by unstaking.

See also [The Account page as a wallet](doc:wallet-overview), [RAM](doc:resources-ram) and [Simulate and the transaction inspector](doc:simulate-inspector).
