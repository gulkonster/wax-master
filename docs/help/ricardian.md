# Ricardian contracts

A Ricardian contract is the plain-language text of an action: what the signer agrees to when he signs it. The compiler puts these texts into the ABI. Wallets can show them before signing, and explorers show them next to the action. WAX Master shows them in the **Ricardian** section of the Contract page.

When an action has no text, the ABI generator prints a warning during the build. The contract still works; the warning says the signer gets no explanation.

## The files

Two files in the project's `resource` folder:

| File | What it holds |
|---|---|
| `<contract>.contracts.md` | One section per action |
| `<contract>.clauses.md` | Clauses for the whole contract (terms, warranty) |

A section of `.contracts.md` starts with a heading line, then a front block, then the text:

```
<h1 class="contract">hi</h1>

---
spec_version: "0.2.0"
title: Say Hello
summary: '{{user}} says hello'
---

{{user}} agrees to send a greeting to this contract. The contract checks that {{user}} signed the action and prints "Hello, {{user}}" in the action's console output.

Nothing is stored and no tokens are moved.
```

- The heading names the action exactly as in the ABI.
- `title` is a short name; `summary` is one line.
- `{{user}}` is a variable: a wallet that supports it fills in the action's parameter `user`. Every parameter of the action can be used this way.

A clause in `.clauses.md` starts with `<h1 class="clause">name</h1>` and its text.

## How to do it here

1. Open the project and press Contract > Create Ricardian Files.
2. The app builds first when the build is not up to date, then reads the actions from the ABI.
3. It adds one section for every action that has none at the end of `<contract>.contracts.md`, and writes `<contract>.clauses.md` only if it does not exist. Text that is already there is never changed. The result line says, for example, "added 3, kept 5".
4. The file opens in the editor. Replace each `TODO` with real sentences.
5. Build again. The Ricardian warnings are gone.

When Problems lists a Ricardian warning, its hint names the same command.

[Create Ricardian Files](app:create-ricardian)

## Good and bad text

| Good | Bad |
|---|---|
| "{{from}} sends {{quantity}} to {{to}}. The memo is stored in the transaction." | "Transfer." |
| Says what changes: tokens moved, rows written, RAM paid by whom | Repeats the action name |
| Short sentences a non-developer understands | Code, internal names, legal filler |
| Says what the action does not do when it matters ("No tokens are moved.") | Promises the code does not keep |

## Example

The Hello World, Token and Empty templates ship with finished Ricardian files. Create a Hello World project and open `resource/hello.contracts.md` to see a good one.

## What is needed

- A project that builds. The command reads the actions from the built ABI.
- Only a header line per action is required by the compiler; the text quality is up to you.
