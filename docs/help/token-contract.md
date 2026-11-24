# The token contract

The **Token** template is a standard token contract, the same interface as `eosio.token`: wallets, explorers and exchanges read it unchanged. One deployed token contract can hold many tokens, each with its own symbol.

## Actions

| Action | Signed by | What it does |
|---|---|---|
| `create(issuer, maximum_supply)` | the contract account | Creates a token, for example `1000000.0000 WMT`, with its issuer and maximum supply. The precision is set here. |
| `issue(to, quantity, memo)` | the issuer | Creates new tokens on the issuer's balance; `to` must be the issuer |
| `transfer(from, to, quantity, memo)` | `from` | Moves tokens; refuses a transfer to self and a recipient that does not exist |
| `retire(quantity, memo)` | the issuer | Removes tokens of the issuer from the supply |
| `open(owner, symbol, ram_payer)` | `ram_payer` | Creates a zero balance row for `owner` |
| `close(owner, symbol)` | `owner` | Removes a zero balance row |

## Tables

| Table | Scope | Row |
|---|---|---|
| `stat` | the symbol code, for example `WMT` | supply, max_supply, issuer |
| `accounts` | the holder's account name | balance |

## The zero-balance rule

In this template a balance row is erased as soon as it reaches zero. That gives the row's RAM (about 240 bytes) back to whoever paid for it. Rules that follow:

- A missing row means a zero balance.
- The next transfer to that account creates the row again; the receiver pays if he signed, otherwise the sender pays.
- `open` and `close` keep their standard form. A row opened at zero stays until it has held tokens and is emptied.
- `retire` of the issuer's whole balance erases the issuer's row; `issue` creates it again.

## `transfers` (off by default)

The source carries a commented-out action `transfers(from, to, quantities, memo)` that sends several tokens of this contract to one account in one action. It is off because contracts that credit deposits listen for the `transfer` notification and will not credit a `transfers` notification. Enable it only for transfers between accounts or to contracts written for it. The comments in the header, the source and the Ricardian file say which lines to remove.

## How to do it here

1. File > New Project > **Token**. Name it, for example `mytoken`.
2. Build (Ctrl+B) and deploy it to a starred testnet account. The code needs about 180,000 bytes of RAM; the Deploy dialog offers Buy RAM. See [Deploy](doc:deploy).
3. On the Contract page open the contract account and run, signed by the contract account: `create` with `issuer` = your account and `maximum_supply` = `1000000.0000 WMT`.
4. Run `issue` signed by the issuer: `to` = the issuer, `quantity` = `1000.0000 WMT`.
5. Run `transfer` to send some to another account.
6. Read the balances: table `accounts` with scope = the holder's name. See [Read tables](doc:read-tables).

[Token project](app:template-token)

## Example

After issuing 1000 and transferring all of it away, a query of `accounts` with scope = the issuer shows **No rows.** The issuer's RAM usage dropped by about 240 bytes. Transfer 50 back and the row is there again.

## What is needed

- A testnet account for the contract with enough RAM (Buy RAM in the Deploy dialog).
- A symbol of 1 to 7 capital letters and a precision you will not change: the precision is fixed by `create`.
