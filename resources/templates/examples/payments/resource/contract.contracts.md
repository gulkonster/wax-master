<h1 class="contract">addtoken</h1>

---
spec_version: "0.2.0"
title: Accept a Token
summary: 'Accept {{sym}} of {{token_contract}}'
---

The contract account agrees that transfers of the token {{sym}} issued by the contract {{token_contract}} are accepted from now on and recorded as balances of their senders.

{{token_contract}} must have a token with the symbol {{sym}}, with the same precision. Only one contract can be accepted for a symbol code; tokens with that code from any other contract are refused.

<h1 class="contract">deltoken</h1>

---
spec_version: "0.2.0"
title: Stop Accepting a Token
summary: 'Stop accepting {{code}}'
---

The contract account agrees that transfers of tokens with the symbol code {{code}} are refused from now on.

Balances of {{code}} that were already recorded stay, and their owners can still withdraw them.

<h1 class="contract">withdraw</h1>

---
spec_version: "0.2.0"
title: Withdraw a Balance
summary: '{{owner}} withdraws {{quantity}}'
---

{{owner}} agrees to take {{quantity}} out of the balance that this contract records for {{owner}}. The contract lowers the recorded balance by {{quantity}} and sends {{quantity}} from the contract account to {{owner}} with a transfer of the token contract recorded with the balance, with the memo "withdraw".

When the balance reaches zero, its row is removed. {{quantity}} must be positive and may not be more than the recorded balance.
