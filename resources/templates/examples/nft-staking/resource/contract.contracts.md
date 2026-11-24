<h1 class="contract">setconfig</h1>

---
spec_version: "0.2.0"
title: Set the Collection to Stake
summary: 'Accept assets of the collection {{collection}} for staking'
---

The contract account sets the AtomicAssets collection {{collection}} whose assets can be staked from now on. Assets staked before stay staked and can still be unstaked. The contract account pays for the RAM of this row.

<h1 class="contract">unstake</h1>

---
spec_version: "0.2.0"
title: Unstake Assets
summary: '{{owner}} unstakes assets'
---

{{owner}} asks the contract to send back the assets {{asset_ids}}, at most 10 at a time. Each of them must be recorded in the contract's table as staked by {{owner}}. Their rows are removed and the contract sends all of them to {{owner}} in one atomicassets::transfer with the memo "unstake".
