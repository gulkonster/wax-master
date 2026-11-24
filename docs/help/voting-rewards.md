# Voting and rewards

The chain is run by block producers, chosen by the votes of accounts that stake tokens. An account votes either for producers itself or through a **proxy**, another account that votes for it. On WAX, voters can also claim voting rewards.

## How to do it here

Open the Account page, then the **Voting and rewards** section. The section is shown only when the chain's system contract offers voting (the `voteproducer` action and the `producers` and `voters` tables).

The top of the section shows the current vote of the account: the producers it votes for, or the proxy, and the staked tokens that count for the vote.

The switch **Producers | Proxy** chooses the form:

- **Producers**: the list holds the active producers of the `producers` table, most votes first, with their share of all votes. Tick up to 30 of them (the limit of the system contract) and press **Vote**. It sends `eosio::voteproducer` with your producers sorted by name, as the contract requires.
- **Proxy**: enter the proxy account and press **Vote through proxy**. It sends `eosio::voteproducer` with the proxy and no producers. The proxy must be registered as a proxy (its row in the `voters` table says so); the chain refuses a vote through any other account, so the app reads that row first and says "... is not registered as a proxy" before anything is sent. An account that is itself registered as a proxy cannot vote through a proxy: the form is off for it.

A new vote always replaces the whole earlier one: voting for producers ends a proxy vote, and a proxy vote ends a vote for producers.

To remove a vote, open **Producers**, untick every producer and press **Remove the vote**. This also removes a vote through a proxy: the button is offered whenever the account has a vote, for producers or through a proxy. It sends `eosio::voteproducer` with no producers and no proxy.

The chain accepts a vote only from an account that has staked: the account needs a row in the `voters` table, which the first stake creates. Without it the top line reads "none: the account has never staked" and both forms are off with "Stake CPU or NET first".

On WAX, voting rewards build up only while the vote names at least 16 producers, or a proxy. The Producers form says so under the list, and when 1 to 15 producers are ticked it adds that this vote earns no voting rewards. The number is part of the WAX system contract and is shown only on WAX Mainnet and WAX Testnet.

### Rewards

The **Rewards** card lists the claims the chain's system contract offers. The app reads them from the contract's ABI, so it never offers an action the chain does not have:

| Claim | Action | When it is shown |
|---|---|---|
| Claim voting rewards | `eosio::voterclaim` | The ABI has `voterclaim` (WAX). On a chain that has only `claimgbmvote`, that action is used. |
| Claim genesis tokens | `eosio::claimgenesis` | The ABI has `claimgenesis` and the account has a row in the `genesis` table. |

Under each claim the card says what is due. For voting rewards it is an estimate from the `voters` and `global` tables (your unpaid vote share against all unpaid vote shares, times the voters' reward pool); the contract computes the exact amount at the claim. Where the tables do not allow an estimate, the card says so. The contract allows one voter claim per day; the card shows the time of the last claim.

Choose the signer, press **Claim** and approve in the confirmation window.

## Example

On WAX Testnet, open your account, choose **Producers**, tick two producers and press **Vote**. After the confirmation the top of the section lists the two producers. The two producers show the vote, but with fewer than 16 producers it earns no voting rewards. Switch to **Proxy**, enter a proxy account and vote; the section now shows "through the proxy ...". Vote for producers again to go back.

## What is needed

- Staked tokens: only staked CPU and NET count for the vote. See [CPU and NET](doc:resources-cpu-net).
- A key of the account in the vault.
- A proxy must be an account registered as a proxy; the chain refuses any other account.

> Note: The chain refuses a vote from an account that has never staked. Stake CPU or NET first, then vote.

See also [The Account page as a wallet](doc:wallet-overview).
