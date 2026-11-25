# Your first contract from zero

This page takes you from nothing to a contract running on WAX Testnet: a test account from the faucet, the Hello World project, a build, RAM for the contract, the deploy, and a call of its `hi` action. Nothing here costs real money: WAX Testnet tokens have no value.

## What is needed

- The toolchain is set up (Help > Setup shows four green rows). See [First start and the toolchain](doc:first-start).
- An internet connection.
- About ten minutes.

## Step 1: choose WAX Testnet

1. Look at the **Network** button on the right of the top bar. It should read **WAX Testnet** with a green dot.
2. If it shows another network, press the arrow next to it and pick **WAX Testnet**.

If WAX Testnet is not in the list, open Network > Manage Networks and press **Restore default networks**.

## Step 2: a test account from the faucet

1. Open Accounts > Create Testnet Account. The name field already holds a random name of 12 characters; you can type your own (a-z and 1-5, exactly 12 characters).
2. Press **Create account**.
3. If you have no vault yet, the app asks for a new vault password right there (at least 6 characters, twice). A separate window then shows your **recovery code** once: save it (Save as text file or write it down), then press **I saved it**. See [The vault](doc:vault).
4. The faucet creates the account and its two keys. The keys go straight into your vault.
5. A **Back up this key** step follows for each of the two keys. Choose one of the three answers. See [Backing up keys](doc:key-backups).
6. Press **Open account**. The Account page shows the new account.
7. Press the **star** in the address field of the Account page. Deploy offers starred accounts only.

[Create Testnet Account](app:create-testnet-account)

## Step 3: the Hello World project

1. Open File > New Project.
2. Choose **Hello World**. Keep the name `hello` and choose a folder under Location.
3. Press **Create**. The project opens with `src/hello.cpp`.

The contract has one action:

```cpp
void hello::hi(name user) {
  require_auth(user);
  print("Hello, ", user);
}
```

[New Project](app:new-project)

## Step 4: build

1. Press **Build** above the file tree (or Contract > Build, or Ctrl+B). Ctrl+B works while the keyboard is in the editor or the file tree; in the Terminal it goes to the shell.
2. The Output panel shows the compiler lines and the result. Problems stays empty.

The build writes `hello.wasm` (the code) and `hello.abi` (the description of its actions and tables) into the project folder. See [Build, Output and Problems](doc:build-output-problems).

[Build](app:build)

## Step 5: deploy, and RAM

1. Open Contract > Deploy.
2. **Account** shows your starred testnet account; **Permission** is `active`.
3. The dialog compares the build with the account. A new account has no code, so WASM and ABI both say **yes** under Sent.
4. A fresh faucet account usually has too little RAM for the code. The dialog then shows a yellow line such as "RAM needed about 10,650 bytes; available 6,596 bytes." with the buttons **Buy RAM** and **Request testnet tokens**.
5. If the account has no WAX to pay for RAM, press **Request testnet tokens** first. The faucet sends free test WAX to the account.
6. Press **Buy RAM**. A small form opens with the bytes already filled in (the missing bytes plus a margin, rounded up to whole KB), the payer and the cost. Press **Buy RAM** in the form. The confirmation window opens; check it and press **Approve and send**.
7. After the purchase the dialog reads the account again ("RAM bought; the comparison was read again.") and the yellow line is gone.
8. Press **Deploy**. The confirmation window shows the account, the SHA-256 of the WASM and the ABI, and the actions `setcode` and `setabi`. Press **Approve and send**.
9. The dialog shows the transaction with status `executed`.

See [Deploy](doc:deploy) for what the dialog compares and why code needs RAM.

[Deploy](app:deploy)

## Step 6: run `hi`

1. On the Account page of your account, press the **Open as contract** button next to the address field. Or press the **Contracts** button in the top bar, type the account name and press Enter.
2. The action `hi` is selected. In the field `user`, choose your account.
3. Open **Authorization**: it should read your account with permission `active`.
4. Press **Run**. The confirmation window opens; press **Approve and send**.
5. The Result section shows the transaction id, `executed`, the block and the CPU time.
6. Press **Open in inspector**. Under the `hi` action, **Console** shows what the contract printed, when the endpoint returns it: `Hello, ` followed by your account name.
7. Many public endpoints do not return console output, the default WAX Testnet endpoint among them. Console then shows `(empty)`, and under the actions a line says "Console output was not returned by this endpoint (or the contract printed nothing)." The action still ran: `executed` in step 5 is what tells you so.

See [Run actions](doc:run-actions).

Want the same without the faucet and without waiting? The same steps work on the chain WAX Master runs on this computer: see [The local chain](doc:local-chain).

## If something goes wrong

- **Create account is disabled**: the current network is not WAX Testnet. Use the **Switch to WAX Testnet** button in the dialog.
- **The faucet refuses**: the service limits how often it creates accounts and sends tokens. Its own message is shown. Wait and try again later.
- **Deploy shows no account**: no account is starred on this network. Press **Find an account**, open your account and press the star; then press **Back to Deploy**.
- **"The vault has no key for ..."**: the account's key is not in this vault. Import it in Accounts > Manage Keypairs.
- **The build failed**: read the first red line in Output; see [Common compiler errors](doc:compiler-errors).
- **`missing authority of ...` when running `hi`**: the account in `user` and the account in Authorization must be the same.
