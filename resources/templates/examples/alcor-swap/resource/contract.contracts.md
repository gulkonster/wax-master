<h1 class="contract">swap</h1>

---
spec_version: "0.2.0"
title: Swap on Alcor
summary: 'Swap on Alcor pool {{pool_id}}'
---

The contract account agrees to send the quantity of token_in from the contract account to swap.alcor, with the memo that asks pool {{pool_id}} for at least the quantity of min_out in return. The other token is sent to the contract account. When the pool cannot give at least min_out, swap.alcor refuses it and nothing is sent.

Only the contract account can sign this action.
