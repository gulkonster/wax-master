<h1 class="contract">move</h1>

---
spec_version: "0.2.0"
title: Move Rows
summary: 'Move up to {{max_rows}} rows to the new table'
---

The contract account agrees to move at most {{max_rows}} rows from the table players to the table players2. Each moved row is erased from players.

<h1 class="contract">add</h1>

---
spec_version: "0.2.0"
title: Add Player
summary: 'Add the player {{user}} with the score {{score}}'
---

The contract account agrees to add a row for {{user}} with the score {{score}} to the table players2, paid by the contract account. A player that exists, or that is still in the table players, is refused.

<h1 class="contract">setscore</h1>

---
spec_version: "0.2.0"
title: Set Score
summary: 'Set the score of {{user}} to {{score}}'
---

The contract account agrees to change the score of the player {{user}} to {{score}}.

<h1 class="contract">show</h1>

---
spec_version: "0.2.0"
title: Show Player
summary: 'Print the row of {{user}}'
---

Prints the row of the player {{user}}. Nothing is changed.
