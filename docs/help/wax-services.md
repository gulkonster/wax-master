# Contracts and services a WAX game uses

A WAX game rarely stands alone. Its tokens live in `eosio.token`, its NFTs in `atomicassets`, its random numbers come from `orng.wax`, its prices from `delphioracle`, and its players sign in through a wallet. This page lists them in one place: what each is for, whether you can use it on WAX Testnet while you learn, and which page of this program covers it.

Open any of the contracts below with **Contracts** in the top bar: type the account name, and the program reads its ABI and its tables from the network you selected. See [Run actions](doc:run-actions) and [Read tables](doc:read-tables).

> Note: These are other people's contracts. Their code, fees, prices and RAM rules can change when their owners deploy a new version. This page names the table that holds a value; read the value there on the day instead of copying a number from a page.

## On-chain contracts

| Account | What it is for | On WAX Testnet | Read more |
|---|---|---|---|
| `eosio.token` | Tokens: WAX itself and any token made with the standard token interface | Code; the same code as on WAX Mainnet | [The token contract](doc:token-contract), [Accepting tokens safely](doc:contract-accept-tokens), [Example: Token payments](doc:example-payments) |
| `eosio` | The system contract: accounts, RAM, CPU and NET staking, voting, name bids | Code; not the same as on WAX Mainnet | [RAM](doc:resources-ram), [CPU and NET](doc:resources-cpu-net), [Voting and rewards](doc:voting-rewards), [Name bids](doc:name-bids) |
| `atomicassets` | NFTs: collections, schemas, templates, assets, offers | Code; the same code as on WAX Mainnet | [AtomicAssets in short](doc:nft-atomicassets), [AtomicAssets notifications](doc:nft-notifications), [Example: AtomicAssets](doc:example-atomicassets), [Example: NFT staking](doc:example-nft-staking), [Example: NFT blend](doc:example-nft-blend) |
| `atomicmarket` | The market for AtomicAssets NFTs: sales, auctions, buy offers, marketplace fees | Code; the same code as on WAX Mainnet | [AtomicAssets in short](doc:nft-atomicassets) names it; no page walks it |
| `atomicdropsx` | Drops: a collection sells or gives away NFTs that are minted when a player claims | Code; the same code as on WAX Mainnet | [Drops (atomicdropsx)](doc:nft-drops) |
| `atomicpacksx` | Packs: an NFT that, when opened, gives NFTs chosen by chance | Code; the same code as on WAX Mainnet | [Packs (atomicpacksx)](doc:nft-packs) |
| `neftyblocksd` | The drops contract of NeftyBlocks, a ready-made service | Code; the same code as on WAX Mainnet | [Drops (atomicdropsx)](doc:nft-drops) names it; not walked |
| `neftyblocksp` | A NeftyBlocks packs contract | Code; not the same as on WAX Mainnet | [Packs (atomicpacksx)](doc:nft-packs) names it; not walked |
| `blenderizerx` | A ready-made blend and pack service | Code; not the same as on WAX Mainnet | [Example: NFT blend](doc:example-nft-blend) names it; not walked |
| `blend.nefty` | The blend contract of NeftyBlocks, a ready-made service | Code; not the same as on WAX Mainnet | [Example: NFT blend](doc:example-nft-blend) names it; not walked |
| `orng.wax` | Random numbers for contracts, answered in a later transaction | Code; not the same as on WAX Mainnet; it did not answer requests when this page was written | [Random numbers (ORNG)](doc:contract-random), [Example: Random number (ORNG)](doc:example-random-number) |
| `delphioracle` | Price feeds (pairs such as `waxpusd`, WAX in US dollars) written by oracle accounts | Code; the same code as on WAX Mainnet | Price feeds, below |
| `swap.alcor` | Alcor's swap pools | Code; not the same as on WAX Mainnet | [Example: Alcor swap](doc:example-alcor-swap) |
| Alcor order book | Alcor's exchange with an order book | No code on WAX Testnet (the account `alcordexmain` has none) | Not covered |

"The same code" means the code hash of the account (the **Code hash** of the account's [Contract section](doc:contract-section)) is the same on both networks. It was read from `https://testnet.waxsweden.org` and from a public WAX Mainnet endpoint on 2026-11-25. Two contracts can have the same code and still hold different tables: settings, fees and supported tokens belong to each network.

"Not the same code" means what you try on WAX Testnet is not a promise for WAX Mainnet. For these contracts treat WAX Testnet as a place to see the shape of the actions and the tables, and read the real ABI and tables on WAX Mainnet before you build on them.

## Price feeds (delphioracle)

A contract that must know what WAX is worth in US dollars reads it from `delphioracle`, never from an exchange pool.

- The table `pairs` (scope `delphioracle`) lists the pairs. The table `datapoints` (scope: the pair name, for example `waxpusd`) holds the values that oracle accounts wrote; each row has `value`, `median` and `timestamp`. Take the row with the latest `timestamp`.
- The `owner` of a row is the oracle account that wrote it, and the `median` is taken over recent values of several of them. Read the `timestamp` too: a price that nobody has updated for hours is old.
- A pool price from a swap contract is different. It is the price between two tokens in one pool, and anybody who can trade in that pool can move it for the length of one transaction. A contract that pays out by a pool price can be robbed that way. See [Example: Alcor swap](doc:example-alcor-swap).

`atomicdropsx` prices a drop in US dollars with this feed (`waxpusd`); see [Drops (atomicdropsx)](doc:nft-drops).

## Services outside the chain

These are not contracts. Your game talks to them over the internet.

| Service | What it is for | Read more |
|---|---|---|
| WAX Cloud Wallet and the login libraries around it (often called WAM) | How most web game players sign in and approve transactions, without keys of their own. Cloud Wallet accounts usually hold little RAM, and the game pays for what players cannot | [Who pays: RAM and CPU for your users](doc:contract-who-pays) |
| Anchor | A wallet application where the player holds his own keys; a game can offer it next to the Cloud Wallet | Not covered; a front-end topic |
| Hyperion | A history service: old transactions, actions of an account, token balances. A node alone cannot answer "what did this account do last week". This program uses one for its history pages | [Transaction history](doc:transaction-history), [Endpoints](doc:endpoints) |
| The AtomicAssets API | A web service that reads `atomicassets` and `atomicmarket` and answers questions a contract table cannot: all assets of an account with their attributes decoded, sales and prices. Hosts include `wax.api.atomicassets.io` (WAX Mainnet) and `test.wax.api.atomicassets.io` (WAX Testnet); the paths start with `/atomicassets/v1/` | [AtomicAssets in short](doc:nft-atomicassets) |

A front-end tutorial (wallet login libraries, drawing NFTs on a page) is outside what this program teaches. A game's page needs a library for the wallet it supports; look at the documentation of the wallet.

## What to read next

- NFTs from nothing: [AtomicAssets in short](doc:nft-atomicassets), then [Drops (atomicdropsx)](doc:nft-drops) and [Packs (atomicpacksx)](doc:nft-packs).
- Taking payments: [Accepting tokens safely](doc:contract-accept-tokens).
- Before WAX Mainnet: [Before mainnet: a checklist](doc:contract-checklist).

See also the [Glossary](doc:glossary) and [All examples](doc:examples).
