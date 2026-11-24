<h1 class="contract">roll</h1>

---
spec_version: "0.2.0"
title: Roll a Die
summary: '{{player}} rolls a die'
---

{{player}} agrees to start a roll of a six-sided die. The contract stores a new roll for {{player}} with no result yet and asks the WAX random number service (orng.wax) for a random number. The result, a number from 1 to 6, is written into the roll when the service answers in a later transaction.

{{player}} pays for the RAM of the new roll. The contract account pays for the RAM of the request at orng.wax until it is answered, and the request uses the contract account's allowance at the service.
