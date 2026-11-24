# Transaction history

The chain's API nodes answer questions about the present. Questions about the past (which actions an account made, what a transaction did) need a **history service**, a separate address (Hyperion) set per network. WAX Mainnet and WAX Testnet have one by default.

## How to do it here

An account's transactions:

1. Open the account on the Account page.
2. The **Transactions** section lists the latest actions: time, contract and action, data. The newest come first, 20 to a page.
3. **Older** and **Newer** move between pages. When the history service reports the number of matching actions, the page line shows "Page 2 of 7". The refresh button reads the page again.
4. To filter, fill in **Action** (an action name such as `transfer`; actions of that name on any contract are listed), **From day** and **To day** (days in your computer's time zone; either one can stay empty), and press **Filter** or Enter. **Clear** removes the filter.
5. Click a row to open the transaction in the inspector.

A transaction by its id:

1. Network > Open Transaction by Id...
2. Paste the 64-character id (for example from the Result of the Contract page or the Output line "Transaction ... sent to ...").
3. The transaction opens in the inspector with its actions.

[Open Transaction by Id](app:open-transaction)

## Example

After the deploy in [Your first contract from zero](doc:first-contract), the Account page of your account lists `eosio` `setcode` and `eosio` `setabi`, and the `eosio` `buyrambytes` before them. Type `transfer` in **Action** and press **Filter**: only the token transfers of the account remain.

## What is needed

- A history service for the network. Without one, the Account page says "This network has no history service configured" and Open Transaction by Id says so too. Add one in Network > Manage Networks > Edit > History service. See [Endpoints](doc:endpoints).
- A moment after sending: a history service can show a new transaction a few seconds later.
- The history service lists at most the latest 10,000 matching actions of a query; it refuses pages beyond that. The list then ends with "The history service lists the latest 10,000 matching actions; set a date range to see older ones." Set **From day** and **To day** to reach older actions: each date range starts its own 10,000.
- A history service keeps what its operator decided. Very old transactions may be missing: "The history service does not know this transaction."
