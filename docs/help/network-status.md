# The status mark

The dot next to the network name tells you whether the selected network's endpoint works. It is shown in the top bar, in the network list and in the status bar. Hover over it to read why it has its colour.

## The colours

| Colour | Label | When |
|---|---|---|
| grey ring | Checking | Before the first answer |
| green | Working | The endpoint answers in time and the chain moves |
| orange | Slow or behind | Two of the last three answers took longer than 1.5 seconds, the head block did not grow, the head block time is more than 30 seconds behind this computer's clock, the irreversible block is more than 1,000 blocks behind, or the last check failed |
| red | Not reachable | Two failed checks in a row |
| red | Wrong chain | The endpoint answers for another chain id than the one saved |

## How it checks

- The app asks the current endpoint for the chain info every 10 seconds while the window is visible, and every 2 seconds while the Network page is open.
- One check gives up after 5 seconds.
- Nothing is checked while the window is minimized or hidden.

## How to do it here

1. Hover over the dot to read the reason.
2. If it is red or orange, choose another endpoint: on the Network page (API endpoint) or in Network > Manage Networks (the round buttons next to the endpoints).
3. If every endpoint is red, check your internet connection.

[Network Page](app:network-page)

## Example

The tooltip reads "Slow or behind: The head block time is 95 s behind this computer's clock (check the PC clock)". The chain is fine; the Windows clock is wrong. Set the time automatically in Windows settings.

## What is needed

Nothing; the checks run on their own. See [Endpoints](doc:endpoints) to add a second endpoint you can switch to.
