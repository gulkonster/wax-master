# The transaction view: Actions, Traces, RAM Deltas, Raw

**Simulate** runs a transaction on the node without signing it and without sending it to the chain. The **transaction view** shows such a result, the result of a transaction you just sent, and a transaction you open later, always in the same four parts: **Actions**, **Traces**, **RAM Deltas** and **Raw**. It is the view of an explorer page, inside the app.

## How to do it here

Simulate an action:

1. Fill in the action on the Contract page.
2. Press **Simulate** instead of Run. No key and no confirmation are needed.
3. Result shows "Simulation" with its status. Press **Open in inspector**.

Simulate a deployment: press **Simulate Deploy** in the Deploy dialog. Contract > Simulate Deploy opens that dialog.

Look at a transaction you sent: the view opens after the send. A transaction sent earlier, or by someone else, opens from Network > Open Transaction by Id (see [Transaction history](doc:transaction-history)).

Above the four parts the view shows:

| Part | What it shows |
|---|---|
| Banner | For a simulation: nothing was sent, signatures are not checked |
| Transaction, Status | The id (with a **Copy** button) and `executed` or `failed` |
| Network, Block / time, CPU / NET | Where it ran and what it used |
| Finality | Only for a transaction read from the history service: `irreversible`, or `not yet irreversible` |
| Source line | Only for a transaction opened later: where the data comes from (see "Where the data comes from") |
| Error | The node's error message in large text; **Show full error** opens the details |
| Resources | After a CPU, NET or RAM refusal: the account's CPU, NET and RAM now, with the short one in red |

Under them are the four tabs. The view opens on **Traces**; the tab you choose is kept while that window stays open, and the left and right arrow keys move between the tabs.

[Simulate Deploy](app:simulate-deploy)

## The four parts

### Actions

The actions of the transaction as it was signed, numbered from 1: the contract and action, the authorization, and the decoded data (with a switch to the raw hex). When the transaction caused more, the last line says so, for example "This transaction caused 1 inline action and 2 notifications. They are in Traces." If the node returned no trace, the part says "The node returned no action trace."

### Traces

Every execution as a tree. An entry shows its contract and action, the authorization, the first 100 characters of its data and, when the node gave it, the time it took. Entries that were caused by another entry stand indented under it, so which action triggered which can be read without opening anything. The line above the tree says "Indented entries were caused by the entry above them."

How to read the tree:

- An **action** of the transaction stands at the top. Under it come its notifications and its inline actions, in the order the chain ran them.
- A **notification** has the badge `notification to <account>`. It is the same action, delivered to another account because the contract called `require_recipient`; if that account has a handler, what the handler does stands under it.
- An **inline action** has the badge `inline`. It is an action the contract sent while it ran. A **log action** is an inline action of the contract to itself that only announces what happened; the accounts that should hear of it are notified under it. See [Example: Reward log](doc:example-reward-log).
- The arrow at the left of an entry opens its details: Input (with a `raw hex` switch), Console, RAM changes, Return value (hex) and **Copy data**. The details of the actions of the transaction and of a failed entry are open at the start.
- **Expand all** and **Collapse all** open or close the details of every entry. The field "Filter: contract, action or receiver" dims the entries that do not match; none is removed, so the tree stays whole.

Where a new NFT's id is found: a `mintasset` of `atomicassets` has a `logmint` under it. Open its details: the Input has the `asset_id`. See [AtomicAssets notifications](doc:nft-notifications).

### RAM Deltas

First the totals, one row per account: `+219 bytes` (in red) when the account holds more RAM, `-219 bytes` (in green) when RAM was freed. Then every single change: the account, the bytes, and the trace it happened in. A click on the trace opens it in Traces. When nothing was reported the part says "No RAM change was reported for this transaction."; when the source gave no figures at all, "RAM changes were not returned by this endpoint."

### Raw

The answers as they were received, each in its own block with a title and a **Copy** button: `Node answer` (a simulation, a transaction you sent, a kept answer), `History service answer` (a transaction read from the history service) and, when it could be read, `Transaction in its block`: the signed transaction as the chain holds it. A text over 2,000,000 characters is shown in part, with the line "Shown in part: the first 2,000,000 characters."

## Where the data comes from

| Source | What is different |
|---|---|
| Simulation | The node ran it without signatures; the banner says so. |
| Just sent | The node's answer to your send. |
| The node's kept answer | WAX Master keeps the node's answer of each transaction it sent. Opened later, it shows what the answer held: every link between the actions, and the console output when the node returned it (an endpoint that returns no console, such as WAX Testnet's, leaves it empty in the kept answer too). The source line says "From the answer the node gave when WAX Master sent it" with the time. The button **Read from the history service** reads the same transaction from the service instead. |
| The history service | The service keeps no console output: Console reads "(not kept by the history service)". It joins identical actions and does not always say which action caused another. An entry placed by the order of execution carries the mark `placed by order`, and a line under the tree says how many; the mark has a tooltip that explains it. Finality is shown. When the answer joined identical actions, RAM Deltas says "The history service joined identical actions; their RAM changes may be listed once." The service may also leave out a RAM change that a notified account's handler made (seen on WAX Testnet: a listener's new table row is in the node's answer, not in the service's). If the node's answer was kept, the button **Show the node's answer** goes back to it. |

For a transaction read from the history service, WAX Master makes two more reads at the same time: the history service's per-trace read, which gives the RAM change of each single trace, and the block that holds the transaction, which gives the `Transaction in its block` part of Raw and fills CPU, NET and the status when the history answer had none. If one of them fails, its part says "not returned by this endpoint" and nothing else changes.

## Example

Before transferring a token from a new contract, simulate `transfer`. In **Traces** you see the action, the notifications to `from` and `to` under it, and in **RAM Deltas** the change of the payer. If the result is `failed` with `symbol precision mismatch`, the quantity has the wrong number of decimals; fix it and simulate again.

## What is needed

- An endpoint that offers simulation. If it does not, the Simulate button is disabled with "This endpoint does not offer simulation"; if it cannot be told, the Result says "not verified for this endpoint". Choose another endpoint of the network (see [Endpoints](doc:endpoints)).
- For a transaction opened by its id: the kept answer, or a history service (see [Transaction history](doc:transaction-history)).

> Note: A simulation does not check signatures and uses the chain's state at that moment. The checks in the contract (`require_auth`) still run, so `missing authority` can appear in a simulation. Whether the declared permission may sign the action (its keys, `linkauth`) is only decided when the transaction is really sent. A real transaction can still fail, for example for a missing signature or because the state changed.

## When a real transaction is refused

- **CPU or NET**: the account has not enough staked resources at this moment. The view shows how much it used and has. Wait for them to recover, or stake more.
- **RAM**: the payer has too little RAM. Buy RAM on the Account page.
- **missing authority**: the action needs another signer or permission. Check Authorization.
- **expired**: the confirmation took too long; run it again.

See also [Transaction history](doc:transaction-history).
