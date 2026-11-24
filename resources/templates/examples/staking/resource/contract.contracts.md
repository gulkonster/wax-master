<h1 class="contract">unstake</h1>

---
spec_version: "0.2.0"
title: Unstake
summary: '{{owner}} unstakes {{quantity}}'
---

{{owner}} agrees to move {{quantity}} from the amount staked in this contract to the amount waiting to be paid out. The waiting time of 5 minutes starts again from now for the whole amount that is waiting, including amounts unstaked before.

{{quantity}} may not be more than the amount {{owner}} has staked. Nothing is paid out by this action; claim pays out after the waiting time.

<h1 class="contract">claim</h1>

---
spec_version: "0.2.0"
title: Claim Unstaked Tokens
summary: '{{owner}} claims the unstaked tokens'
---

{{owner}} agrees to receive the whole amount that is waiting to be paid out, once the waiting time is over. The contract sends it from the contract account to {{owner}} with a transfer of eosio.token and the memo "claim".

When nothing stays staked, the row of {{owner}} is removed.
