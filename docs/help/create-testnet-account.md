# Create a testnet account

WAX Testnet is a copy of WAX where tokens have no value. Its faucet, a free service at `faucet.waxsweden.org`, creates test accounts and sends test tokens. WAX Master asks the faucet for you and puts the new account's keys straight into your vault.

## How to do it here

1. Select WAX Testnet in the Network button. On another network the dialog shows a **Switch to WAX Testnet** button.
2. Open Accounts > Create Testnet Account.
3. The **Account name** field holds a random name. Keep it or type your own: exactly 12 characters, a-z and 1-5.
4. Press **Create account**. If the vault is locked or does not exist, the password is asked right there.
5. The faucet creates the account with an owner key and an active key. Both are stored in your vault.
6. A **Back up this key** step follows for each key. See [Backing up keys](doc:key-backups).
7. **Request test tokens** asks the faucet for test WAX for the new account. **Open account** opens it on the Account page.

To get test tokens for an account you already have: type its name in the field and press **Request tokens**, or use **Request testnet tokens** on its Account page under Resources.

[Create Testnet Account](app:create-testnet-account)

## Example

Name `k3vtq2mabx41` (any free name works). After Create account the dialog says the account was created and its owner and active keys are in your vault. Request test tokens, open the account, press the star: it is now offered by Deploy. See [Your first contract from zero](doc:first-contract).

## What is needed

- WAX Testnet in the network list (Network > Manage Networks > Restore default networks brings it back).
- An internet connection to the faucet.

> Note: The faucet service made these keys and has seen them. Use such an account for testing only. To own it alone, replace both keys with keys made in your vault (Account page > Permission Keys > Change key...).

## When it fails

- The faucet limits how often it creates accounts and sends tokens. Its own message is shown as it came; wait and try again.
- A name that is taken is refused by the faucet. Use another name.
- An existing testnet account can create more accounts with Accounts > Create Account. See [Create an account](doc:create-account).
