# Deploy

Deploying puts your contract on an account. Two system actions do it: `eosio::setcode` sends the WASM (the code the chain runs) and `eosio::setabi` sends the ABI (the description of actions and tables). After that, anyone can call the account's actions.

![The Deploy dialog: the account, what is on it now, what will be sent and the RAM it needs.](img:deploy)

## How to do it here

1. Open the project and press Contract > Deploy (or the **Deploy** button above the file tree).
2. **Account**: a starred account of the current network, chosen from the list (the Filter field narrows the list; no other name can be entered). **Permission**: usually `active`. The last choice is remembered per project and network.
3. The dialog builds the project only if it changed since the last build ("Build is up to date (built 14:05)"), then compares the build with the account. This automatic build can be switched off (see below).
4. For WASM and ABI it shows the SHA-256 of this build, the hash on the account now, and **Sent**: `yes (setcode)` / `yes (setabi)`, or `unchanged`. Only what changed is sent. "Nothing to deploy: the account already has this build." means both are the same.
5. It shows the RAM needed and the RAM available.
6. Press **Deploy**. The confirmation window shows the contract account, the WASM and ABI hashes in this transaction and the code now on the account. Press **Approve and send**.

## A big contract: two transactions

One transaction may carry at most the chain's net limit (524,288 bytes on WAX). When the code and the ABI together do not fit, the dialog says so and **Deploy** sends two transactions, each with its own confirmation: first the code (`setcode`), then the ABI (`setabi`). The dialog shows which one runs ("Transaction 1 of 2 (the code, ... bytes)"), and each confirmation lists both. If the second one is cancelled or refused, the dialog says that the code was deployed and the ABI was not; press **Deploy** again and it sends only the ABI. **Simulate Deploy** simulates both. When the code or the ABI alone is too big, the dialog says that it cannot be deployed.

## Automatic build on or off

By default Deploy builds by itself (File > Settings > Build and deploy > **Build automatically on Deploy**). The dialog says "Automatic build is on"; **Open setting** goes to the setting.

With the setting off, Deploy does not compile. It sends the WASM and ABI of the last build as they are, and says which build and from when ("Sends the testnet build from 14:05."), and when the project changed since then. A small warning "Automatic build is off" stays in the dialog; **Switch it on in Settings** goes to the setting. **Rebuild** still builds.

The rule of [Testnet and mainnet builds](doc:network-builds) stays: a testnet build is never sent to a mainnet, and a mainnet build never to a test network. When the sources use `WAXMASTER_TESTNET` or `WAXMASTER_MAINNET` and the files on disk are not the ones the last build here wrote (changed afterwards, or built elsewhere), WAX Master cannot tell which build they are, and Deploy asks for Rebuild.

Footer buttons: **Rebuild** compiles again and compares; **Simulate Deploy** runs the deployment without sending it (see [Simulate and the transaction inspector](doc:simulate-inspector)).

Other commands in the Contract menu: **Deploy to Account...** (the same dialog, the account not saved to the project) and **Simulate Deploy** (opens the Deploy dialog, where Simulate Deploy is in the footer). Accounts > **Clear Contract Code...** removes code and ABI from an account; its tables stay, and the account name must be typed in the confirmation on every network.

[Deploy](app:deploy) [Deploy to Account](app:deploy-to-account)

## RAM

Code is stored in the account's RAM, and the chain counts the WASM ten times. For a first deployment the estimate is: WASM size x 10 + ABI size.

On an account that already has code or an ABI, the chain bills only the difference, and so does the dialog: it counts 10 x (new code - code on the account) when code is sent, plus (new ABI - ABI on the account) when the ABI is sent, never below zero. The line then reads "RAM needed about N bytes more than now (new code and ABI A bytes, replacing B bytes); available M bytes."

When the size of the code on the account could not be read, the dialog counts it as zero and adds: "The size of the code now on the account could not be read; counted as a first deployment." When the account does have code, the real need is smaller than the line says.

When the account has less RAM than needed, a yellow line shows both numbers with:

- **Buy RAM**: a form with the bytes filled in (the missing bytes plus a margin of at least 2,048 bytes, rounded up to whole KB), a payer from your accounts and the cost from the chain's RAM market. It sends `eosio::buyrambytes` through the confirmation window. Afterwards the dialog reads the account again without building.
- **Request testnet tokens** (WAX Testnet only): free test tokens for the account, to pay for the RAM.

The warning never blocks Deploy: the chain decides.

## Example

A fresh faucet account and the Hello World contract: the dialog says "RAM needed about 10,650 bytes; available 6,596 bytes." (your numbers may differ a little). Press Buy RAM, approve, then Deploy.

A redeployment after a contract grew (code 15,488 to 17,525 bytes, ABI 3,310 to 4,045 bytes): "RAM needed about 21,105 bytes more than now (new code and ABI 179,295 bytes, replacing 158,190 bytes); available 15,598 bytes." Buy RAM then offers 8,192 bytes.

## What is needed

- A build without errors and without ABI faults (see [ABI check messages](doc:abi-check)).
- A starred account (see [Starred accounts](doc:starred-accounts)) whose key for the chosen permission is in your vault. If it is not, the dialog says "The vault has no key for ..."; Simulate still works.
- Enough RAM on the account.

If the contract calls host functions that the network has not activated, the dialog names them: the deployment or the actions would fail there.
