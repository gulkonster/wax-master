# Transaction history

The chain's API nodes answer questions about the present. Questions about the past (which actions an account made, what a transaction did) need a **history service**, a separate address (Hyperion) set per network. WAX Mainnet and WAX Testnet have one by default.

## How to do it here

An account's transactions:

1. Open the account on the Account page.
2. The **Transactions** section lists the latest actions: time, contract and action, data. The newest come first, 20 to a page.
3. **Older** and **Newer** move between pages. When the history service reports the number of matching actions, the page line shows "Page 2 of 7". The refresh button reads the page again.
4. To filter, fill in **Action** (an action name such as `transfer`; actions of that name on any contract are listed), **From day** and **To day** (days in your computer's time zone; either one can stay empty), and press **Filter** or Enter. **Clear** removes the filter.
5. Click a row to open the transaction in the transaction view: the same four parts as for a transaction you just sent, with the actions caused by others as a tree (see [The transaction view](doc:simulate-inspector)). A transaction you sent from WAX Master opens from its kept answer first (see below).

A transaction by its id:

1. Network > Open Transaction by Id...
2. Under the field, the list **Sent from WAX Master on** and the network name shows the latest 20 transactions you sent on the current network: the time, the contract and action (a plus sign and a number when there were more actions) and the first 8 characters of the id. Click one to open it. With none, the list says "Transactions you send from WAX Master on this network are listed here."
3. Or paste the 64-character id (for example from the Result of the Contract page or the Output line "Transaction ... sent to ...") and press **Open**.
4. The transaction opens in the transaction view.

Where an opened transaction comes from, in this order:

1. The **kept answer**: WAX Master keeps the answer the node gave for each transaction it sent and the node accepted, at most 200 per network. It has every link between the actions, and the console output when the node returned it (the WAX Testnet endpoint returns none, so a kept answer of WAX Testnet has none either). The line under the head says "From the answer the node gave when WAX Master sent it" with the time.
2. The **history service** of the network, when there is no kept answer. The line says "Read from the history service" with its address. It keeps no console output, and some links are placed by the order of execution (marked `placed by order`).

When both exist the view has a button to change: **Read from the history service** on a kept answer, **Show the node's answer** on a history answer. While it reads, the button is off.

Two messages:

- "WAX Testnet has no history service, and this transaction was not sent from WAX Master on this computer. Add a history service in Network > Manage Networks." (it starts with the name of the network). The network has no history service and no kept answer.
- "The history service does not know this transaction. One sent a moment ago can take some seconds to appear."

[Open Transaction by Id](app:open-transaction)

## Example

After the deploy in [Your first contract from zero](doc:first-contract), the Account page of your account lists `eosio` `setcode` and `eosio` `setabi`, and the `eosio` `buyrambytes` before them. Type `transfer` in **Action** and press **Filter**: only the token transfers of the account remain.

## What is needed

- A history service for the network. Without one, the Transactions section of the Account page says so (below), and Open Transaction by Id opens only the transactions WAX Master sent. Add one in Network > Manage Networks > Edit > History service. See [Endpoints](doc:endpoints).
- The local chain has no history service: its Account page says so. A transaction you sent on the local chain is opened again from its kept answer, from Network > Open Transaction by Id; New account, Give tokens and Copy contract (the account it makes and the deployment) are in that list too, but not the transactions that made the chain at Set up. Transactions that were not sent from WAX Master cannot be opened there. A Reset or Remove of the local chain deletes its kept answers. See [The local chain](doc:local-chain).
- A network without a history service: the Transactions section of its Account page says "This network has no history service. Transactions you sent from WAX Master are in Network > Open Transaction by Id."
- A moment after sending: a history service can show a new transaction a few seconds later.
- The history service lists at most the latest 10,000 matching actions of a query; it refuses pages beyond that. The list then ends with "The history service lists the latest 10,000 matching actions; set a date range to see older ones." Set **From day** and **To day** to reach older actions: each date range starts its own 10,000.
- A history service keeps what its operator decided. Very old transactions may be missing: "The history service does not know this transaction."
