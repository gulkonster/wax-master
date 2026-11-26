# The Account page as a wallet

The Account page shows one account's money and resources and lets you manage them here, without an explorer. You can open any account on the network. What you can do with it depends on whether the vault holds keys for it.

![The Account page: balances and resources at the top, the wallet sections below.](img:account-page)

## How to do it here

Press the **Account** button in the top bar and choose or type an account name.

The header shows the account name, its creation date and a control badge. The star for the account is in the address bar, next to the name field.

| Badge | Meaning |
|---|---|
| **You control: ...** | The keys in your vault are enough for the listed permissions, for example `active` and `owner`. Forms on the page can sign. |
| **View only** | No key of this account is in the vault. The page still shows everything, but nothing can be signed. The badge offers **Import key**. |

Below the header a summary band shows the totals: the total, the available (liquid) balance, the staked part (CPU and NET), tokens in a refund that is still waiting, and tokens staked to this account by others. Next to it, gauges show RAM, CPU and NET with what is used and the total.

The Tokens section lists the core token read from the chain, the tokens the history service reports for the account, and tokens you add with **Add token** (by contract and symbol; an added token is listed for every account on that network). The contract is shown under each name.

A list of sections sits on the left of the page. Each section is one job:

| Section | What it does |
|---|---|
| Tokens, Transfer | Balances of the core token and other tokens; send tokens. See [Transfers and memos](doc:transfers). |
| RAM | Buy and sell RAM. See [RAM](doc:resources-ram). |
| CPU / NET | Stake, unstake, claim a refund. See [CPU and NET](doc:resources-cpu-net). |
| Keys and permissions, Linked actions | Keys, thresholds, custom permissions, `eosio.code`, `linkauth`. See [Owner, active and permissions](doc:permissions-overview). |
| Contract | Code and ABI hashes, deploy, clear code. See [The Contract section](doc:contract-section). |
| Create account | A new account paid by this one. See [Create an account](doc:create-account). |
| Name bids | Bid on a premium name of 1 to 11 characters, see its auction, claim an outbid amount back, create a won name. Shown when the chain's system contract has name bids. See [Name bids (premium names)](doc:name-bids). |
| Voting and rewards | Vote for producers or a proxy, claim rewards. Shown when the chain offers voting. See [Voting and rewards](doc:voting-rewards). |
| PowerUp | Rent CPU and NET for a day. Shown when the chain has the PowerUp market. See [PowerUp](doc:powerup). |
| Testnet faucet | Free test tokens, on WAX Testnet only. |
| Transactions | The account's actions, with filters and pages. See [Transaction history](doc:transaction-history). |

A section is left out when the chain does not offer what it needs.

Sections with more than one form show one form at a time, chosen by a switch (for example **Buy | Sell** in RAM).

Every section has the same shape: one sentence on what it does, a **?** button that opens its help page, and its forms. A form has its fields, a permission picker for the signer, a button that opens the confirmation window, and a **Command** button that shows the action it will send (as JSON, packed hex and a `cleos` line).

## View only accounts

Opening an account you do not control is safe. Every section shows its data. Every button that would sign is disabled and says why. Import a key of the account (Accounts > Manage Keypairs) and the page reads the account again; the badge changes.

## Example

Open your testnet account `k3vtq2mabx41`: the badge reads "You control: active, owner", the summary shows the balances and the gauges show RAM, CPU and NET. Open `eosio.token` instead: the badge reads "View only", the same data is shown and no button signs.

## What is needed

- A selected network that answers.
- For a signing form: a key of the account in an unlocked vault. The vault asks for its password in place when it is locked.
- On a mainnet network, the usual confirmation rules apply to every form.

> Note: The badge counts keys that are directly in the permission. Waiting times are not counted.

See also [Accounts and names](doc:accounts-and-names), [Transfers and memos](doc:transfers), [RAM](doc:resources-ram) and [CPU and NET](doc:resources-cpu-net).
