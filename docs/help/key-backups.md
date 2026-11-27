# Backing up keys

A key made in WAX Master exists only in your vault. If the vault file is lost, or you lose both the password and the recovery code, the key is gone and so is control of every account it signs for. Nobody can restore it. A backup is a second copy kept somewhere else.

## Backup state

Manage Keypairs shows a yellow **No backup** tag on every key that exists only in this vault, and a banner with the count. A key loses the tag when it is saved to a backup file, shown for writing down, included in an exported vault file, or was imported (a copy exists where it came from).

## How to do it here

After Create Keypair (and after Create Testnet Account) a **Back up this key** step says that the key is not backed up yet and offers two ways to back it up. Nothing is forced: **Close** (or Escape) leaves the key without a backup, and it keeps its **No backup** tag until you back it up later.

1. **Save a backup file...**: a separate window asks for the vault password again and warns that the file holds the private key as readable text. Choose where to save it. The app never replaces an existing file. A folder synced to a cloud service (OneDrive, Dropbox and the like) copies the file there too, so prefer a folder that is not synced.
2. **Show the key so I can write it down**: the private key is shown in a separate window after the password.

Later, in Accounts > Manage Keypairs:

- **Back up** on a key's row: the same backup file as above.
- **Show private key**: the key in a separate window after the password; it hides after 30 seconds.
- **Back up...** in the banner: Export vault for all keys at once, or one key at a time.
- **Delete...** in a key's menu removes the key from the vault. With **Ask to type a word before deleting** on (File > Settings > Key vault, the default), type `delete` (the copy button next to the word copies it) and **Delete key** deletes at once; with it off, a normal question asks first.
- **Vault > Export vault...**: one encrypted file with every key. It opens with the vault password or the recovery code. **Vault > Import vault...** reads such a file back (password or recovery code of that file).

[Manage Keypairs](app:manage-keypairs)

## Example

You created a deploy key on WAX Testnet and closed the backup step. Manage Keypairs shows "1 key exists only in this vault." Press **Back up...**, then **Export vault...**, and save the file to a USB stick. The tag disappears.

## What is needed

- The vault password (every backup asks for it again).
- A place away from this computer: a USB stick, paper in a safe place. A plain-text backup file is readable by anyone who finds it; move it off this computer and delete the copy here.

> Note: A copied private key stays in Windows clipboard history (Win+V) if you use it. The app clears only the normal clipboard, after 30 seconds.
