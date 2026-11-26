# Testnet and mainnet builds

One contract source builds for WAX Testnet and for WAX Mainnet without editing files. WAX Master compiles a **testnet build** for test networks and the local chain, and a **mainnet build** for a mainnet, and picks the right one for the network you deploy to.

## How it works

When WAX Master compiles a project whose sources name one of two macros, it defines one of them:

| Build | Defined | Used for |
|---|---|---|
| Testnet build | `WAXMASTER_TESTNET` | WAX Testnet, other test networks, the local chain |
| Mainnet build | `WAXMASTER_MAINNET` | WAX Mainnet and every other mainnet |

Code inside `#ifdef WAXMASTER_TESTNET ... #endif` is compiled into the testnet build only. It is not in the mainnet build at all: not in its WASM and not in its ABI.

A project that names neither macro has one build that fits every network, as before.

## How to do it here

1. Put the values that differ per network in one header, for example `include/network.hpp`, and include it where they are used.
2. Wrap test-only actions in `#ifdef WAXMASTER_TESTNET`.
3. Select the network and build or deploy as usual. Build (Ctrl+B) builds for the selected network; Deploy builds for the network it deploys to, by itself. The first line of Output says which build it is.
4. The confirmation window shows the build ("Testnet build", "Mainnet build" or "One build for every network"). A testnet build is never sent to a mainnet, and a mainnet build never to a test network.

## Example

One file with both parts. The values at the top can also live in a header of their own, for example `include/network.hpp`, included where they are used.

```cpp
#include <eosio/eosio.hpp>
using namespace eosio;

// One place for the values that differ per network.
#ifdef WAXMASTER_MAINNET
  #define ORNG_ACCOUNT "orng.wax"_n
#else
  #define ORNG_ACCOUNT "cleanrngcore"_n
#endif

class [[eosio::contract("game")]] game : public contract {
public:
  using contract::contract;

  [[eosio::action]] void roll(name player) {
    require_auth(player);
    require_recipient(ORNG_ACCOUNT);
  }

#ifdef WAXMASTER_TESTNET
  // Only in the testnet build: not in the mainnet WASM or ABI.
  [[eosio::action]] void cleanup() {
    require_auth(get_self());
  }
#endif
};
```

`roll` notifies `ORNG_ACCOUNT`: `cleanrngcore` in the testnet build, `orng.wax` in the mainnet build. The mainnet build has no `cleanup` action.

## What is needed

- Nothing to set up. A project with its own build command (Project Settings) gets `WAXMASTER_NETWORK` (`testnet` or `mainnet`) and `WAXMASTER_BUILD_FLAG` (`-DWAXMASTER_TESTNET` or `-DWAXMASTER_MAINNET`) as environment variables; add `$WAXMASTER_BUILD_FLAG` to the command to use them.

> Note: Switching between a test network and a mainnet builds the project again for the other network.
