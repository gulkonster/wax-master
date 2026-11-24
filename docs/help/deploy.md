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

Other commands in the Contract menu: **Deploy to Account...** (the same dialog, the account not saved to the project) and **Simulate Deploy** (opens the Deploy dialog, where Simulate Deploy is in the footer). Accounts > **Clear Contract Code...** removes code and ABI from an account; its tables stay, and the account name must be typed in the confirmation on every network.

[Deploy](app:deploy) [Deploy to Account](app:deploy-to-account)

## RAM

Code is stored in the account's RAM, and the chain counts the WASM ten times. For a first deployment the estimate is: WASM size x 10 + ABI size.

On an account that already has code or an ABI, the chain bills only the difference, and so does the dialog: it counts 10 x (new code - code on the account) when code is sent, plus (new ABI - ABI on the account) when the ABI is sent, never below zero. The line then reads "RAM needed about N bytes more than now (new code and ABI A bytes, replacing B bytes); available M bytes."

When the size of the code on the account could not be read, the dialog counts it as zero and adds: "The size of the code now on the account could not be read; counted as a first deployment." When the account does have code, the real need is smaller than the line says.

When the account has less RAM than needed, a yellow line shows both numbers with:

- **Buy RAM**: a form with the missing bytes filled in, a payer from your accounts and the cost from the chain's RAM market. It sends `eosio::buyrambytes` through the confirmation window. Afterwards the dialog reads the account again without building.
- **Request testnet tokens** (WAX Testnet only): free test tokens for the account, to pay for the RAM.

The warning never blocks Deploy: the chain decides.

## Example

A fresh faucet account and the Hello World contract: the dialog says "RAM needed about 10,650 bytes; available 6,596 bytes." (your numbers may differ a little). Press Buy RAM, approve, then Deploy.

A redeployment after a contract grew (code 15,488 to 17,525 bytes, ABI 3,310 to 4,045 bytes): "RAM needed about 21,105 bytes more than now (new code and ABI 179,295 bytes, replacing 158,190 bytes); available 15,598 bytes." Buy RAM then offers 8,192 bytes.

## What is needed

- A build without errors and without ABI faults (see [ABI check messages](doc:abi-check)).
- A starred account (see [Starred accounts](doc:starred-accounts)) whose key for the chosen permission is in your vault. If it is not, the dialog says "The vault has no key for ..."; Simulate still works.
- Enough RAM on the account.
- On a mainnet network: the account name typed in the confirmation window.

If the contract calls host functions that the network has not activated, the dialog names them: the deployment or the actions would fail there.
