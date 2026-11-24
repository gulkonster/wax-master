# Deploy

Deploying puts your contract on an account. Two system actions do it: `eosio::setcode` sends the WASM (the code the chain runs) and `eosio::setabi` sends the ABI (the description of actions and tables). After that, anyone can call the account's actions.

## How to do it here

1. Open the project and press Contract > Deploy (or the **Deploy** button above the file tree).
2. **Account**: a starred account of the current network; nothing can be typed. **Permission**: usually `active`. The last choice is remembered per project and network.
3. The dialog builds the project only if it changed since the last build ("Build is up to date (built 14:05)"), then compares the build with the account.
4. For WASM and ABI it shows the SHA-256 of this build, the hash on the account now, and **Sent**: `yes (setcode)` / `yes (setabi)`, or `unchanged`. Only what changed is sent. "Nothing to deploy: the account already has this build." means both are the same.
5. It shows the RAM needed and the RAM available.
6. Press **Deploy**. The confirmation window shows the contract account, the WASM and ABI hashes in this transaction and the code now on the account. Press **Approve and send**.

Footer buttons: **Rebuild** compiles again and compares; **Simulate Deploy** runs the deployment without sending it (see [Simulate and the transaction inspector](doc:simulate-inspector)).

Other commands in the Contract menu: **Deploy to Account...** (the same dialog, the account not saved to the project) and **Simulate Deploy**. Accounts > **Clear Contract Code...** removes code and ABI from an account; its tables stay, and the account name must be typed in the confirmation on every network.

[Deploy](app:deploy) [Deploy to Account](app:deploy-to-account)

## RAM

Code is stored in the account's RAM, and the chain counts the WASM ten times. The estimate is: WASM size x 10 + ABI size.

When the account has less RAM than needed, a yellow line shows both numbers with:

- **Buy RAM**: a form with the missing bytes filled in, a payer from your accounts and the cost from the chain's RAM market. It sends `eosio::buyrambytes` through the confirmation window. Afterwards the dialog reads the account again without building.
- **Request testnet tokens** (WAX Testnet only): free test tokens for the account, to pay for the RAM.

The warning never blocks Deploy: the chain decides.

> Note: When the account already has code, the estimate counts the whole new code, while the chain counts only the difference to the old code. The real need can then be much smaller than the estimate.

## Example

A fresh faucet account and the Hello World contract: the dialog says "RAM needed about 10,650 bytes; available 6,596 bytes." (your numbers may differ a little). Press Buy RAM, approve, then Deploy.

## What is needed

- A build without errors and without ABI faults (see [ABI check messages](doc:abi-check)).
- A starred account (see [Starred accounts](doc:starred-accounts)) whose key for the chosen permission is in your vault. If it is not, the dialog says "The vault has no key for ..."; Simulate still works.
- Enough RAM on the account.
- On a mainnet network: the account name typed in the confirmation window.

If the contract calls host functions that the network has not activated, the dialog names them: the deployment or the actions would fail there.
