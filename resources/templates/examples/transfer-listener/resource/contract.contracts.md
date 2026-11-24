<h1 class="contract">withdraw</h1>

---
spec_version: "0.2.0"
title: Withdraw a Deposit
summary: '{{owner}} withdraws {{quantity}}'
---

{{owner}} agrees to take {{quantity}} out of the deposit that this contract records for {{owner}}. The contract lowers the recorded deposit by {{quantity}} and sends {{quantity}} from the contract account to {{owner}} with a transfer of eosio.token and the memo "withdraw".

When the deposit reaches zero, its row is removed. {{quantity}} may not be more than the recorded deposit.
