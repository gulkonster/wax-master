# Simulate and the transaction inspector

**Simulate** runs a transaction on the node without signing it and without sending it to the chain. You see what would happen: the actions, their console output, RAM changes, CPU time, or the error. The **transaction inspector** shows such a result, and the result of a real transaction, in one view.

## How to do it here

Simulate an action:

1. Fill in the action on the Contract page.
2. Press **Simulate** instead of Run. No key and no confirmation are needed.
3. Result shows "Simulation" with its status. Press **Open in inspector**.

Simulate a deployment: press **Simulate Deploy** in the Deploy dialog. Contract > Simulate Deploy opens that dialog.

The inspector shows:

| Part | What it shows |
|---|---|
| Banner | For a simulation: nothing was sent, signatures are not checked |
| Transaction, Status | The id and `executed` or `failed` |
| Network, Block / time, CPU / NET | Where it ran and what it used |
| Error | The node's error message in large text; **Show full error** opens the details |
| Resources | After a CPU, NET or RAM refusal: the account's CPU, NET and RAM now, with the short one in red |
| Actions | Every action and inline action as a tree, with its data, **Console** output and **RAM changes** |

[Simulate Deploy](app:simulate-deploy)

## Example

Before transferring a token from a new contract, simulate `transfer`. The inspector shows the action, the notifications to `from` and `to`, and the RAM change of the payer. If the result is `failed` with `symbol precision mismatch`, the quantity has the wrong number of decimals; fix it and simulate again.

## What is needed

- An endpoint that offers simulation. If it does not, the Simulate button is disabled with "This endpoint does not offer simulation"; if it cannot be told, the Result says "not verified for this endpoint". Choose another endpoint of the network (see [Endpoints](doc:endpoints)).

> Note: A simulation does not check signatures and uses the chain's state at that moment. The checks in the contract (`require_auth`) still run, so `missing authority` can appear in a simulation. Whether the declared permission may sign the action (its keys, `linkauth`) is only decided when the transaction is really sent. A real transaction can still fail, for example for a missing signature or because the state changed.

## When a real transaction is refused

- **CPU or NET**: the account has not enough staked resources at this moment. The inspector shows how much it used and has. Wait for them to recover, or stake more.
- **RAM**: the payer has too little RAM. Buy RAM on the Account page.
- **missing authority**: the action needs another signer or permission. Check Authorization.
- **expired**: the confirmation took too long; run it again.

See also [Transaction history](doc:transaction-history).
