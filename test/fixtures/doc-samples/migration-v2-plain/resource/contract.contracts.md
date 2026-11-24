<h1 class="contract">add</h1>

---
spec_version: "0.2.0"
title: Add Player
summary: 'Add the player {{user}} with the score {{score}}'
---

The contract account agrees to add a row for {{user}} with the score {{score}} to the players table, paid by the contract account. A player that exists is refused.

<h1 class="contract">setscore</h1>

---
spec_version: "0.2.0"
title: Set Score
summary: 'Set the score of {{user}} to {{score}}'
---

The contract account agrees to change the score of the player {{user}} to {{score}}.

<h1 class="contract">setlevel</h1>

---
spec_version: "0.2.0"
title: Set Level
summary: 'Set the level of {{user}} to {{level}}'
---

The contract account agrees to change the level of the player {{user}} to {{level}}.

<h1 class="contract">show</h1>

---
spec_version: "0.2.0"
title: Show Player
summary: 'Print the row of {{user}}'
---

Prints the row of the player {{user}}. Nothing is changed.
