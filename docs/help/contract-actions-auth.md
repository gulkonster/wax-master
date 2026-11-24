# Actions and authority checks

An action is a public function of a contract: a member function marked `[[eosio::action]]`. The compiler lists it in the ABI, and anyone can send it in a transaction. The chain checks the signatures against the permissions the transaction declares; your code decides **whose** permission each action needs. An action that checks nothing can be called by anyone, for anyone.

## The checks

| Call | Passes when |
|---|---|
| `require_auth(user)` | The action declares any permission of `user` (`user@active`, `user@owner` or a custom one). Otherwise the action fails with `missing authority of user`. |
| `require_auth(permission_level{user, "claim"_n})` | The action declares exactly `user@claim`. `user@active` does not pass. |
| `has_auth(user)` | Returns true or false instead of failing, for "either this account or that one". |
| `require_auth(get_self())` | The contract account itself signed: admin actions. |
| `is_account(user)` | `user` is an existing account. Use it before you store a name or send to it. |
| `require_recipient(user)` | Not a check: sends a copy of the action to `user` (a notification, see [Notifications](doc:contract-notifications)). |

The chain checks the signatures before your code runs: a declared `user@active` is only accepted with signatures that satisfy that permission. A custom permission linked with `linkauth` can also sign the action; see [Linked actions (linkauth)](doc:linked-actions).

## Example

A complete contract with the usual cases. It compiles as it is with the bundled toolchain.

```cpp
#include <eosio/eosio.hpp>
using namespace eosio;

class [[eosio::contract("authdemo")]] authdemo : public contract {
public:
  using contract::contract;

  // Anyone may call it, but only in his own name.
  [[eosio::action]]
  void greet(name user) {
    require_auth(user);
    print("Hello, ", user);
  }

  // Only the contract account itself.
  [[eosio::action]]
  void setlimit(uint32_t limit) {
    require_auth(get_self());
    check(limit > 0, "limit must be positive");
  }

  // Only the custom permission "claim" of the user, for example one that a bot holds.
  [[eosio::action]]
  void claim(name user) {
    require_auth(permission_level{user, "claim"_n});
    print(user, " claimed");
  }

  // The user or the contract account.
  [[eosio::action]]
  void cancel(name user) {
    check(has_auth(user) || has_auth(get_self()), "only the user or the contract may cancel");
    print("cancelled for ", user);
  }

  // A copy of the action goes to the receiver, who may react to it.
  [[eosio::action]]
  void notify(name from, name to) {
    require_auth(from);
    check(is_account(to), "the receiver account does not exist");
    require_recipient(to);
  }
};
```

For `claim` to work with a key that is not the user's `active` key, the user creates the permission `claim` and links it to this action: `linkauth` with `code` = the contract account, `type` = `claim`, `requirement` = `claim`. The action is then sent with the authorization `user@claim`.

## How to do it here

1. File > New Project, then write the actions in the header (`include/`) and their bodies in `src/`, or keep them in one file as above.
2. Build (Ctrl+B). The actions appear in the ABI; a missing `[[eosio::action]]` means the action is missing too (see [Common compiler errors](doc:compiler-errors)).
3. Deploy, then open the contract on the Contract page and run each action. The **Authorization** of the form is the permission the action declares. See [Run actions](doc:run-actions).
4. Try the check: run `greet` with `user` = another account while signing with your own. The result shows `missing authority of ...`.
5. **Simulate** shows the same result without sending anything. Note that a simulation skips the signature checks of the chain, but your `require_auth` still runs.

## What is needed

- A contract account and the key of the permission that signs; see [Owner, active and permissions](doc:permissions-overview).
- For a custom permission: the permission and its link; see [Custom permissions](doc:custom-permissions) and [Linked actions (linkauth)](doc:linked-actions).

> Note: `require_auth` checks who declared the action, not who pays or who gets anything. Every action that changes somebody's data or moves somebody's tokens needs a check for that somebody.

See also [Error messages](doc:contract-errors) and [Tables, scopes and payers](doc:contract-tables).
