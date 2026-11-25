# Troubleshooting

Find what you see in the left column of a section, then follow the fix or the linked page. Most problems show their own message: read it first, it usually names the cause.

## Building

| What you see | Usual cause | Fix |
|---|---|---|
| The build does not start; the status bar says "Toolchain not set up" | The toolchain is not installed | Help > Setup; see [First start and the toolchain](doc:first-start) |
| Builds stopped working after a Windows update | The Linux environment of the toolchain is damaged | Help > Setup > **Repair toolchain** |
| Red lines in Output | Errors in the source | Fix the **first** red line first; see [Common compiler errors](doc:compiler-errors) |
| `ABI check:` lines, Deploy stopped | A table or action uses a type the ABI does not define | [ABI check messages](doc:abi-check) |
| An action is missing from the ABI | No `[[eosio::action]]`, or the contract name in Project Settings differs from `[[eosio::contract("...")]]` | [Common compiler errors](doc:compiler-errors) |
| Ricardian warnings | Actions without plain-language text | Contract > Create Ricardian Files; see [Ricardian contracts](doc:ricardian) |

[Setup](app:setup) [Show Output](app:show-output) [Show Problems](app:show-problems)

## Deploying

| What you see | Usual cause | Fix |
|---|---|---|
| A yellow line: RAM needed and available | The account has too little RAM for the code | **Buy RAM** in the Deploy dialog; see [Deploy](doc:deploy) and [RAM](doc:resources-ram) |
| "The vault has no key for ..." | The deploy account's key is not in the vault | Import the key (Accounts > Manage Keypairs); see [The vault](doc:vault) |
| "Nothing to deploy: the account already has this build." | The same WASM and ABI are on the account | Nothing to do; change the code and build if you meant to |
| The new code reads old rows wrong | The row struct changed | [Upgrading a contract and its tables](doc:contract-upgrade) |

## Transactions

| What you see | Usual cause | Fix |
|---|---|---|
| `assertion failure with message: ...` | A `check` in the contract refused the action | The text is the contract's own message; see [Error messages](doc:contract-errors) |
| `missing authority of ...` | The action needs another signer | Set Authorization to that account; see [Actions and authority checks](doc:contract-actions-auth) |
| An error naming `eosio.code` among the provided permissions | An inline action of your contract without `eosio.code` | [The eosio.code permission](doc:eosio-code) |
| Refused for CPU or NET | Not enough staked or rented CPU or NET at this moment | Wait for it to recover, stake, or PowerUp; see [CPU and NET](doc:resources-cpu-net) and [PowerUp](doc:powerup) |
| `insufficient ram` | The RAM payer of a new row has too little RAM | [RAM](doc:resources-ram); see who pays in [Tables, scopes and payers](doc:contract-tables) |
| `unprivileged contract cannot increase RAM usage of another account within a notify context` | A transfer listener makes the user pay | Pay with `get_self()`; see [Notifications](doc:contract-notifications) |
| `unprivileged contract cannot increase RAM usage of another account that has not authorized the action` | A table row is paid by an account that did not sign the action | Pay with `get_self()` or with the signer; see [Tables, scopes and payers](doc:contract-tables) |
| Expired | The confirmation took too long | Run it again |
| The deposit to your contract is not credited | The handler is not `on_notify("eosio.token::transfer")`, or it returned early | [Notifications](doc:contract-notifications) |
| A custom permission cannot sign an action | No link from the action to the permission | [Linked actions (linkauth)](doc:linked-actions) |

**Simulate** on the Contract page shows the result of an action without sending it; the inspector shows every inline action and notification. See [Simulate and the transaction inspector](doc:simulate-inspector).

## Accounts, keys and the vault

| What you see | Fix |
|---|---|
| Forgot the vault password | **Forgot password?** on the unlock prompt: the recovery code sets a new password; see [The vault](doc:vault) |
| The Account page says **View only** | No key of the account is in the vault; **Import key**; see [The Account page as a wallet](doc:wallet-overview) |
| The faucet refuses | It limits how often it works, or the name is taken; see [Create a testnet account](doc:create-testnet-account) |
| Afraid of locking yourself out while changing a key | [Changing a key safely](doc:change-key-safely) |

## Networks and tables

| What you see | Fix |
|---|---|
| The status dot is orange or red | Hover over it for the reason; see [The status mark](doc:network-status) and [Endpoints](doc:endpoints) |
| "No rows." for a table that has rows | Another scope; many contracts use the user's account as scope; see [Read tables](doc:read-tables) |
| "This account has no contract (no ABI)" | The account has no contract on this network, or you are on another network; see [Mainnet and testnet](doc:mainnet-and-testnet) |

## NFTs, tokens and examples

The first column is the text the chain or an example contract answers with. The first six come from the contract `atomicassets`; its source is public.

| What you see | Usual cause | Fix |
|---|---|---|
| `The asset is not burnable` | The asset's template was made with `burnable` false, which is decided when the template is made | Use an asset of a template made burnable; see [AtomicAssets in short](doc:nft-atomicassets) and [Example: NFT blend](doc:example-nft-blend) |
| `At least one asset isn't transferable (ID: ...)` | The asset's template was made with `transferable` false | The asset cannot be sent or offered; see [AtomicAssets in short](doc:nft-atomicassets) |
| `Missing authorization for this collection` (seen on WAX Testnet for `mintasset`; older texts: `The minter is not authorized within the collection`, `The creator ...`, `The editor ...`) | The account that signed is not in the collection's `authorized_accounts` | Add it with `addcolauth` (signed by the collection's author), or sign with an authorized account; see [AtomicAssets in short](doc:nft-atomicassets) |
| `The template's maxsupply has already been reached` | The template has already made as many assets as its `max_supply` | Make a new template |
| `Sender doesn't own at least one of the provided assets (ID: ...)` or `No asset with this id exists for this owner` | The asset id belongs to another account, or the asset was burned or moved | Read the table `assets` of `atomicassets` with the owner as scope; see [Read tables](doc:read-tables) |
| `The transferred token is not supported` | A token was sent to `atomicassets` that it does not take (it takes only the tokens in its `config`, to back NFTs) | Do not send tokens to `atomicassets` unless you are backing an NFT; see [AtomicAssets in short](doc:nft-atomicassets) |
| `this token is not accepted here` | A contract of this program's examples refused a token from a contract it does not accept, or with another symbol or precision. This is the check against fake tokens working | Send the token the contract accepts, from its contract; see [Accepting tokens safely](doc:contract-accept-tokens) and [Example: Token payments](doc:example-payments) |
| An NFT transfer to your contract is refused with your own message | A refused notification refuses the whole transfer, so the NFT stays with its sender. That is intended in [Example: NFT staking](doc:example-nft-staking) and [Example: NFT blend](doc:example-nft-blend) | Read the message; it names the memo, the collection or the recipe that did not match |
| Minting or moving assets of a collection stops with a message of your contract | A notify account's handler of `logmint` or `logtransfer` refused, and that refuses the mint or transfer | The handler of a notify account never fails; see [AtomicAssets notifications](doc:nft-notifications) |
| The roll stays without a result and cannot be removed | The random number service has not answered yet | Wait; see [Random numbers (ORNG)](doc:contract-random) and [Example: Random number (ORNG)](doc:example-random-number) |
| Rows of a table cannot be read after a new deployment | A field was added to the row struct, so old rows are shorter than the new type | [Changing a table: what breaks and how to migrate](doc:contract-table-migration) |
| `must increase bid by 10%` | A name bid is not more than a tenth above the highest bid | Bid at least the **Smallest next bid** shown in **Name bids**; see [Name bids](doc:name-bids) |
| `account is already highest bidder` | The same account bid again while it holds the highest bid | Wait until another account bids higher; see [Name bids](doc:name-bids) |
| `refund not found` | The outbid amount was claimed already, or this account was never outbid on that name | Nothing to claim; see [Name bids](doc:name-bids) |
| `send with the memo stake` | An NFT was sent to the NFT staking example without the memo `stake` | Send again with the memo `stake`; see [Example: NFT staking](doc:example-nft-staking) |
| `the assets sent are not the ingredients of this recipe` | The assets sent to the NFT blend example are not the recipe's templates | Send exactly the recipe's templates; see [Example: NFT blend](doc:example-nft-blend) |
| `The drop has a maximum per account of 1 and this account already claimed 1` | The drop's `account_limit` is reached for this account | Another account claims; see [Drops (atomicdropsx)](doc:nft-drops) |
| `The pack has already been completed` | `addpackroll` after `completepack` | Rolls cannot change after `completepack`; announce a new pack; see [Packs (atomicpacksx)](doc:nft-packs) |
| `No unbox asset with the origin roll id 0 exists` | The pack was sent to be opened, but the random number service has not answered yet | Wait; on WAX Testnet it may not come; see [Packs (atomicpacksx)](doc:nft-packs) |
| `Native backing has been deprecated on the AtomicAssets Contract` | `backasset` on `atomicassets` 2.0.0 | Assets cannot be backed with tokens any more; see [AtomicAssets in short](doc:nft-atomicassets) |

[Contracts and services a WAX game uses](doc:wax-services) lists the contracts these messages come from.

## What is needed

- The exact message. **Show full error** in the inspector and the Output panel can both be copied into a search or a bug report.

See also the [Glossary](doc:glossary).
