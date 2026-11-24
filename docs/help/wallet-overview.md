# The Account page as a wallet

The Account page shows one account's money and resources and lets you manage them here, without an explorer. You can open any account on the network. What you can do with it depends on whether the vault holds keys for it.

## How to do it here

Press the **Account** button in the top bar and choose or type an account name.

The header shows the account name, its star, its creation date and a control badge:

| Badge | Meaning |
|---|---|
| **You control: ...** | The keys in your vault are enough for the listed permissions, for example `active` and `owner`. Forms on the page can sign. |
| **View only** | No key of this account is in the vault. The page still shows everything, but nothing can be signed. The badge offers **Import key**. |

Below the header a summary band shows the totals: the total, the available (liquid) balance, the staked part (CPU and NET), tokens in a refund that is still waiting, and tokens staked to this account by others. Next to it, gauges show RAM, CPU and NET with what is used and the total.

The Tokens section lists the core token read from the chain; tokens other than the core token are listed as the history service reports them, with the contract under each name.

A list of sections sits on the left of the page. Each section is one job, for example tokens and transfers, RAM, CPU and NET, the testnet faucet on WAX Testnet, and the transactions of the account. Sections that are not ready in your version of the app are not shown.

Every form has the same shape: one sentence on what it does, its fields, the action it will send shown below the fields (as JSON and as a `cleos` line), a **?** button that opens its help page, and a button that opens the confirmation window. A signer picker lets you choose which permission signs, from those the vault can satisfy.

## View only accounts

Opening an account you do not control is safe. Every section shows its data. Every button that would sign is disabled and says why. Import a key of the account (Accounts > Manage Keypairs) and the badge changes after the page is read again.

## Example

Open your testnet account `k3vtq2mabx41`: the badge reads "You control: active, owner", the summary shows the balances and the gauges show RAM, CPU and NET. Open `eosio.token` instead: the badge reads "View only", the same data is shown and no button signs.

## What is needed

- A selected network that answers.
- For a signing form: a key of the account (or of an account it trusts) in an unlocked vault. The vault asks for its password in place when it is locked.
- On a mainnet network, the usual confirmation rules apply to every form.

> Note: The badge counts keys that are directly in the permission. Waiting times are not counted.

See also [Accounts and names](doc:accounts-and-names), [Transfers and memos](doc:transfers), [RAM](doc:resources-ram) and [CPU and NET](doc:resources-cpu-net).
