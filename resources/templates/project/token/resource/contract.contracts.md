<h1 class="contract">create</h1>

---
spec_version: "0.2.0"
title: Create a Token
summary: 'Create a token with a maximum supply of {{maximum_supply}}, issued by {{issuer}}'
---

The contract account agrees to create a new token with a maximum supply of {{maximum_supply}}. Only {{issuer}} may issue it.

The contract account pays for the RAM that stores the token's supply and issuer.

<h1 class="contract">issue</h1>

---
spec_version: "0.2.0"
title: Issue Tokens
summary: 'Issue {{quantity}} to {{to}}'
---

{{to}} agrees to issue {{quantity}} into circulation and to receive them in its own balance. {{to}} must be the issuer of the token, and the total supply may not go above the maximum supply.

The memo is: {{memo}}

If {{to}} has no balance row for this token, {{to}} pays for the RAM of a new one.

<h1 class="contract">retire</h1>

---
spec_version: "0.2.0"
title: Retire Tokens
summary: 'Remove {{quantity}} from circulation'
---

The issuer of the token agrees to remove {{quantity}} from its own balance and from the supply in circulation.

The memo is: {{memo}}

If the issuer's balance reaches zero, its balance row is removed and its RAM goes back to whoever paid for it.

<h1 class="contract">transfer</h1>

---
spec_version: "0.2.0"
title: Transfer Tokens
summary: 'Send {{quantity}} from {{from}} to {{to}}'
---

{{from}} agrees to send {{quantity}} to {{to}}.

The memo is: {{memo}}

If {{to}} has no balance row for this token, a new one is created. {{to}} pays for its RAM if {{to}} also signed this transaction, otherwise {{from}} pays.

If the balance of {{from}} reaches zero, its balance row is removed and its RAM goes back to whoever paid for it.

<h1 class="contract">transfers</h1>

<!--
---
spec_version: "0.2.0"
title: Transfer Several Tokens
summary: 'Send several tokens from {{from}} to {{to}} in one action'
---

{{from}} agrees to send each of these amounts to {{to}} in one action: {{quantities}}.

The memo is: {{memo}}

For each token, if {{to}} has no balance row for it, a new one is created. {{to}} pays for its RAM if {{to}} also signed this transaction, otherwise {{from}} pays.

For each token, if the balance of {{from}} reaches zero, its balance row is removed and its RAM goes back to whoever paid for it.

Contracts that credit deposits listen for the transfer action only and will not credit tokens sent with this action.
-->

<!-- The transfers action is off by default; the header says why. To enable it, remove the two comment lines around its text above and this note, then the comment lines around transfers in the header and in the source. -->

<h1 class="contract">open</h1>

---
spec_version: "0.2.0"
title: Open a Token Balance
summary: 'Open a zero balance of {{symbol}} for {{owner}}, paid by {{ram_payer}}'
---

{{ram_payer}} agrees to create a zero balance row of {{symbol}} for {{owner}} and to pay for its RAM.

Nothing happens if {{owner}} already has a balance row for this token. A row opened at zero stays until it has held tokens and is emptied again; it is then removed like any other.

<h1 class="contract">close</h1>

---
spec_version: "0.2.0"
title: Close a Token Balance
summary: 'Close the zero balance of {{symbol}} of {{owner}}'
---

{{owner}} agrees to remove its zero balance row of {{symbol}}. The RAM of the row goes back to whoever paid for it.

The balance must be zero. A row that was already removed when its balance reached zero cannot be closed again.
