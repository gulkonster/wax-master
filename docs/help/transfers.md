# Transfers and memos

A transfer moves tokens from one account to another. It is the `transfer` action of the token's contract: `eosio.token` for WAX, another contract for other tokens. The memo is a free text of up to 256 bytes that travels with the transfer; exchanges and contracts often use it to know whose deposit it is.

## How to do it here

Transfers are sent from the Contract page today:

1. Press the **Contracts** button in the top bar, type `eosio.token` (or the contract of the token) and press Enter.
2. Choose the action `transfer`.
3. Fill in the fields (see the table below).
4. **Authorization** must be your account, usually with `active`.
5. Press **Run** and check the confirmation window, then **Approve and send**.

| Field | What to enter |
|---|---|
| `from` | Your account |
| `to` | The recipient |
| `quantity` | Amount and symbol with all decimals, for example `1.00000000 WAX` |
| `memo` | Free text, or what the recipient asked for |

Before the confirmation, the app checks that the recipient exists on this network. If it does not, nothing is signed and the Result says so.

## Example

Send 1 test WAX on WAX Testnet:

```json
{
  "from": "k3vtq2mabx41",
  "to": "mydeployacct",
  "quantity": "1.00000000 WAX",
  "memo": "first test"
}
```

The **Command** button above the fields shows the same action as JSON, as packed hex and as a `cleos` line you can copy.

## What is needed

- A key of the sending account in your vault.
- The exact precision of the token: WAX has 8 decimals, so `1 WAX` is refused; write `1.00000000 WAX`.
- The right memo when sending to an exchange. A deposit without the memo it asked for may be lost or need manual work by the exchange.

> Note: A transfer cannot be undone. Check the recipient and the memo in the confirmation window.

See also [The token contract](doc:token-contract) and [Run actions](doc:run-actions).
