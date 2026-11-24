# Read tables

A contract keeps its data in tables. Each table is split into **scopes**: one table name can hold many separate groups of rows, for example one group per account. A query reads the rows of one table in one scope. Reading needs no key and costs nothing.

## How to do it here

1. Open the contract on the Contract page. The tables are on the right half.
2. Choose the table in the list (**Pick a table**). The list shows each table's row type.
3. Fill in the query (see the table below), or keep the defaults.
4. Press **Run query**. The rows appear as a table with one column per field. **Load More** reads the next rows.

| Field | Default | Meaning |
|---|---|---|
| Scope | the contract account | Which group of rows |
| Lower bound | 0 | First primary key (or index key) to read |
| Upper bound | none | Last key to read |
| Limit | 10 | Rows per read |
| Index | 1 (primary) | 2 and higher read a secondary index |
| Key type | Default | The type of the index key (for secondary indexes) |
| Reverse | off | Newest first |

The heart button keeps favorite queries; the clock button lists the query history of this contract.

## Example

Balances of a token holder on WAX Testnet:

| Field | Value |
|---|---|
| Contract | `eosio.token` |
| Table | `accounts` |
| Scope | the holder's account name |

The row shows `balance`, for example `25.00000000 WAX`. For the token's supply, use table `stat` with scope `WAX` (the symbol code).

## What is needed

- The contract's ABI on the chain. An account without a contract shows "This account has no contract (no ABI)".
- The right scope. Many contracts use the user's account name as scope; others use the contract account. "No rows." often means a different scope.

See also [The token contract](doc:token-contract).
