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
2. Put the guard (below) at the top of that header.
3. Wrap test-only actions in `#ifdef WAXMASTER_TESTNET`. Never write them as `#ifndef WAXMASTER_MAINNET`.
4. Select the network and build or deploy as usual. Build (Ctrl+B) builds for the selected network; Deploy builds for the network it deploys to, by itself. The first line of Output says which build it is.
5. The confirmation window shows the build ("Testnet build", "Mainnet build" or "One build for every network"). A testnet build is never sent to a mainnet, and a mainnet build never to a test network.

## The guard: stop a build that is not one of the two

Another compiler (for example EOS Studio) does not define `WAXMASTER_TESTNET` or `WAXMASTER_MAINNET`. Without a guard it builds the code without any error: every `#else` branch gives the testnet values, and the result looks like a normal build. With the guard, that build stops with a clear error:

```cpp
#if !defined(WAXMASTER_MAINNET) && !defined(WAXMASTER_TESTNET)
  #error "Build with WAX Master, or add -DWAXMASTER_MAINNET or -DWAXMASTER_TESTNET"
#endif
#if defined(WAXMASTER_MAINNET) && defined(WAXMASTER_TESTNET)
  #error "Define only one of WAXMASTER_MAINNET and WAXMASTER_TESTNET"
#endif
```

Another compiler can still build the code: add `-DWAXMASTER_MAINNET` (mainnet) or `-DWAXMASTER_TESTNET` (testnet) to its compiler flags.

## Write `#ifdef WAXMASTER_TESTNET`, not `#ifndef WAXMASTER_MAINNET`

`#ifndef WAXMASTER_MAINNET` means "every build that is not a mainnet build". That is also a build by another compiler that defines neither macro, so test-only actions written this way can end up in a contract on mainnet, where anyone could call them. Use `#ifdef WAXMASTER_TESTNET` for code that belongs only in the testnet build, and `#ifdef WAXMASTER_MAINNET` for code that belongs only in the mainnet build.

## What WAX Master checks

When a project uses `WAXMASTER_TESTNET` or `WAXMASTER_MAINNET`, every build checks its sources and shows a warning in Output and Problems (the build itself goes on):

- the sources have no guard that stops a build with neither macro: the warning shows the lines to add;
- a line is written as `#ifndef WAXMASTER_MAINNET` or `#ifndef WAXMASTER_TESTNET` (or `#if !defined(...)` of one macro): the warning names the line and the `#ifdef` to write instead.

Click a warning in Problems to open the line.

The editor checks the code as the testnet build: its error marks and completions follow the testnet branches, and the guard shows no error there.

## Example

One file with the guard and both parts. The guard and the values at the top can also live in a header of their own, for example `include/network.hpp`, included where they are used.

```cpp
#include <eosio/eosio.hpp>
using namespace eosio;

// Stops a build by another compiler that defines neither macro.
#if !defined(WAXMASTER_MAINNET) && !defined(WAXMASTER_TESTNET)
  #error "Build with WAX Master, or add -DWAXMASTER_MAINNET or -DWAXMASTER_TESTNET"
#endif
#if defined(WAXMASTER_MAINNET) && defined(WAXMASTER_TESTNET)
  #error "Define only one of WAXMASTER_MAINNET and WAXMASTER_TESTNET"
#endif

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

`roll` notifies `ORNG_ACCOUNT`: `cleanrngcore` in the testnet build, `orng.wax` in the mainnet build. The mainnet build has no `cleanup` action. Built without either flag, the code stops at the guard.

## What is needed

- Nothing to set up. A project with its own build command (Project Settings) gets `WAXMASTER_NETWORK` (`testnet` or `mainnet`) and `WAXMASTER_BUILD_FLAG` (`-DWAXMASTER_TESTNET` or `-DWAXMASTER_MAINNET`) as environment variables; add `$WAXMASTER_BUILD_FLAG` to the command to use them.

> Note: Switching between a test network and a mainnet builds the project again for the other network.
