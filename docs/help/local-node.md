# Your own local node

A local node is a chain that runs on your own computer. You start it yourself and WAX Master connects to it like to any other network. It is useful when you want a chain nobody else uses: no faucet limit, no waiting for public endpoints, and a chain you can throw away. A node started with `--contracts-console` also returns what a contract prints, and the transaction inspector shows it.

## How to do it here

1. Start your node so that it listens on `127.0.0.1`. The WAX documentation describes a Docker image for this; any `nodeos` works too. One example command line, without any key:

   `nodeos -e -p eosio --plugin eosio::producer_plugin --plugin eosio::chain_api_plugin --plugin eosio::http_plugin --http-server-address=127.0.0.1:8888 --contracts-console`

   Your node's own documentation tells you the remaining options, such as where the data is kept and how the producer signs.
2. In WAX Master choose Network > Add Network... and type `http://127.0.0.1:8888`. Use `127.0.0.1`, not `localhost`. Press **Connect**.
3. The app reads the chain id. The kind is already **Local**: normal confirmation, no typed names. Check the name and press **Add**.
4. When the chain has no system contract, the app cannot read the core token from it. Type the core token symbol (and its precision) yourself.
5. Import the keys of your node's accounts in Manage Keypairs, so that the app can sign for them.

[Add Network](app:add-network) [Manage Keypairs](app:manage-keypairs)

## What does not work on a bare node

- Without the system contract (`eosio.system`), the Create Account, RAM, CPU and NET pages cannot do their work. The node refuses the actions, and the app shows its refusal.
- Without a history service, the Transactions list of an account says that the network has no history service. See [Endpoints](doc:endpoints).
- The network page of a chain you started yourself shows only what your node answers.

## Example

You started a node on port 8888 and created the account `alice` with your node's own tools. In Add Network you connect `http://127.0.0.1:8888`, accept the kind Local, and type `WAX` as the symbol with precision 8. After you import the key of `alice`, a transfer from `alice` is signed with the normal confirmation.

## What is needed

- A node that listens on `127.0.0.1`. The app accepts `http://` only for an address on this computer. See [Mainnet and testnet](doc:mainnet-and-testnet).
- The private keys of your node's accounts, imported by you. This page never shows a key and you never paste one into a file.
- See also [Add and remove networks](doc:add-remove-networks).
