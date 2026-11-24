<h1 class="contract">setrecipe</h1>

---
spec_version: "0.2.0"
title: Add a Recipe
summary: 'Add blend recipe {{id}} of the collection {{collection}}'
---

The contract account adds recipe {{id}}: the assets of the AtomicAssets collection {{collection}} with the ingredient templates {{ingredients}} can be blended into one asset of template {{result_template}} of the schema {{result_schema}}. Every ingredient template must be burnable. The contract account pays for the RAM of the recipe row.

<h1 class="contract">delrecipe</h1>

---
spec_version: "0.2.0"
title: Remove a Recipe
summary: 'Remove blend recipe {{id}}'
---

The contract account removes recipe {{id}}. Assets sent with the memo for this recipe are refused from now on. The RAM of the row goes back to the contract account.
