# The mainnet confirmation

Nothing is signed without the confirmation window. It is a separate window, opened by the part of the app that holds the keys, and it shows exactly what will be signed and where it will be sent. On a mainnet network its header is orange and says "MAINNET (real value)".

![The confirmation window for a transfer on a test network: where it goes, who signs, and every action with its data. On a mainnet the header is orange.](img:confirm)

## What the window shows

| Row | Meaning |
|---|---|
| Header | The title and the network; orange with "MAINNET (real value)" on mainnet |
| Build | For a deploy of a project: the testnet build, the mainnet build, or one build for every network (see [Testnet and mainnet builds](doc:network-builds)) |
| Network, Chain id, Endpoint | Where the transaction goes |
| Signed by | Each account@permission and the vault key that signs (label and the start and end of the public key) |
| Contract account, WASM, ABI, Code now on account | For a deploy: the hashes of the code in this transaction and of the code on the account now |
| Actions | Each action with its contract, name, signers and data; **Show packed data** shows the bytes |
| Transaction id, Expires | The id of this exact transaction and the time left |

## How to do it here

1. Read the window from top to bottom. Check the network, the account, the amounts and the recipient.
2. Press **Approve and send** (one click, it works at once), or **Cancel**: nothing is signed then.

## Example

A deploy of `mycontract11` on WAX Mainnet: the header is orange, the window shows "Build: Mainnet build", the SHA-256 of the WASM and ABI you built and the code hash on the account now. One click on Approve and send signs and sends it.

## What is needed

- The vault unlocked (the app asks in place).
- Time: the window expires after at most two minutes; start again if it does.
- Only one confirmation at a time; "Another confirmation is open" means approve or cancel the first.

## Rules behind it

- The signer signs exactly the bytes shown and sends them only to the endpoint shown. An approval is used once.
- A network counts as mainnet unless it is WAX Testnet, a chain you confirmed as a test network, or a chain on this computer. See [Mainnet and testnet](doc:mainnet-and-testnet).
