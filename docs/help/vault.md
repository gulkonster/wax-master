# The vault (password, lock, recovery code)

The vault is the encrypted file on this computer that holds your private keys. It opens with your vault password or with its recovery code, and with nothing else. Keys are decrypted only inside the app's signer, only while the vault is unlocked.

The file is `%APPDATA%\WAX Master\vault.json`.

## How to do it here

Create the vault:

1. Accounts > Create Vault... (or any action that needs a key: the app asks right there).
2. Enter a password twice. At least 6 characters. A password under 10 characters, a common one or a keyboard run gets a "Weak password" warning; you can still use it, but anyone who copies the vault file could guess it.
3. A separate window shows the **recovery code** once. Save it as a text file or write it down, keep it away from this computer, then press **I saved it**.

Unlock and lock:

- When an action needs a key and the vault is locked, the app asks for the password in place and then goes on with the action.
- Accounts > Unlock Vault... or the status bar's "Vault locked" also unlock.
- Accounts > Lock Vault or **Lock** in the status bar lock it at once.
- The vault always locks when Windows sleeps, when you lock Windows (Win+L) and when the app closes. It also locks after 5, 15 (default) or 60 minutes without use: File > Settings > Key vault. There you can also choose to lock after every signature.

[Vault: create, unlock or lock](app:vault)

## Forgot the password

1. On the unlock prompt press **Forgot password?**. A separate window opens.
2. Choose **I have the recovery code**, enter the code and a new password twice, press **Set new password**. A new recovery code is shown once; the old one stops working.
3. Without the code, choose **Reset the vault** and type `RESET`. You get an empty vault. The old file is not deleted: it is moved to `vault-old-<date>.json` in the data folder, and Import vault with the old password brings its keys back if you remember the password later.

## Password and recovery code later

In Accounts > Manage Keypairs > **Vault**:

- **Change password...**: the current password, then the new one twice. Copies of the vault you exported earlier still open with the old password.
- **New recovery code...**: the old code stops working; the new one is shown once in a separate window.
- **Remove recovery code...**: without a code a forgotten password cannot be recovered.
- **Export vault...** and **Import vault...**: see [Backing up keys](doc:key-backups).

[Manage Keypairs](app:manage-keypairs)

## Example

You come back after lunch and press Run on the Contract page. The vault locked after 15 minutes, so the app shows "Unlock the vault to go on". Enter the password: the confirmation window for your action opens next.

## What is needed

- A password of at least 6 characters; 14 or more mixed characters are rated good.
- A safe place for the recovery code, away from this computer.

> Note: The app cannot protect keys on a computer that already runs malware. Keep the owner keys of valuable accounts out of the app and use dedicated permissions for daily work.
