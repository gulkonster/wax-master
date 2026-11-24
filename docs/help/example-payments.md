# Example: Token payments

A contract that takes payments in more than one token and refuses look-alikes. It keeps a list of accepted tokens; each one is a token contract and a symbol with its precision. Tokens on the list that are sent to the contract account are recorded per sender and token, and `withdraw` sends them back. Everything else is refused, also a token called `WAX` that `eosio.token` did not issue. That is the scam this example exists to stop: anyone can create a token called `WAX` on his own contract, and a contract that checks only the symbol credits it as real WAX.

The project is in File > New Project > **Examples** > **Token payments**. Its `README.md` has the same steps as this page. The rules behind it are on [Accepting tokens safely](doc:contract-accept-tokens).

> Note: The example is there to learn from. It is not audited; do not hold real value with it unchanged.

## How it works

The list is the table `tokens`. The contract account fills it with `addtoken`, which first reads the token's own `stat` table, so a token that does not exist, or a precision that differs from the token contract's, is refused before it is on the list:

```cpp
token::stats stats(token_contract, sym.code().raw());
const auto& st = stats.get(sym.code().raw(), "this contract has no token with this symbol");
check(st.supply.symbol == sym, "the token has another precision on its contract");
```

The handler listens to the `transfer` of every contract:

```cpp
[[eosio::on_notify("*::transfer")]]
void on_transfer(name from, name to, asset quantity, std::string memo);
```

- With `"*::transfer"` any contract that names this account in a `transfer` reaches the handler, a fake token contract included. `get_first_receiver()` says which contract it was: the contract whose `transfer` is running, the one that issued the token. The symbol in the data is only what that contract wrote.
- The handler compares the pair, contract and symbol with its precision, with the list. When it is not there, `check` refuses the whole transfer, so the tokens stay with the sender:

```cpp
check(t != tokens.end() &&
        extended_symbol(t->sym, t->token_contract) == extended_symbol(quantity.symbol, get_first_receiver()),
      "this token is not accepted here");
```

- Only then are the amount's checks worth anything: `quantity.is_valid()` and `quantity.amount > 0`. An accepted token contract checks them as well; the contract checks them again so that its balances do not depend on another contract.
- It returns at once for the contract's own outgoing transfers (`from` is the contract), for a notification another account passed on with `require_recipient` (`to` is not the contract) and for payments from system accounts (`eosio.*`).
- In a notification only the contract can pay for a new row, so the contract account needs RAM for the rows.

`withdraw(owner, quantity)` checks that `owner` signed and has enough, lowers the row (or removes it at zero), and sends the tokens with an inline `transfer` of the token contract recorded in the row. The caller never names the contract: if he could, he would name a contract of his own that pays nothing.

```cpp
action(permission_level{get_self(), "active"_n}, token_contract, "transfer"_n,
       std::make_tuple(get_self(), owner, quantity, std::string("withdraw")))
  .send();
```

The contract signs this transfer with its own `active` permission, so `active` needs `<contract>@eosio.code`; see [The eosio.code permission](doc:eosio-code).

| Table | Scope | Fields |
|---|---|---|
| `tokens` | the contract account | `token_contract`, `sym` |
| `balances` | the owner's account | `token_contract`, `balance` |

## How to do it here

You need four accounts: the contract account, a user account, a token account for a second real token, and a fake token account for a token that only looks like WAX.

1. File > New Project. Under **Examples** choose **Token payments**, keep the name `payments`, choose the location and press **Create**.
2. Contract > Build (Ctrl+B). The Output ends with no errors and no warnings.
3. Select WAX Testnet with the Network button. Accounts > Create Testnet Account: create the contract account, press **Request test tokens**, then **Open account** and press the star. Do this before anything is deployed: after deployment a payment to the contract account goes through its contract (see "What goes wrong"). The faucet limits how often it creates accounts and sends tokens, and shows its own message when it refuses. The user account is an account you already have or one made from the contract account: on its Account page, section **Create account**, with some **Stake CPU** and **Stake NET** (for example `1.00000000 WAX` each). Send it 2 WAX from the contract account (section **Transfer**) if it has none. If **Request test tokens** is refused, send WAX to the contract account from an account you have (its Account page, section **Transfer**) before deploying.
4. Contract > Deploy. **Account**: the contract account, **Permission**: `active`. If the dialog says RAM is missing, press **Buy RAM** and approve, then press **Deploy** and approve.
5. The contract account pays for the rows: about 250 bytes for the first token of an account, about 140 for each further token, about 130 for each token on the list. Open **RAM** on its Account page: when fewer than 2,048 bytes are free, buy 2048 bytes (**By bytes**).
6. On the contract account's Account page open **Keys and permissions**. On `active` use the switch **Allow this account's contract to send actions (eosio.code)**, press **Send to confirmation** and approve.
7. Press **Contracts** in the top bar and open the contract account. Choose the action `addtoken`: `token_contract` = `eosio.token`, `sym` = `8,WAX`. **Authorization**: the contract account with `active`. Press **Run** and approve. Pick the table `tokens` and press **Run query**: one row.
8. Open the user account on the Account page, section **Transfer**. **To**: the contract account, **Amount**: `1`, any memo. Press **Transfer** and approve.
9. On the contract's Contract page pick the table `balances`, **Scope** = the user account, and press **Run query**: one row, `token_contract` = `eosio.token`, `balance` = `1.00000000 WAX`.
10. A second real token. On the user account's Account page, section **Create account**, make the token account with some **Stake CPU** and **Stake NET**, and send it WAX for the RAM of a token contract (about 160,000 bytes; the Deploy dialog shows the price). File > New Project > **Token**, name it `paytoken`, build it, and deploy it to the token account (Contract > Deploy, **Buy RAM** if the dialog asks). See [The token contract](doc:token-contract).
11. On the token account's Contract page run `create`: `issuer` = the user account, `maximum_supply` = `1000000.0000 WMT`, **Authorization**: the token account. Then `issue`: `to` = the user account, `quantity` = `100.0000 WMT`, any memo, **Authorization**: the user account.
12. On the contract's Contract page run `addtoken`: `token_contract` = the token account, `sym` = `4,WMT`, **Authorization**: the contract account.
13. On the token account's Contract page run `transfer`: `from` = the user account, `to` = the contract account, `quantity` = `10.0000 WMT`, any memo, **Authorization**: the user account. Query `balances` with **Scope** = the user account again: two rows, the WAX row and `10.0000 WMT` with `token_contract` = the token account.
14. The fake. Make the fake token account as in step 10 and deploy the same `paytoken` project to it (Contract > Deploy, **Account**: the fake token account). On its Contract page run `create`: `issuer` = the user account, `maximum_supply` = `1000000.00000000 WAX` (8 decimals, as the real WAX), then `issue`: `to` = the user account, `quantity` = `100.00000000 WAX`, **Authorization**: the user account. The user account now holds two tokens called WAX. Its **Tokens** list marks a WAX of another contract as not the network's WAX when it shows one.
15. On the fake token account's Contract page run `transfer`: `from` = the user account, `to` = the contract account, `quantity` = `1.00000000 WAX`, **Authorization**: the user account. It is refused with "this token is not accepted here": the fake WAX stays with the user account and `balances` is unchanged.
16. On the contract's Contract page run `withdraw`: `owner` = the user account, `quantity` = `1.00000000 WAX`, **Authorization**: the user account. Then `withdraw` with `10.0000 WMT`. The query of `balances` now shows no rows; the user account's **Transactions** show two transfers with the memo `withdraw`, one of `eosio.token` and one of the token account.

## What is needed

- A WAX Testnet account for the contract, with RAM for the code and for the rows (steps 4 and 5).
- `eosio.code` on its `active` (step 6), or `withdraw` is refused with an error that names `eosio.code`.
- A user account with test WAX, and two more accounts with WAX for the RAM of a token contract each.

## What goes wrong, and why

| What you see | Why |
|---|---|
| "this token is not accepted here" | The token is not on the list (step 7 or 12 is missing), or it is the same symbol from another contract (step 15), or the precision differs. |
| "this contract has no token with this symbol" | `addtoken` named a token contract that has not run `create` for that symbol code (step 11), or the wrong account. |
| "the token has another precision on its contract" | `sym` in `addtoken` has the wrong number of decimals, for example `4,WAX`. |
| `withdraw` refused, the error names `eosio.code` | Step 6 is missing. |
| The transfer to the contract is refused with a RAM error | The contract account needs more RAM for the new row (step 5). |
| "the quantity is more than the balance" | `withdraw` asked for more than the row holds. |
| **Request test tokens** after deployment is refused, or `faucet.wax` has a row in `balances` | Before step 7 every WAX transfer to the contract is refused; after it a plain transfer is recorded as a balance of the sender. Fund the contract account before deploying (step 3). |
| An NFT sent to the contract account is refused | The handler also runs for `atomicassets::transfer`, whose data is not a token transfer. This contract does not take NFTs. |

## Before you build on it

- The balances and the contract account's own tokens are one balance. The table is the only record of whose tokens they are, so whoever holds the contract account's keys, or deploys new code to it, controls all of it.
- The same keys decide the list. An `addtoken` with a wrong contract makes a worthless token count as real. Check the contract name of every token before you add it, for example on the token's own site or in a block explorer.
- The contract pays the RAM of one row per account and token: about 140 bytes, an account's first row about 250. It takes any amount, so tiny payments from many accounts can use up its RAM. A real contract sets a smallest amount per token.
- The memo is not read. A shop that ties a payment to an order reads the memo and checks it: the order exists, the amount is its price, it is not paid yet.

See also [Example: Transfer listener](doc:example-transfer-listener), which accepts WAX only.
