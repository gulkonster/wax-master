# Starred accounts

A star marks an account you work with. Stars are kept per network. Starred accounts appear first in every account list of the app, and the places that change a contract account accept a starred account only, so a typing mistake cannot deploy to the wrong account.

## Where stars are used

| Place | Uses |
|---|---|
| Deploy, Deploy to Account, Simulate Deploy | Starred accounts only; the Filter field narrows the list, no other name can be entered |
| Clear Contract Code | Starred accounts only |
| Project Settings > Deploy to | Starred accounts of each network |
| Contracts and Account buttons in the top bar | The list under the arrow |
| Signer and account fields of forms | Starred accounts first, then accounts of vault keys |

## How to do it here

Star an account:

1. Open it on the Account page (or the Contract page).
2. Press the **star** in the address field. Press it again to unstar.

Manage the list:

1. Press the arrow of the Account or Contracts button and choose **All Starred Accounts...**.
2. Type a name and press **Add**, move rows with **Up** and **Down**, or press **Remove**.

When a dialog needs a starred account and there is none, it says "Star an account first" with a **Find an account** button. It opens the Account page with the search field ready. After you star the account, a green line offers **Back to** the dialog you came from.

## Example

You deploy the same contract to `mytestcontr1` on WAX Testnet and to `mycontract11` on WAX Mainnet. Star each on its network. Deploy then preselects the right one when you switch networks, and Project Settings keeps one deploy account per network.

## What is needed

- A network selected. Stars of a network are forgotten when the network is removed (the removal question lists them).
