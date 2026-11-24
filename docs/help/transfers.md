# Transfers and memos

A transfer moves tokens from one account to another. It is the `transfer` action of the token's contract: `eosio.token` for WAX, another contract for other tokens. The memo is a free text of up to 256 bytes that travels with the transfer; exchanges and contracts often use it to know whose deposit it is.

## How to do it here

The easiest way is the Tokens and Transfer sections of the Account page:

1. Open the Account page of the sending account. Its badge must read "You control: ...".
2. In **Tokens** press **Transfer** on the row of the token you want to send, or open the **Transfer** section.
3. **From**: the signer, an account and permission the vault can sign for.
4. **To**: the recipient. The app checks that the account exists on this network; if it does not, nothing is signed and the form says so.
5. **Amount**: the number, with the token's precision (WAX has 8 decimals). The form shows the symbol and the balance read from the chain. Use a point for the decimals and no thousands separators: `1.5` is one and a half; `1,5` and `1,000` are refused.
6. **Memo**: free text, or what the recipient asked for.
7. Check the action shown below the fields (JSON and `cleos` line) and approve in the confirmation window.

An account that is shown as view only cannot send; its Transfer buttons are disabled.

## Tokens with the same name

Anyone can create a token with any name and send it to any account, so the token list may show names you did not ask for. The contract under the name tells which token it is: the real WAX is the one of `eosio.token`, marked **core token**. A token with the network's symbol on another contract is marked as not being it and is listed last. For every token other than the core token the Transfer form says which contract it calls.

You can also send a transfer from the Contract page with the action `transfer` of the token's contract. The fields are the same:

| Field | What to enter |
|---|---|
| `from` | Your account |
| `to` | The recipient |
| `quantity` | Amount and symbol with all decimals, for example `1.00000000 WAX` |
| `memo` | Free text, or what the recipient asked for |

On the Contract page, **Authorization** must be your account, usually with `active`, and the same recipient check runs before the confirmation.

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

See also [The Account page as a wallet](doc:wallet-overview), [The token contract](doc:token-contract) and [Run actions](doc:run-actions).
