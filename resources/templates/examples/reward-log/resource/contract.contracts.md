<h1 class="contract">reward</h1>

---
spec_version: "0.2.0"
title: Give a Reward
summary: 'Give {{points}} points to {{player}}'
---

The contract account agrees to add {{points}} reward points to {{player}} and to announce the reward with the action logreward, which carries the reward's number and the new total of {{player}} and notifies {{player}} and every listener on the contract's list.

{{points}} must be more than zero and at most 1000000, the memo at most 256 bytes, and {{player}} an existing account. The contract account pays for the RAM of the row of {{player}}.

<h1 class="contract">logreward</h1>

---
spec_version: "0.2.0"
title: Announce a Reward
summary: 'Reward {{reward_id}}: {{points}} points to {{player}}'
---

The contract account announces that reward number {{reward_id}} gave {{points}} points to {{player}}, who now has {{total_points}} points, with the memo {{memo}}.

Only the contract account can send this action; it sends it from reward. It changes no table. {{player}} and every listener on the contract's list are notified.

<h1 class="contract">addlistener</h1>

---
spec_version: "0.2.0"
title: Add a Listener
summary: 'Notify {{account}} of every reward'
---

The contract account agrees that every logreward from now on also notifies {{account}}. If the contract of {{account}} fails when it is notified, the reward fails.

{{account}} must be an existing account other than the contract account and not already on the list. The list holds at most 5 accounts.

<h1 class="contract">rmlistener</h1>

---
spec_version: "0.2.0"
title: Remove a Listener
summary: 'Stop notifying {{account}}'
---

The contract account agrees that logreward no longer notifies {{account}}. The row of {{account}} is removed from the list.

<h1 class="contract">setsource</h1>

---
spec_version: "0.2.0"
title: Choose the Source
summary: 'Count the rewards of {{source}}'
---

The account that runs this contract as a listener agrees to count, in its table heard, the rewards that the contract {{source}} announces with logreward. Announcements of any other contract are ignored.

{{source}} must be an existing account.
