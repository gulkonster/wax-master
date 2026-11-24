# Name bids (premium names)

A normal account name has exactly 12 characters. Names of 1 to 11 characters are premium names: the system contract sells them by auction. You bid on a name, other accounts can bid more, and the highest bid wins once the chain closes the auction. The winner then creates the account.

## The rules of the chain

- A name can be bid on when it has 1 to 11 characters of `a-z` and `1-5`, has no dot, and no account of that name exists.
- A 12-character name needs no bid: create it in [Create account](doc:create-account).
- A name with a dot, such as `x.name`, is never bid on: only the account after the last dot (here `name`) can create it.
- The bid is in the core token (WAX) and above zero. It is transferred from the bidder to `eosio.names` at once, with the memo `bid name <name>`.
- A later bid must be higher than the highest bid by more than a tenth. The smallest next bid is the highest bid plus a tenth of it (rounded down to the token's smallest unit) plus one unit (0.00000001 WAX). For a highest bid of 1.00000000 WAX the smallest next bid is 1.10000001 WAX.
- The highest bidder cannot bid again on the same name until another account outbids it.
- When an account is outbid, its amount is written to the `bidrefunds` table under the name. It is paid back by the action `bidrefund`, which anyone can send. **Claim refund** in this section sends it.
- The bidder pays the RAM of the auction row, and of the refund row of the account it outbids when that row is new.
- Closing: at most one auction closes per day on the whole chain. It is the open auction with the highest bid, and only once its last bid is more than 24 hours old. A lower bid waits until every higher auction has closed, so a small bid on a busy chain can wait for a long time.
- A closed auction keeps its row with the winner. The winner creates the account with `newaccount`, as the creator; the row is removed then. Nobody else can create the name.
- A winning bid is spent. A bid cannot be taken back: it comes back only when another account outbids it.

## How to do it here

Open the Account page of the account that bids, then the **Name bids** section (after **Create account**). The section is shown when the chain's system contract has the actions `bidname` and `bidrefund` and the tables `namebids` and `bidrefunds`; WAX Mainnet and WAX Testnet have them.

1. **Name**: type the name. The section checks the rule first and says what is wrong before anything is read, for example "A 12-character name needs no bid: create it in Create account." or "A name with a dot is not bid on: only the account name can create x.name."
2. Press Enter or leave the field. The section reads three things: whether an account of that name exists, the auction row of the name (`namebids`), and the refund row of this account under the name (`bidrefunds`). **Read again** reads them again, with the list of open auctions. Nothing is read on a timer.
3. The section shows what the chain says about the name:

| State | What the section shows |
|---|---|
| The account exists | "The account ... exists: a name that is taken cannot be bid on." No bid form. |
| No bid yet | "No bid on ... yet: any amount above zero opens the auction." The bid form. |
| Open | The highest bid, the highest bidder, the time of the last bid (in your computer's time), the smallest next bid, and how many open auctions have a higher bid. The bid form. |
| This account has the highest bid | The same lines; **Bid** is off with the reason. |
| Closed, won by another account | The winning bid and the winner; only the winner can create the name. |
| Closed, won by this account | "... won ...: create it in Create account." and the button **Create account ...**, which opens **Create account** with the name filled in and this account as the creator. |

4. **Bid**: choose the permission that signs and type the amount. The amount must be above zero, at least the smallest next bid and not more than the available balance. The field says what is wrong once you have left it.
5. Above the button the section always says: "The bid leaves the account now and goes to eosio.names. It comes back only when somebody outbids you, and then you claim it here. A winning bid is spent. A bid cannot be taken back." and the closing rule with the time the chain last closed an auction.
6. Press **Bid**. The auction row is read again first: if another bid came in and your amount is now too low, nothing is sent and the section says "The highest bid changed since it was read: the smallest bid is now ...". Otherwise the confirmation window shows `eosio::bidname`. The `eosio.token` transfer to `eosio.names` runs inside it.

When the read finds a refund row of this account under the name, the section shows **Your outbid amount on ...** with **Claim refund**. It sends `eosio::bidrefund`, signed by this account, and the amount comes back from `eosio.names`.

**Highest open bids** lists the first 10 open auctions, highest bid first, from a read of up to 100. Click a row to put its name into the field. It shows the price level before you bid. On WAX Testnet the list is usually empty and says so.

### Finding your old bids

The `bidrefunds` table is kept per name and has no index by bidder, so the section can show a refund only for a name you type. To find the names you bid on, open the **Transactions** section, type `bidname` in **Action** and press **Filter**. See [Transaction history](doc:transaction-history).

### On WAX Mainnet

The section reads the same on WAX Mainnet and shows the real auctions. A bid there is real WAX that cannot be taken back. Sending goes through the same confirmation as every mainnet transaction: see [The mainnet confirmation](doc:mainnet-confirmation).

## When the chain refuses

The texts of the system contract, word for word:

| The chain says | What it means |
|---|---|
| account already exists | An account of this name exists. The section says so before you bid; the account was created after the read. |
| must increase bid by 10% | The bid is not higher than the highest bid by more than a tenth. Another bid came in after the read: press **Read again**. |
| account is already highest bidder | This account has the highest bid on the name. |
| this auction has already closed | The chain closed the auction after the read. |
| insufficient bid | The amount is zero or below. |
| refund not found | There is no refund row of this account under the name: it was claimed already, or the account was never outbid on it. |
| accounts with 12 character names and no dots can be created without bidding required | The name has 12 characters: create it in Create account. |
| you can only bid on top-level suffix | The name has a dot. |
| overdrawn balance | The account has less WAX than the bid (from the `eosio.token` transfer). |

Creating a premium name in Create account can be refused with:

| The chain says | What it means |
|---|---|
| no active bid for name | Nobody has bid on the name: bid on it first. |
| only highest bidder can claim | The creator is not the winner of the auction: create it from the winning account. |
| auction for name is not closed yet | The auction is still open: wait until the chain closes it. |
| only suffix may create this account | The name has a dot; only the account after the last dot can create it. |

## Example

On WAX Testnet, open your account and the **Name bids** section. Type a name of 8 to 10 characters that nobody uses, for example `bidtest123`, and press Enter: "No bid on bidtest123 yet". Bid 1 WAX. On a second account, open the same name: the highest bid is 1.00000000 WAX and the smallest next bid 1.10000001 WAX. Bid 1.2 WAX. Back on the first account, open the name again: **Your outbid amount on bidtest123** shows 1.00000000 WAX; press **Claim refund**.

## What is needed

- Liquid WAX on the bidding account for the bid, and a little RAM for the rows.
- A key of the account in the vault.
- For the win: a little more than a day after the last bid, and no higher open auction on the chain.

> Note: The section reads the auction when you ask; it does not watch it. Press **Read again** before you decide.

See also [Accounts and names](doc:accounts-and-names), [Create an account](doc:create-account) and [The Account page as a wallet](doc:wallet-overview).
