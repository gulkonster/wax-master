# Error messages

A contract refuses an action with `check(condition, "message")`: when the condition is false, the action stops and the **whole transaction** is reverted. No row it wrote stays, no token moves, no inline action runs, and the transaction never enters a block. The sender sees the message as `assertion failure with message: ...`.

## Writing good checks

- Check first, change later: all `check` calls at the top of the action, before the first `emplace`, `modify` or inline action. The result is the same either way, but the action is easier to read and stops sooner.
- Say what is wrong and what is expected: `"the quantity must be positive"`, not `"error 7"` or `"bad input"`.
- A message is built every time the line runs, even when the check passes. A message joined from strings costs CPU on every call; build it only when the check fails, as in the example.
- `check(condition, code)` with a number gives `assertion failure with error code: <code>` instead, for programs that read the code.
- `eosio_assert` is the old name; use `check`.

## Example

A complete contract with a plain message and a message built only on failure.

```cpp
#include <eosio/eosio.hpp>
using namespace eosio;

class [[eosio::contract("errors")]] errors : public contract {
public:
  using contract::contract;

  [[eosio::action]]
  void setage(name user, uint32_t age) {
    require_auth(user);
    check(age >= 18, "the age must be 18 or more");
    if (age > 150) {
      check(false, "the age " + std::to_string(age) + " is above 150");
    }
    print(user, " is ", age);
  }
};
```

Run `setage` with `age` = `12`: the result shows `assertion failure with message: the age must be 18 or more`.

## Messages you will meet

| Message contains | Where it comes from | What to do |
|---|---|---|
| `assertion failure with message: ...` | A `check` in a contract | Read the text: it is the contract's own message |
| `missing authority of <account>` | `require_auth` | Sign with that account; see [Actions and authority checks](doc:contract-actions-auth) |
| `does not have signatures for it` ... `eosio.code` | An inline action without `eosio.code` | [The eosio.code permission](doc:eosio-code) |
| `unprivileged contract cannot increase RAM usage of another account within a notify context` | A row paid by another account in `on_notify` | Pay with `get_self()`; see [Notifications](doc:contract-notifications) |
| `unprivileged contract cannot increase RAM usage of another account that has not authorized the action` | A row paid by an account that did not authorize the action | Pay with `get_self()` or with an account in `require_auth`; see [Tables, scopes and payers](doc:contract-tables) |
| `unable to find key` | `get` or `require_find` without own message | Give a message, or use `find` and check for `end()` |
| `singleton does not exist` | `get()` of an empty singleton | `get_or_default()`; see [Singletons](doc:contract-singletons) |
| `cannot create objects in table of another contract` | `emplace` on a table opened with another contract | Tables of other contracts are read only; see [Reading another contract's table](doc:contract-read-other-table) |
| `updater cannot change primary key when modifying an object` | `modify` changed the key field | Erase the row and emplace a new one |
| `attempt to add asset with different symbol` | Asset arithmetic | Check the symbol first; see [Assets and symbols](doc:contract-assets) |
| `insufficient ram` | The RAM payer has too little RAM | Buy RAM; see [RAM](doc:resources-ram) |

## How to do it here

1. On the Contract page press **Simulate** instead of Run. The result shows the message without signing or sending anything.
2. **Open in inspector** shows the trace and the console output of the actions that ran before the failure. `print` output is the quickest way to see values while you test; see [Simulate and the transaction inspector](doc:simulate-inspector).
3. A transaction refused for CPU, NET, RAM, a missing signature or an expired time is not a contract error; the inspector shows which, see the end of [Simulate and the transaction inspector](doc:simulate-inspector).

## What is needed

- Nothing more than a deployed contract. Simulate needs no key.

> Note: `print` output is not stored on the chain. Use it to test, not to report results; store results in a table instead.

See also [Common compiler errors](doc:compiler-errors) for errors of the build, and [Troubleshooting](doc:troubleshooting).
