# Create an account

On WAX an account is created by another account, the creator. The creator pays for the new account's RAM and can stake tokens for its CPU and NET. One transaction does all of it: `eosio::newaccount`, `eosio::buyrambytes` and, when you stake, `eosio::delegatebw`.

## How to do it here

1. Make or choose the keys first: Accounts > Manage Keypairs > **Create**. A key made here has a backup step; see [Backing up keys](doc:key-backups).
2. Open Accounts > Create Account (or Create Account... in the Account button's list).
3. **Creator (pays)** and **Permission**: an account the vault can sign for, usually with `active`.
4. **New account name**: 12 characters, a-z and 1-5. When you leave the field the app checks that the name is free on this network.
5. **Owner key** and **Active key**: pick a vault key from the list or paste a public key (`PUB_K1_...` or `EOS...`).
6. **RAM (bytes)**: 4096 by default. A new account needs some RAM for itself.
7. **Stake CPU** and **Stake NET**: tokens staked for the new account, for example `1.00000000 WAX`. Leave them at zero to stake nothing. **Transfer the staked tokens to the new account** makes the stake belong to the new account instead of the creator.
8. Press **Create** and approve in the confirmation window. The new account opens on the Account page.

If a chosen key has no backup yet, the dialog says so before it goes on; on a mainnet network it asks a blocking question.

[Create Account](app:create-account)

## Example

On WAX Testnet, with your faucet account `k3vtq2mabx41` as creator:

| Field | Value |
|---|---|
| Creator | `k3vtq2mabx41` @ `active` |
| New account name | `mydeployacct` |
| Owner key | a new vault key labelled "deploy owner" |
| Active key | a new vault key labelled "deploy active" |
| RAM | `4096` |
| Stake CPU / NET | `1.00000000 WAX` / `0.50000000 WAX` |

The confirmation shows three actions: `newaccount`, `buyrambytes` and `delegatebw`.

## What is needed

- A creator account with a key in the vault and enough tokens for the RAM and the stake.
- Two public keys (they may be the same key). Use different keys for `owner` and `active` on accounts that matter.

See also [Create a testnet account](doc:create-testnet-account) and [Accounts and names](doc:accounts-and-names).
