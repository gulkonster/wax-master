# Glossary

The words of WAX and of this program, in alphabetical order, each with the page that explains it.

| Word | Meaning | Read more |
|---|---|---|
| ABI | The JSON description of a contract's actions, tables and types; wallets and this program build forms from it | [ABI check messages](doc:abi-check) |
| Account | A name on the chain, up to 12 characters (a-z, 1-5, dots), with permissions, resources and maybe a contract | [Accounts and names](doc:accounts-and-names) |
| Action | A call of a contract function inside a transaction | [Actions and authority checks](doc:contract-actions-auth) |
| `active` | The everyday permission of an account | [Owner, active and permissions](doc:permissions-overview) |
| Asset | An amount of a token: a whole number and a symbol, for example `1.00000000 WAX` | [Assets and symbols](doc:contract-assets) |
| Authority | The keys, accounts, weights and threshold of a permission | [Thresholds and weights](doc:multisig-threshold) |
| Block | A group of transactions; WAX makes one every half second | [The Network page](doc:network-page) |
| CDT | The contract compiler (WAX CDT), part of the toolchain | [Toolchain versions](doc:toolchain-versions) |
| `check` | The call that refuses an action with a message | [Error messages](doc:contract-errors) |
| Chain id | The unique id of a chain; mainnet and testnet differ | [Mainnet and testnet](doc:mainnet-and-testnet) |
| Contract | The code (WASM) and ABI deployed on an account | [Deploy](doc:deploy) |
| CPU | The time an account may use for its transactions, from staking or PowerUp | [CPU and NET](doc:resources-cpu-net) |
| Endpoint | The address of a node the program talks to | [Endpoints](doc:endpoints) |
| `eosio.code` | The permission an account gives its contract so it can send inline actions | [The eosio.code permission](doc:eosio-code) |
| `eosio.token` | The contract of WAX and of the standard token interface | [The token contract](doc:token-contract) |
| Faucet | The WAX Testnet service that gives free test accounts and tokens | [Create a testnet account](doc:create-testnet-account) |
| History service | A service that indexes old transactions and token balances | [Transaction history](doc:transaction-history) |
| Inline action | An action a contract sends while it runs, in the same transaction | [Inline actions](doc:contract-inline-actions) |
| `linkauth` | Lets a custom permission sign one action of a contract | [Linked actions (linkauth)](doc:linked-actions) |
| Mainnet | The real chain, where tokens have value | [Mainnet and testnet](doc:mainnet-and-testnet) |
| `multi_index` | The table type of contracts | [Tables, scopes and payers](doc:contract-tables) |
| NET | The bytes of transactions an account may send, from staking or PowerUp | [CPU and NET](doc:resources-cpu-net) |
| Notification | A copy of an action sent to another account with `require_recipient`; handled with `on_notify` | [Notifications](doc:contract-notifications) |
| ORNG | The WAX random number service, account `orng.wax` | [Random numbers](doc:contract-random) |
| `owner` | The permission that controls all others of an account | [Owner, active and permissions](doc:permissions-overview) |
| Payer | The account whose RAM holds a table row | [Tables, scopes and payers](doc:contract-tables) |
| Permission | A named authority of an account, such as `owner`, `active` or a custom one | [Custom permissions](doc:custom-permissions) |
| PowerUp | Renting CPU and NET for a day instead of staking | [PowerUp](doc:powerup) |
| Primary key | The unique 64-bit key of a table row | [Tables, scopes and payers](doc:contract-tables) |
| Private key, public key | The secret that signs, and the part that the chain stores in a permission | [The vault](doc:vault) |
| RAM | Storage on the chain for code and rows, bought and sold | [RAM](doc:resources-ram) |
| Ricardian contract | The plain-language text of an action, shown by wallets | [Ricardian contracts](doc:ricardian) |
| Scope | A group of rows inside a table, often one per account | [Tables, scopes and payers](doc:contract-tables) |
| `setcode`, `setabi` | The system actions that deploy the WASM and the ABI | [Deploy](doc:deploy) |
| Simulate | Running a transaction on a node without sending it | [Simulate and the transaction inspector](doc:simulate-inspector) |
| Singleton | A table with one row per scope, for settings | [Singletons](doc:contract-singletons) |
| Stake | Locking WAX for CPU and NET; unstaked WAX waits 3 days | [CPU and NET](doc:resources-cpu-net) |
| Symbol | A token's code and precision, for example `8,WAX` | [Assets and symbols](doc:contract-assets) |
| Table | Stored rows of a contract | [Read tables](doc:read-tables) |
| Testnet | A chain for testing; its tokens are free | [Mainnet and testnet](doc:mainnet-and-testnet) |
| Threshold, weight | How many signatures (by weight) a permission needs | [Thresholds and weights](doc:multisig-threshold) |
| Time point | A time in a contract, taken from the block | [Time](doc:contract-time) |
| Toolchain | The compiler and editor engine in the program's own WSL environment | [First start and the toolchain](doc:first-start) |
| Transaction | One or more actions signed and sent together; all succeed or none | [Run actions](doc:run-actions) |
| Vault | The encrypted file of this program that holds your keys | [The vault](doc:vault) |
| WASM | The compiled code of a contract | [Build, Output and Problems](doc:build-output-problems) |

See also [Troubleshooting](doc:troubleshooting).
