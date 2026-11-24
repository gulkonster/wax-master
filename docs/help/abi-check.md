# ABI check messages

The ABI is the JSON file that describes a contract's actions, tables and types. The chain refuses an ABI in which something names a type the ABI does not define. WAX Master reads the ABI after every successful compile and reports every such fault, so you learn it before Deploy and not from a refused transaction.

## How to do it here

1. Build (Ctrl+B).
2. If the ABI has a fault, Output shows lines starting with `ABI check:`, and Problems lists each fault with its place in your source when the app finds it.
3. Each message has three parts: what is wrong, **Why**, and **Fix**.
4. Deploy and Simulate Deploy are stopped with the same text until the fault is fixed. A WASM-only deploy (Project Settings > Deploy WASM only) is still allowed.

The ABI file itself is never changed by the app; you fix the source and build again.

## The kinds of message

| Message starts with | Meaning |
|---|---|
| `table ... uses the type ...` | A table entry without its struct |
| `action ... uses the type ...` | An action without its parameter struct |
| `action ... returns the type ...` | An action's return type is not described |
| `field ... of struct ...` | A struct field of a type the ABI lacks |
| `struct ... has the base ...` | A struct derived from a type the ABI lacks |
| `variant ... lists the type ...` | A variant with an undescribed type |
| `type ... stands for ...` | A typedef of an undescribed type |
| `the ... name ... appears more than once` | Two declarations give the same name |
| `the ABI is not valid` | The ABI cannot be read at all |

## Example

A contract that reads another contract's table, with the struct declared inside its own class:

```
ABI check: table `config` uses the type `config_row`, but the ABI does not define it. The chain refuses such an ABI, so Deploy is stopped.
```

The message names two fixes:

- **(a)** The table belongs to another contract and is only read here: move the struct and its typedef out of the contract class, for example into a namespace above the class. The compiler then leaves the table out of this ABI.
- **(b)** The table belongs to this contract: mark the struct with `[[eosio::table("config")]]`. The table and the struct are then both in the ABI.

```cpp
// (a) another contract's table, read only
namespace othercontract {
  struct config_row {
    uint64_t id;
    uint64_t primary_key() const { return id; }
  };
  typedef eosio::multi_index<"config"_n, config_row> config_table;
}
```

## What is needed

- A successful compile. The check runs only on an ABI the compiler wrote.
- At most 50 faults are explained; more are counted in one line.

See also [Build, Output and Problems](doc:build-output-problems) and [Deploy](doc:deploy).
