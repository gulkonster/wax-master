<h1 class="contract">setconfig</h1>

---
spec_version: "0.2.0"
title: Set the Template to Mint
summary: 'Mint from template {{template_id}} of the collection {{collection}}'
---

The contract account sets the AtomicAssets collection {{collection}}, the schema {{schema}} and the template {{template_id}} that mint uses from now on. The count of received assets is kept. The contract account pays for the RAM of this row.

<h1 class="contract">mint</h1>

---
spec_version: "0.2.0"
title: Mint One Asset
summary: '{{owner}} mints one asset'
---

{{owner}} asks the contract to mint one asset of the configured template to {{owner}} with atomicassets::mintasset. Each account can mint once: {{owner}} pays for the RAM of the row that records the mint, and the row stays. The contract account pays for the RAM of the asset.

The template's maximum supply limits how many assets can be minted in all.
