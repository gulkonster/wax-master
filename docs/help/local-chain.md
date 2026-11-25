# The local chain

The local chain is a private WAX chain that WAX Master runs for you on this computer. It has the same system contract as WAX, the WAX token with 8 decimals, and the same protocol features as WAX Mainnet. It needs no Docker, no download and no terminal: everything it needs is inside the installer. Nobody else can reach it.

## When to use it instead of WAX Testnet

- No faucet limit: every account you create starts with 10,000 WAX, and Give tokens adds more.
- No waiting for public endpoints and no dependence on them. Once it is set up, it works without a network.
- A chain you can throw away: Reset makes a new empty chain in seconds.
- What a contract prints is returned, so the inspector always shows the console lines.

What it does not have:

- Other people's contracts. A fresh chain holds only the system contracts. A contract such as `atomicassets` is not there unless you copy it (see the end of this page).
- A history service. The Transactions section of an account says so; the inspector still shows every transaction you send.
- Real resource prices. RAM, CPU and NET follow the rules of WAX, but nobody competes for them.
- Real tokens. The WAX on this chain is yours alone and has no value anywhere else.

## How to do it here

### Set up

1. Open Network > Local Chain...
2. Read the text and press **Set up**. It needs about 700 MB of disk space and takes a few minutes; the lines under the button show what is done. Nothing is downloaded.
3. Wait for **Ready**. Set up is needed once.

The local chain needs WSL 2 (virtualization on). On a computer that can run only WSL 1 the dialog says so and installs nothing. The compiler works without it; the local chain does not.

[Local Chain](app:local-chain)

### Start and Stop

1. Press **Start**. The dialog shows the endpoint (`http://127.0.0.1:8888`), the chain id, the node version, the head block and the size of the data.
2. The network **Local chain** is now in the list of the Network button. Select it, or press **Select this network** in the dialog. Its status mark turns green and the Network page shows the blocks growing.
3. Press **Stop** when you are done. The node is closed cleanly in a few seconds; its accounts and contracts are kept for the next Start.

When you close WAX Master while the chain runs, the app stops it first, without a question. The chain never starts by itself unless you turn on the option below.

If port 8888 is taken by another program, the chain uses the next free one up to 8899. Its address is always `127.0.0.1`; WAX Master keeps the entry **Local chain** in the network list at that address. You cannot edit that entry: in Manage Networks its row has **Local Chain...** in place of Edit.

### New account

1. In the dialog, press **New account**.
2. Type a name (12 characters, a-z and 1-5; one is filled in at random) and pick a key from your vault. The same key serves as owner and active. Only the public key is used, so the vault can stay locked. **Manage Keypairs** makes or imports a key.
3. Press **Create**. The chain's own system account creates the account, buys 1 MiB of RAM for it, stakes 100 WAX for CPU and 100 WAX for NET, and sends it 10,000 WAX. The account is starred on the local chain and its page opens.

You sign nothing here: the system account belongs to the chain, not to you, and its key is never shown. Everything your own accounts do is signed with your keys from the vault, with the normal confirmation.

**Give tokens** (in the dialog, and in the **Local tokens** section of an account's page on the local chain) sends WAX to an existing account of the chain. The amount starts at 1,000; the most is 1,000,000 WAX.

### Deploy and try the Token template

The steps are those of [Your first contract from zero](doc:first-contract), with the local chain in place of WAX Testnet and no faucet:

1. Select **Local chain** in the Network button.
2. Make an account with **New account**.
3. File > New Project, choose **Token**, press **Create**, then **Build**.
4. Open Contract > Deploy, choose the new account and press **Deploy**. The account has RAM for the code already.
5. On the Contract page of that account run `create` (the issuer and a maximum supply such as `1000000.0000 GOLD`), then `issue` (to the issuer, with a memo), then `transfer` to a second local account. Read the tables to see the result.

See [The token contract](doc:token-contract) for what each action does.

### Seeing `print` output

Press **Open in inspector** under a result. The local chain returns what a contract prints, so **Console** under the action shows it. A public endpoint often does not.

### Reset and Remove

- **Reset** stops the node, deletes the chain's data and makes a new empty chain. The accounts and contracts on it are lost, the stars and added tokens of the network are cleared, and the chain id stays the same. A question in its own window asks first.
- **Remove** stops the node, deletes the chain and its private Linux, and takes the network out of the list. Set up makes a new one. A question asks first.

After a Reset make your accounts again. A project keeps the name of its deploy account for the local chain, so the same name can be made again.

### Options

Both are off at first, in the dialog:

- **Web pages on this computer may call the local chain**: lets a page you run on this computer (a game in development) send requests to the chain. The node restarts when you change it.
- **Start the local chain with WAX Master**: the chain starts when the app opens.

## What differs from WAX Mainnet

- One producer, `eosio`: a block every half second, made by this one node. The chain is not voted on.
- The tokens are your own: the system account holds them and hands them out as above.
- The system key belongs to this chain only. It stays inside the chain's private Linux and is never shown or sent anywhere.
- Unstaking, voting and rewards work as the node answers them, and the app shows the node's own words. Read what the chain says before you rely on a delay.

## When it does not start

The dialog shows one of these texts with its button:

- **"The chain's data was not closed cleanly and could not be repaired. Reset makes a new empty chain; the accounts and contracts on it are lost."** The app already tried once to rebuild the data from the chain's own blocks. Press **Reset**.
- **"Port 8888 is used by another program."** Press **Use port** with the next free number; the entry **Local chain** follows it.
- **"The node runs but does not answer at 127.0.0.1:8888. WSL's localhost forwarding may be switched off (`localhostForwarding` in `.wslconfig`)."** Switch it on in `%USERPROFILE%\.wslconfig` (or remove the line), run `wsl --shutdown` in a terminal and press Start again.
- **"The local chain needs WSL 2 (virtualization on). The compiler works without it; the local chain does not."** Turn virtualization on in the computer's firmware settings and set up WSL 2 (see [First start and the toolchain](doc:first-start)).

If the app was closed by force (for example in Task Manager) while the chain ran, the next Start finds the data not closed cleanly and rebuilds it as in the first text; a chain with many transactions takes longer. **Open log** shows the node's last lines (the last 2 MB are kept). The log never holds a key.

## Other people's contracts

A WAX game calls contracts such as `atomicassets`. The local chain does not have them, but WAX Master can copy one: the code and ABI are read from an account on another saved network (a read, nothing is signed there) and deployed under the same name here. Only code and ABI are copied, not the tables, so most contracts need their first action (for example `init`) run again. The code stays its author's.

1. Start the chain and press **Copy contract...** in the dialog.
2. Choose the source network (for example WAX Mainnet) and type the account, for example `atomicassets`.
3. Keep the same name here or type another, and pick a key. If the account does not exist, it is made as in New account.
4. The dialog shows the SHA-256 of the code before and after. Both must be the same. Press **Copy** and approve the confirmation.

See [AtomicAssets in short](doc:nft-atomicassets).

## Example

You set up the chain, press Start and make `alice1111111` and `bob111111111` with New account. You select Local chain, build the Token template and deploy it to `alice1111111`. You run `create` with `alice1111111` and `1000000.0000 GOLD`, then `issue` `100.0000 GOLD` to `alice1111111`, then `transfer` `10.0000 GOLD` to `bob111111111`. The inspector shows the transfers, and the table `accounts` of `bob111111111` shows `10.0000 GOLD`. Reset, and everything starts empty again.

## What is needed

- Windows with WSL 2.
- About 700 MB of free disk space for the chain, and about 1 GB of memory for its private Linux while it runs.
- The vault, for the keys of your accounts.
- To run your own node instead, see [Your own local node](doc:local-node). Networks and kinds: [Mainnet and testnet](doc:mainnet-and-testnet).
