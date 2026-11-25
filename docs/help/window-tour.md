# A tour of the window

The window has a menu bar, a top bar with four buttons, the page in the middle, a bottom panel and a status bar. This page names each part and what it is for.

## Menu bar

| Menu | What is in it |
|---|---|
| File | New Project, Open Project, New from Template, files, Save, Home, Settings |
| Edit | Undo, copy and paste, Find, Replace, Find in Files, Format Document, Rename Symbol, Go to Definition |
| View | Command Palette, font size, Terminal, Output, Problems, Outline |
| Contract | Project Settings, Build, Deploy, Deploy to Account, Simulate Deploy, Create Ricardian Files |
| Accounts | Create Account, Create Testnet Account, Manage Keypairs, the vault item, Clear Contract Code |
| Network | the network list, Add Network, Manage Networks, Network Page, Open Transaction by Id |
| Help | Documentation, Project Page, Ask a Question, Report an Issue, Request a Feature, Setup, Check for Updates, Verify This Download, About WAX Master |

The vault item of the Accounts menu changes with the vault: **Create Vault...**, **Unlock Vault...** or **Lock Vault**.

## Top bar

- **Current Project**: opens the project; its arrow lists your projects, Create Project and Open Project.
- **Contracts**: opens the Contract page with the last contract; its arrow lists your starred accounts.
- **Account**: opens the Account page with the last account; its arrow has Create Account and your starred accounts.
- **Network**: opens the Network page; its arrow lists the networks with their kind, Add Network, Manage Networks and Network Page. The dot shows whether the network answers (see [The status mark](doc:network-status)).

## Pages

- **Home**: your projects (Local and Starred tabs), New and Open.
- **Project**: file tree on the left with New File, Build, Deploy and Project Settings buttons; the editor on the right.
- **Contract page**: run actions and read tables of any contract. See [Run actions](doc:run-actions) and [Read tables](doc:read-tables).
- **Account page**: balances, resources, permission keys and transactions of any account. See [Accounts and names](doc:accounts-and-names).
- **Network page**: the state of the chain. See [The Network page](doc:network-page).
- **Settings** (File > Settings) and **Setup** (Help > Setup).

## Bottom panel

Three tabs: **Terminal** (PowerShell, Command Prompt or the toolchain's Linux shell), **Output** (build and transaction lines) and **Problems** (the editor's live errors and the last build's, in one list; see [The editor](doc:editor)). Ctrl+` opens it on the Terminal tab or closes it; the panel button in the status bar opens or closes it too.

## Status bar

From left to right: the vault state (click to unlock or to open Manage Keypairs), **Lock** while the vault is open, the network and endpoint with its status dot (click to manage networks), the toolchain of the project (click to choose another), the editor engine state (`C++: ready`; see [The editor](doc:editor)), the cursor place, the error and warning counts (click for Problems) and the panel button.

## Example

With a project open, press Ctrl+Shift+P to find a command by name: type a part of it, for example `deploy`.

[Show Command Palette](app:command-palette)

## What is needed

Nothing. Dialogs can be resized from their lower right corner; the size is remembered, and a double click on the corner restores the default. The theme (System, Dark, Light) is in File > Settings > Appearance.

[Open Settings](app:settings)
