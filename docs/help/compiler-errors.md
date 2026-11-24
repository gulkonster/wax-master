# Common compiler errors

The compiler (WAX CDT, based on clang) stops at errors and goes on at warnings. Most errors in contract code come from a few causes. This page lists them with the fix.

## How to do it here

1. Build with Ctrl+B.
2. In Output, find the **first** red line. Later errors are often caused by the first one.
3. Click its `file:line:column` part to jump to the place.
4. Fix it and build again.

## Errors and fixes

| The line says | Usual cause | Fix |
|---|---|---|
| `expected ';' after expression` | A missing `;` | Add it at the end of the statement the column points to |
| `use of undeclared identifier 'x'` | A typo, or a name used before it is declared | Check the spelling; declare it first or include its header |
| `unknown type name 'asset'` (or `name`, `symbol`) | The header is missing, or the `eosio::` prefix | Add `#include <eosio/asset.hpp>` and use `eosio::asset`, or `using namespace eosio;` |
| `'eosio/....hpp' file not found` | A wrong header path | Check the spelling; your own headers belong in the `include` folder |
| `no member named 'x' in 'y'` | A field or function that the type does not have | Check the struct or class declaration |
| `no matching function for call to ...` | Wrong argument types or count | Compare with the function's declaration; the notes under the error list the candidates |
| `undefined symbol` (from the linker) | A function is declared but never defined, often an action | Write the function's body in the `.cpp` file, with the same parameters as in the header |

## Contract-specific mistakes

- **The action is not in the ABI.** The member function must be marked `[[eosio::action]]` in the class marked `[[eosio::contract("name")]]`.
- **The ABI has no actions at all.** The contract name in Project Settings (`-contract`) must be the same as the name in `[[eosio::contract("...")]]`.
- **Names.** Action and table names follow the account name rules: up to 12 characters, a-z, 1-5 and dots. `"Hello"_n` with a capital letter is refused.
- **Tables.** A struct used by `multi_index` needs `uint64_t primary_key() const`, and the struct must be marked `[[eosio::table]]` when it is this contract's table.

## Example

Header and source disagree:

```cpp
// include/hello.hpp
[[eosio::action]]
void hi(name user);

// src/hello.cpp
void hello::hi(name user, std::string text) { ... }
```

The compiler reports that `hi` does not match any declaration in `hello`. Make the two parameter lists the same.

## What is needed

- The toolchain set up. If the build does not start at all, open Help > Setup.

See also [Build, Output and Problems](doc:build-output-problems) and [ABI check messages](doc:abi-check).
