<h1 class="clause">Payments</h1>

A transfer to the contract account is recorded as a balance of the sender only when its token is on the contract's list: the token contract and the symbol with its precision must both match. Transfers of any other token are refused, and the tokens stay with the sender. Tokens that system accounts (eosio.*) send are not recorded and stay with the contract account. The contract account pays for the RAM of the list and of the balance rows.

<h1 class="clause">Warranty</h1>

The signer of an action of this contract confirms that the action is sent on purpose and that the signer understands what it does, as stated in its Ricardian contract. This contract is an example to learn from and has not been audited.
