# What WAX Master is

WAX Master is a desktop studio for smart contracts on WAX and on other Antelope chains. You write a contract, build it, deploy it to an account and call its actions, all in one window and without a terminal.

## What it does

- **Projects and editor**: C++ contract projects with an editor that knows contract code (completion, live errors, go to definition, find references, rename, formatting).
- **Build**: WAX CDT runs inside a private Linux environment (WSL) that the app sets up from files in the installer. One button or Ctrl+B.
- **Deploy**: compares the build with what is on the account, sends only what changed and estimates the RAM it needs.
- **Contracts on the chain**: run any action of any contract from a form, read its tables, simulate a transaction without sending it.
- **Accounts and keys**: an encrypted vault for your private keys, account pages with balances, resources and permissions, testnet accounts from the faucet.
- **Networks**: WAX Mainnet and WAX Testnet are in the list; you can add any Antelope chain by its API address.
- **Checked signatures**: every transaction is shown in a separate confirmation window before it is signed.

## How to do it here

1. Run Setup once so the app can build contracts. See [First start and the toolchain](doc:first-start).
2. Follow [Your first contract from zero](doc:first-contract): it goes from an empty project to a contract running on WAX Testnet.
3. Look around with [A tour of the window](doc:window-tour).

## Example

A typical session: open a project from the Home page, change a source file, press Ctrl+B, then Contract > Deploy, then open the contract on the Contract page and run one of its actions.

[Open the Setup page](app:setup)

## What is needed

- Windows 10 22H2 or Windows 11, x64.
- WSL (Windows Subsystem for Linux). The Setup page turns it on for you.
- An internet connection for chain work. Editing and building work offline.

> Note: Every transaction on WAX Mainnet goes through the red mainnet confirmation. See [The mainnet confirmation](doc:mainnet-confirmation).
