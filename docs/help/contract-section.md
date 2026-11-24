# The Contract section

The Contract section of the Account page is about the code on the account: the code hash, the ABI hash and when they were last updated. You can open the account as a contract, deploy a build to it, or clear its code.

## How to do it here

1. Open the account on the Account page and choose **Contract**.
2. Read the code hash and the ABI hash. An account without code shows "no contract", one without an ABI shows "no ABI".
3. **Open as contract** opens the account on the Contract page, where you run its actions and read its tables. See [Run actions](doc:run-actions) and [Read tables](doc:read-tables).
4. **Deploy to this account...** opens the deploy dialog for the current project with this account selected. Deploy offers starred accounts only: when this account is not starred, the dialog names it and asks you to star it first, and no other account is selected. See [Deploy](doc:deploy).
5. **Clear code** sends `setcode` and `setabi` with empty content, which removes the contract. The confirmation window shows both actions and asks you to type the account name, on every network.

The permission actions (`updateauth`, `linkauth`, `unlinkauth`, `deleteauth`) are on the Contract page of `eosio`, or in the **Keys and permissions** and **Linked actions** sections. See [Owner, active and permissions](doc:permissions-overview).

## Example

On your testnet account with Hello World deployed: the section shows the code hash, the ABI hash and the date of the last update. Press **Open as contract**, run `hi`.

## What is needed

- A key of the account in an unlocked vault for Deploy and Clear code.
- The account name typed in the confirmation window: for Clear code on every network, for Deploy on mainnet.

> Note: Clearing code removes the contract. The data in its tables stays and keeps using RAM.
