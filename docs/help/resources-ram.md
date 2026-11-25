# RAM

RAM is the storage of an account on the chain: the code of a contract, its table rows and the account's own data. It is not rented by time. You buy it for WAX, you keep it, and you can sell it back.

## Who pays

Whoever sends the buy action pays the WAX, and the RAM goes to the receiver. Payer and receiver can be the same account or two accounts. A creator pays for the RAM of a new account this way; see [Create an account](doc:create-account).

## How to do it here

Open the Account page, then the RAM section. It shows the RAM used and the total, and the current price per KB. The switch **Buy | Sell** chooses the form. The Buy form buys RAM for this account.

- **By bytes**: enter the number of bytes. The form shows the cost estimated from the chain's RAM market. It sends `eosio::buyrambytes`.
- **By amount**: enter the amount to spend, for example `1.00000000`. The form shows the bytes you get. It sends `eosio::buyram`.
- **Sell**: enter the bytes to sell. Only RAM the account does not use can be sold, and the form keeps back 512 bytes of it: the sale itself uses some RAM, and a node refuses a sale of every unused byte. The form shows the most you can sell and the WAX you get. It sends `eosio::sellram`.

To buy, choose the payer and its permission in **Paid by**; to sell, choose the permission of this account. Press **Command** to see the action, then approve in the confirmation window. The balance and the gauges are read again right after the transaction is sent, and twice more a few seconds later.

## The price

The price comes from the chain's system RAM market, a pool of RAM and WAX. The more RAM you buy, the higher the price per byte. A fee of 0.5% is taken on buying and on selling, so selling right after buying returns a little less than you paid. The numbers shown are estimates; the chain decides the exact result when the transaction runs. The Network page also shows the price of 1 KB.

## Why deploys need RAM

A contract is stored in its account's RAM. The chain counts the WASM about ten times, so a deploy needs roughly ten times the code size plus the ABI. The Deploy dialog shows the estimate and offers to buy the missing bytes; see [Deploy](doc:deploy).

## Example

An account has 6,596 bytes free and a deploy needs about 10,650. Buy 4,096 bytes with the account as payer: the form shows the cost, you approve, and the Deploy dialog then sees enough RAM.

## What is needed

- A payer with enough liquid WAX, and a key for the payer in the vault. On WAX Testnet you can ask the faucet for free test tokens.
- A chain that has the system RAM market. Without it the section says why, the price reads "not available", and no buy or sell form is shown.

> Note: Sold RAM is paid out at the market price at that moment, which can be lower than the price you bought at.

See also [The Account page as a wallet](doc:wallet-overview), [CPU and NET](doc:resources-cpu-net) and [The Network page](doc:network-page).
