<h1 class="clause">Blends</h1>

An account that sends AtomicAssets assets to the contract account with the memo blend: followed by a recipe id gives up those assets. When they are exactly the ingredients of the recipe, the contract burns them and mints one asset of the recipe's result template to the sender in the same transaction. Otherwise the whole transfer is refused and the assets stay with the sender. A transfer to the contract account with any other memo is refused. The contract account pays for the RAM of every asset it mints.

<h1 class="clause">Warranty</h1>

The signer of an action of this contract confirms that the action is sent on purpose and that the signer understands what it does, as stated in its Ricardian contract. This contract is an example to learn from and has not been audited.
