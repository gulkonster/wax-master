# Transaction history

The chain's API nodes answer questions about the present. Questions about the past (which actions an account made, what a transaction did) need a **history service**, a separate address (Hyperion) set per network. WAX Mainnet and WAX Testnet have one by default.

## How to do it here

An account's transactions:

1. Open the account on the Account page.
2. The **Transactions** section lists the latest actions: time, contract and action, data. The newest come first.
3. **Load more** reads older ones. The refresh button reads the list again.
4. Click a row to open the transaction in the inspector.

A transaction by its id:

1. Network > Open Transaction by Id...
2. Paste the 64-character id (for example from the Result of the Contract page or the Output line "Transaction ... sent to ...").
3. The transaction opens in the inspector with its actions.

[Open Transaction by Id](app:open-transaction)

## Example

After the deploy in [Your first contract from zero](doc:first-contract), the Account page of your account lists `eosio` `setcode` and `eosio` `setabi`, and the `eosio` `buyrambytes` before them.

## What is needed

- A history service for the network. Without one, the Account page says "This network has no history service configured" and Open Transaction by Id says so too. Add one in Network > Manage Networks > Edit > History service. See [Endpoints](doc:endpoints).
- A moment after sending: a history service can show a new transaction a few seconds later.
- A history service keeps what its operator decided. Very old transactions may be missing: "The history service does not know this transaction."
