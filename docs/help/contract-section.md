# The Contract section

The Contract section of the Account page is about the code on the account: the code hash, the ABI hash and when they were last updated. You can open the account as a contract, deploy a build to it, or clear its code.

## How to do it here

1. Open the account on the Account page and choose **Contract**.
2. Read the code hash and the ABI hash. A hash of only zeros means the account has no code or no ABI.
3. **Open as contract** opens the account on the Contract page, where you run its actions and read its tables. See [Run actions](doc:run-actions) and [Read tables](doc:read-tables).
4. **Deploy** opens the deploy dialog for this account. See [Deploy](doc:deploy).
5. **Clear code** sends `setcode` and `setabi` with empty content, which removes the contract. The confirmation window shows both actions.

The permission actions (`updateauth`, `linkauth`, `unlinkauth`, `deleteauth`) are on the Contract page of `eosio`, or in the **Keys and permissions** and **Linked actions** sections. See [Owner, active and permissions](doc:permissions-overview).

## Example

On your testnet account with Hello World deployed: the section shows the code hash, the ABI hash and the date of the last update. Press **Open as contract**, run `hi`.

## What is needed

- A key of the account in an unlocked vault for Deploy and Clear code.
- On mainnet, the account name typed in the confirmation window.

> Note: Clearing code removes the contract. The data in its tables stays and keeps using RAM.
