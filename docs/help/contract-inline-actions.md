# Inline actions

An inline action is an action that your contract sends while it runs: a token transfer from the contract's account, a call to another contract, or a call to one of its own actions. It runs in the same transaction, after the current action and its notifications. If it fails, the whole transaction fails and nothing of it is kept.

## Authority

A contract holds no keys. An inline action that declares `yourcontract@active` is accepted only when `active` of the contract account lists `yourcontract@eosio.code`. Without it the transaction fails with an error saying it does not have signatures for `yourcontract@active`, and the provided permissions show `eosio.code`. Add it with one switch on the Account page; see [The eosio.code permission](doc:eosio-code).

The chain checks an inline action against `yourcontract@eosio.code` alone. The signatures of the transaction do not carry over to it, so the contract cannot act for the user who called it, unless that user's permission itself lists `yourcontract@eosio.code`. To take a user's tokens, let the user send them (see [Notifications](doc:contract-notifications)).

## Two ways to send one

| Form | When |
|---|---|
| `action(permission_level{get_self(), "active"_n}, "eosio.token"_n, "transfer"_n, std::make_tuple(...)).send();` | Any contract. The tuple must hold the parameters in the order and the types of the receiving action. |
| `using log_action = action_wrapper<"log"_n, &payout::log>;` then `log_action{get_self(), {get_self(), "active"_n}}.send(...)` | An action whose declaration you have, such as your own. The compiler checks the parameters. |

## Example

A complete contract that pays WAX from its own account and logs it with an inline call to itself.

```cpp
#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>
using namespace eosio;

class [[eosio::contract("payout")]] payout : public contract {
public:
  using contract::contract;

  [[eosio::action]]
  void pay(name to, asset quantity, std::string memo) {
    require_auth(get_self());
    check(is_account(to), "the receiver account does not exist");
    check(quantity.symbol == symbol("WAX", 8), "only WAX can be paid");
    check(quantity.amount > 0, "the quantity must be positive");

    // 1. A transfer by eosio.token, signed by this contract's active permission.
    action(
      permission_level{get_self(), "active"_n},
      "eosio.token"_n,
      "transfer"_n,
      std::make_tuple(get_self(), to, quantity, memo)
    ).send();

    // 2. An action of this contract, with the parameters checked by the compiler.
    log_action log{get_self(), {get_self(), "active"_n}};
    log.send(to, quantity);
  }

  [[eosio::action]]
  void log(name to, asset quantity) {
    require_auth(get_self());
    print("paid ", quantity, " to ", to);
  }

  using log_action = action_wrapper<"log"_n, &payout::log>;
};
```

The inline actions run in the order they were sent, after `pay` has finished. The transaction trace shows them under `pay`.

## How to do it here

1. Build and deploy the contract to its account, for example `mypayout1111`.
2. Account page > `mypayout1111` > **Keys and permissions**: switch on **Allow this account's contract to send actions (eosio.code)** on `active`. See [The eosio.code permission](doc:eosio-code).
3. Send some WAX to `mypayout1111` so it has something to pay. See [Transfers and memos](doc:transfers).
4. On the Contract page run `pay` with Authorization = `mypayout1111@active`.
5. Open in inspector: the trace shows `pay`, then `eosio.token::transfer` with its notifications, then `log` with its console line.

## What is needed

- `yourcontract@eosio.code` on the permission the inline action declares.
- The resources of the whole transaction: CPU and NET, inline actions included, are billed to the first signer of the transaction (the first authorization of its first action), not to the contract.

> Note: The receiving contract runs the inline action exactly as if it were sent by `yourcontract`. A failing inline action reverts the whole transaction, including the rows the calling action wrote.

> Note: Deferred transactions (`eosio::transaction` with `send`) are deprecated on Antelope chains such as WAX. Do not build on them; let a user or a service send a later action instead.

See also [Actions and authority checks](doc:contract-actions-auth) and [Error messages](doc:contract-errors).
