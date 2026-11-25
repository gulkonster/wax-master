# Glossary

The words of WAX and of this program, in alphabetical order, each with the page that explains it.

| Word | Meaning | Read more |
|---|---|---|
| ABI | The JSON description of a contract's actions, tables and types; wallets and this program build forms from it | [ABI check messages](doc:abi-check) |
| Account | A name on the chain, up to 12 characters (a-z, 1-5, dots), with permissions, resources and maybe a contract | [Accounts and names](doc:accounts-and-names) |
| Action | A call of a contract function inside a transaction | [Actions and authority checks](doc:contract-actions-auth) |
| `active` | The everyday permission of an account | [Owner, active and permissions](doc:permissions-overview) |
| Asset | An amount of a token: a whole number and a symbol, for example `1.00000000 WAX`. In AtomicAssets an asset is one NFT, a row with an id and an owner | [Assets and symbols](doc:contract-assets), [AtomicAssets in short](doc:nft-atomicassets) |
| Authority | The keys, accounts, weights and threshold of a permission | [Thresholds and weights](doc:multisig-threshold) |
| Authorized account | An account that may create schemas and templates and mint in an AtomicAssets collection | [AtomicAssets in short](doc:nft-atomicassets) |
| Bid refund | The WAX of an outbid name bid, waiting at `eosio.names` until the bidder claims it with `bidrefund` | [Name bids](doc:name-bids) |
| `binary_extension` | A field type for a field added at the end of a table row: old rows without it can still be read | [Changing a table](doc:contract-table-migration) |
| Blend | Burning several NFTs to get a new one; a recipe lists what is needed | [Example: NFT blend](doc:example-nft-blend) |
| Block | A group of transactions; WAX makes one every half second | [The Network page](doc:network-page) |
| CDT | The contract compiler (WAX CDT), part of the toolchain | [Toolchain versions](doc:toolchain-versions) |
| Chain id | The unique id of a chain; mainnet and testnet differ | [Mainnet and testnet](doc:mainnet-and-testnet) |
| `check` | The call that refuses an action with a message | [Error messages](doc:contract-errors) |
| Collection | The group of an NFT author's schemas, templates and assets in AtomicAssets, with its authorized and notify accounts | [AtomicAssets in short](doc:nft-atomicassets) |
| Contract | The code (WASM) and ABI deployed on an account | [Deploy](doc:deploy) |
| CPU | The time an account may use for its transactions, from staking or PowerUp | [CPU and NET](doc:resources-cpu-net) |
| Drop | A sale or giveaway of NFTs that are minted when a player claims, made with `atomicdropsx` | [Drops (atomicdropsx)](doc:nft-drops) |
| Endpoint | The address of a node the program talks to | [Endpoints](doc:endpoints) |
| `eosio.code` | The permission an account gives its contract so it can send inline actions | [The eosio.code permission](doc:eosio-code) |
| `eosio.token` | The contract of WAX and of the standard token interface | [The token contract](doc:token-contract) |
| `extended_symbol` | A token symbol together with the contract that issues it; two tokens are the same only when both match | [Accepting tokens safely](doc:contract-accept-tokens) |
| Faucet | The WAX Testnet service that gives free test accounts and tokens | [Create a testnet account](doc:create-testnet-account) |
| First authorizer | The first account in the authorization of a transaction. When the network bills only the first authorizer, it pays the CPU and NET of the whole transaction | [Who pays: RAM and CPU for your users](doc:contract-who-pays) |
| First receiver | The contract an action was sent to; in a notification handler `get_first_receiver()` names it, so a token handler can check which contract issued the token | [Accepting tokens safely](doc:contract-accept-tokens) |
| History service | A service that indexes old transactions and token balances | [Transaction history](doc:transaction-history) |
| Inline action | An action a contract sends while it runs, in the same transaction | [Inline actions](doc:contract-inline-actions) |
| `linkauth` | Lets a custom permission sign one action of a contract | [Linked actions (linkauth)](doc:linked-actions) |
| Local chain | A private WAX chain that WAX Master runs on this computer: your own accounts, tokens and contracts, no faucet, reset at will | [The local chain](doc:local-chain) |
| Log action | An action of `atomicassets` that only tells the collection's notify accounts what happened, such as `logmint` and `logtransfer` | [AtomicAssets notifications](doc:nft-notifications) |
| Look-alike token | A token with the same symbol as a real one, issued by another contract | [Accepting tokens safely](doc:contract-accept-tokens) |
| Mainnet | The real chain, where tokens have value | [Mainnet and testnet](doc:mainnet-and-testnet) |
| `multi_index` | The table type of contracts | [Tables, scopes and payers](doc:contract-tables) |
| Mutable data | The attribute values of an AtomicAssets asset or template that an authorized account can change later | [AtomicAssets in short](doc:nft-atomicassets) |
| Name bid | An offer of WAX for a short account name, placed with `bidname` | [Name bids](doc:name-bids) |
| NET | The bytes of transactions an account may send, from staking or PowerUp | [CPU and NET](doc:resources-cpu-net) |
| Notification | A copy of an action sent to another account with `require_recipient`; handled with `on_notify` | [Notifications](doc:contract-notifications) |
| Notify account | An account that is told of every movement of a collection's assets, with `logmint`, `logtransfer` and the other log actions | [AtomicAssets notifications](doc:nft-notifications) |
| Odds | In a pack roll, the weight of an outcome; its chance is its odds divided by the total odds of the roll | [Packs (atomicpacksx)](doc:nft-packs) |
| Offer | A proposed trade of AtomicAssets assets between two accounts, accepted or declined by the recipient | [AtomicAssets in short](doc:nft-atomicassets) |
| ORNG | The WAX random number service, account `orng.wax` | [Random numbers](doc:contract-random) |
| `owner` | The permission that controls all others of an account | [Owner, active and permissions](doc:permissions-overview) |
| Pack | An NFT that is opened to receive other NFTs chosen by chance, made with `atomicpacksx` | [Packs (atomicpacksx)](doc:nft-packs) |
| Payer | The account whose RAM holds a table row | [Tables, scopes and payers](doc:contract-tables) |
| Permission | A named authority of an account, such as `owner`, `active` or a custom one | [Custom permissions](doc:custom-permissions) |
| PowerUp | Renting CPU and NET for a day instead of staking | [PowerUp](doc:powerup) |
| Premium name | A short account name (fewer than 12 characters) that only the winner of a bid can get | [Name bids](doc:name-bids) |
| Primary key | The unique 64-bit key of a table row | [Tables, scopes and payers](doc:contract-tables) |
| Private key, public key | The secret that signs, and the part that the chain stores in a permission | [The vault](doc:vault) |
| RAM | Storage on the chain for code and rows, bought and sold | [RAM](doc:resources-ram) |
| Recipe | In a blend, the ingredient templates that must be sent and the template that is minted for them | [Example: NFT blend](doc:example-nft-blend) |
| Ricardian contract | The plain-language text of an action, shown by wallets | [Ricardian contracts](doc:ricardian) |
| Roll | One outcome of a pack with its odds; in the Random number example, one request for a number | [Packs (atomicpacksx)](doc:nft-packs), [Example: Random number (ORNG)](doc:example-random-number) |
| Schema | The list of attribute names and types for the assets of an AtomicAssets collection | [AtomicAssets in short](doc:nft-atomicassets) |
| Scope | A group of rows inside a table, often one per account | [Tables, scopes and payers](doc:contract-tables) |
| `setcode`, `setabi` | The system actions that deploy the WASM and the ABI | [Deploy](doc:deploy) |
| Simulate | Running a transaction on a node without sending it | [Simulate and the transaction inspector](doc:simulate-inspector) |
| Singleton | A table with one row per scope, for settings | [Singletons](doc:contract-singletons) |
| Stake | Locking WAX for CPU and NET; unstaked WAX waits 3 days | [CPU and NET](doc:resources-cpu-net) |
| Symbol | A token's code and precision, for example `8,WAX` | [Assets and symbols](doc:contract-assets) |
| Table | Stored rows of a contract | [Read tables](doc:read-tables) |
| Template | In AtomicAssets, the attribute values that all assets of one kind share, and the most that may be made | [AtomicAssets in short](doc:nft-atomicassets) |
| Testnet | A chain for testing; its tokens are free | [Mainnet and testnet](doc:mainnet-and-testnet) |
| Threshold, weight | How many signatures (by weight) a permission needs | [Thresholds and weights](doc:multisig-threshold) |
| Time point | A time in a contract, taken from the block | [Time](doc:contract-time) |
| Toolchain | The compiler and editor engine in the program's own WSL environment | [First start and the toolchain](doc:first-start) |
| Transaction | One or more actions signed and sent together; all succeed or none | [Run actions](doc:run-actions) |
| Vault | The encrypted file of this program that holds your keys | [The vault](doc:vault) |
| WASM | The compiled code of a contract | [Build, Output and Problems](doc:build-output-problems) |

See also [Troubleshooting](doc:troubleshooting).
