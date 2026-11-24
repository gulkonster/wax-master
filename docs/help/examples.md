# All examples

The examples are small, complete contracts, each built around one idea. Each is a project in File > New Project > **Examples**: the source, the Ricardian files and a `README.md` with numbered steps that you follow in this app on WAX Testnet. Each has a page here with the same steps and the explanation.

> Note: The examples are there to learn from. They are not audited; do not hold real value with them unchanged.

| Example | What it teaches | Uses | Project name |
|---|---|---|---|
| [Transfer listener](doc:example-transfer-listener) | A notification handler on `eosio.token::transfer`; an inline transfer back with `eosio.code` | `eosio.token` | `listener` |
| [Staking](doc:example-staking) | A memo rule in a transfer listener; a waiting time with the block time; a payout after it | `eosio.token` | `staking` |
| [AtomicAssets](doc:example-atomicassets) | Minting NFTs as an authorized account of a collection; a notification handler that must never fail; the sale on `atomicmarket` | `atomicassets`, `atomicmarket` | `minter` |
| [Alcor swap](doc:example-alcor-swap) | Calling another contract with a transfer and a memo; `extended_asset`; who may trade and where the minimum out comes from | `swap.alcor` | `swapper` |
| [Random number (ORNG)](doc:example-random-number) | A request and an answer in a later transaction; `eosio.code` | `orng.wax` | `dice` |
| [NFT staking](doc:example-nft-staking) | NFTs sent to a contract with a memo; a table that records whose each NFT is; giving them back | `atomicassets` | `nftstake` |
| [NFT blend](doc:example-nft-blend) | Burning the NFTs of a recipe and minting the result to the sender | `atomicassets` | `blender` |
| [Token payments](doc:example-payments) | Accepting only listed tokens, checked by token contract and symbol; refusing look-alikes | `eosio.token` and any token | `payments` |

On WAX Testnet the random number service did not answer requests when this example was written (none since 2026-10-21). Steps 1 to 8 work there as written. The result of step 9 arrives only when the service answers; on WAX Mainnet it answers within seconds. Steps 9 to 11 were not tried.

## Where to start

1. Transfer listener first: the other examples build on its two ideas, a notification handler and an inline action.
2. Staking adds a memo rule and time.
3. AtomicAssets and Alcor swap use contracts of other teams that run on WAX Testnet. Their steps read those contracts' tables and run their actions from the Contract page.
4. For a game with NFTs: AtomicAssets first, then NFT staking and NFT blend; see also the group [NFTs and game tools](doc:nft-atomicassets).
5. Token payments before any contract that takes money from users: it shows how a fake token is refused. See [Accepting tokens safely](doc:contract-accept-tokens).

## What every example needs

- The toolchain (Help > Setup) and WAX Testnet selected with the Network button.
- A contract account made with Accounts > Create Testnet Account and funded with **Request test tokens** before anything is deployed. The faucet limits how often it creates accounts and sends tokens, and shows its own message when it refuses. A second account is one you already have, or one made from the first on its Account page, section **Create account**. When **Request test tokens** is refused, send WAX to the contract account from an account you have (its Account page, section **Transfer**) before deploying.
- `eosio.code` on the contract account's `active` for every example that sends an inline action: the checkbox in **Keys and permissions** on the Account page. See [The eosio.code permission](doc:eosio-code).
- RAM for the code (the Deploy dialog offers **Buy RAM**) and for the rows the contract pays for; each page says how much.

Each page ends with "Before you build on it": what a real contract adds, and what the example does not protect.

See also [Your first contract from zero](doc:first-contract) and [Project files](doc:project-files).
