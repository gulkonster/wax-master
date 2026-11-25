# Build, Output and Problems

A build compiles the project's C++ source into two files: the WASM (the code the chain runs) and the ABI (the JSON description of the contract's actions and tables). The compiler's lines go to the Output panel; its errors and warnings also go to the Problems list.

## How to do it here

1. Open the project.
2. Press Ctrl+B, or Contract > Build, or the **Build** button above the file tree.
3. The Output panel opens and shows the command line, the compiler's lines as they come, and the result.
4. If the build fails with errors, the Problems tab opens by itself (or open it with View > Problems or Ctrl+Shift+M). Click an entry to jump to the place in the source.

Colours in Output: errors red, warnings yellow, notes grey. Only the `file:line:column` part of a line is a link; click it to open that place. The status bar shows the error and warning counts of the last build.

After every successful compile the app checks the ABI. Lines starting with `ABI check:` explain a fault the chain would refuse. See [ABI check messages](doc:abi-check).

[Build](app:build) [Output](app:show-output) [Problems](app:show-problems)

## Build again or not

- Contract > Build and Ctrl+B always compile.
- Deploy and Simulate Deploy compile only when something in the project folder changed since the last build. Otherwise the dialog says "Build is up to date (built 14:05)". **Rebuild** in the Deploy dialog always compiles.

## The WASM view

Opening the built `.wasm` file in the file tree shows the WASM view instead of the editor. **Size** is the file size in bytes. **SHA-256** is the hash of the file; it is the code hash the chain shows for an account once this file is deployed, so it tells you which build is on the chain. **Exports** are what the module offers to the chain, among them `apply`, the entry point of every action. **Imported functions** are the host functions the contract calls; before a deploy they are checked against the features active on the chosen chain. A file that is not a WebAssembly module shows a red line instead.

## Example

A missing semicolon in `src/hello.cpp` gives a red line like this in Output:

```
src/hello.cpp:5:31: error: expected ';' after expression
```

Click `src/hello.cpp:5:31` to jump to the line, fix it, press Ctrl+B again.

## What is needed

- The toolchain (Help > Setup). Without it the build cannot start.
- The editor shows live errors while you type (status bar `C++: ready`). The build output is the final word on errors. What the editor cannot see before the build is listed in [The editor](doc:editor).

See also [Common compiler errors](doc:compiler-errors).
